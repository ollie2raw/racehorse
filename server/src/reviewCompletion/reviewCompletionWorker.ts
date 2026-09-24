import type { Application, Request, Response } from 'express';
import {
  createReviewCompletionJob,
  InMemoryCheckpointStore,
  jobAuthoritativeComplete,
  runReviewCompletionPass,
  REVIEW_COMPLETION_LEASE_MS,
  REVIEW_COMPLETION_SWEEP_INTERVAL_MS,
  REVIEW_COMPLETION_DECISION_CONCURRENCY,
  type CheckpointStore,
  type ReviewCompletionJobRecord,
} from '@racehorse/review-engine';
import type { ReviewEvaluationV1, ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import { childLogger } from '../logger';
import { getAuthenticatedUserId } from '../platform/auth/supabaseAuth';
import { isGameReviewCohortUser } from '../reviewPersistence/gameReviewCohort';
import { SupabaseCheckpointStore } from './supabaseCheckpointStore';
import { config } from '../config';

const log = childLogger('review-completion');

/**
 * Production authority is Postgres via SupabaseCheckpointStore.
 * InMemory is only used when SUPABASE is unavailable (local unit tests) or
 * REVIEW_COMPLETION_STORE=memory is forced.
 */
function createProductionStore(): CheckpointStore {
  if (process.env.REVIEW_COMPLETION_STORE === 'memory') {
    return new InMemoryCheckpointStore();
  }
  if (!config.supabaseUrl || !config.supabaseServiceKey) {
    // Memory is never production authority. Local/unit tests may force memory;
    // production / staging without Supabase must fail closed.
    const env = process.env.NODE_ENV ?? 'development';
    if (env === 'production' || process.env.REVIEW_COMPLETION_REQUIRE_DURABLE === '1') {
      throw new Error(
        'review_completion_jobs requires Supabase — refusing process-local authority',
      );
    }
    log.warn('Supabase not configured — review completion falling back to memory store (non-production)');
    return new InMemoryCheckpointStore();
  }
  return new SupabaseCheckpointStore();
}

let store: CheckpointStore = createProductionStore();
let recoveryCount = 0;

export function getReviewCompletionStore(): CheckpointStore {
  return store;
}

/** Test seam: replace store (e.g. InMemory with CAS). */
export function setReviewCompletionStoreForTests(next: CheckpointStore): void {
  store = next;
}

export function getReviewCompletionRecoveryCount(): number {
  return recoveryCount;
}

export function resetReviewCompletionRecoveryCount(): void {
  recoveryCount = 0;
}

export async function enqueueReviewCompletionJob(input: {
  readonly userId: string;
  readonly gameDigest: string;
  readonly sourceMatchId: string;
  readonly snapshots: readonly ReviewPositionSnapshotV2[];
  readonly liveResultsByDecisionId?: ReadonlyMap<string, ReviewEvaluationV1>;
}): Promise<ReviewCompletionJobRecord> {
  const existing = await store.getByGameDigest(input.gameDigest, input.userId);
  if (existing && existing.userId === input.userId) {
    return existing;
  }
  const job = createReviewCompletionJob({
    gameDigest: input.gameDigest,
    sourceMatchId: input.sourceMatchId,
    userId: input.userId,
    snapshots: input.snapshots,
    liveResultsByDecisionId: input.liveResultsByDecisionId,
  });
  // Durable before acknowledgment.
  await store.put(job);
  const confirmed = await store.get(job.jobId);
  if (!confirmed) {
    throw new Error('Failed to durably persist review completion job');
  }
  void sweepReviewCompletionJobs().catch((error) => {
    log.warn({ err: error, jobId: job.jobId }, 'kick failed');
  });
  return confirmed;
}

export async function sweepReviewCompletionJobs(limit = 4): Promise<{
  ran: number;
  completed: number;
  recovered: number;
}> {
  let ran = 0;
  let completed = 0;
  let recovered = 0;
  const now = Date.now();
  const claimable = store.listClaimable
    ? await store.listClaimable(now, limit)
    : [];

  for (const job of claimable) {
    const hadForeignClaim =
      job.claimToken != null
      && job.leaseExpiresAt != null
      && job.leaseExpiresAt <= now;
    ran += 1;
    try {
      const result = await runReviewCompletionPass({
        store,
        jobId: job.jobId,
        claimToken: `sweep-${process.pid}-${Date.now()}-${ran}`,
        leaseMs: REVIEW_COMPLETION_LEASE_MS,
        concurrency: REVIEW_COMPLETION_DECISION_CONCURRENCY,
        now,
      });
      if (hadForeignClaim && !result.claimLost) {
        recovered += 1;
        recoveryCount += 1;
      }
      if (jobAuthoritativeComplete(result.job)) completed += 1;
    } catch (error) {
      log.warn({ err: error, jobId: job.jobId }, 'sweep pass failed — will retry');
    }
  }
  return { ran, completed, recovered };
}

let sweepTimer: ReturnType<typeof setInterval> | null = null;

export function scheduleReviewCompletionSweep(): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    void sweepReviewCompletionJobs().catch((error) => {
      log.warn({ err: error }, 'periodic sweep failed');
    });
  }, REVIEW_COMPLETION_SWEEP_INTERVAL_MS);
  if (typeof sweepTimer.unref === 'function') sweepTimer.unref();
}

export function registerReviewCompletionJobsRoute(app: Application): void {
  app.post('/api/review-completion-jobs', async (req: Request, res: Response) => {
    const authenticatedUserId = await getAuthenticatedUserId(req);
    if (!authenticatedUserId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (!isGameReviewCohortUser(authenticatedUserId)) {
      res.status(403).json({ error: 'Post-game review is not enabled for this account.' });
      return;
    }

    const body = req.body as {
      gameDigest?: unknown;
      sourceMatchId?: unknown;
      snapshots?: unknown;
      evaluations?: unknown;
    };
    if (typeof body.gameDigest !== 'string' || typeof body.sourceMatchId !== 'string') {
      res.status(400).json({ error: 'gameDigest and sourceMatchId are required.' });
      return;
    }
    if (!Array.isArray(body.snapshots) || body.snapshots.length === 0) {
      res.status(400).json({ error: 'snapshots[] is required.' });
      return;
    }

    const live = new Map<string, ReviewEvaluationV1>();
    if (Array.isArray(body.evaluations)) {
      for (const row of body.evaluations as ReviewEvaluationV1[]) {
        if (row && typeof row.snapshotId === 'string') live.set(row.snapshotId, row);
      }
    }

    try {
      const job = await enqueueReviewCompletionJob({
        userId: authenticatedUserId,
        gameDigest: body.gameDigest,
        sourceMatchId: body.sourceMatchId,
        snapshots: body.snapshots as ReviewPositionSnapshotV2[],
        liveResultsByDecisionId: live,
      });
      const forced = job.decisions.filter((d) => d.lifecycle === 'FORCED').length;
      const scored = job.decisions.filter((d) => d.lifecycle === 'SCORED').length;
      res.status(202).json({
        jobId: job.jobId,
        status: job.status,
        progress: {
          total: job.decisions.length,
          forced,
          scored,
          remaining: job.decisions.length - forced - scored,
        },
      });
    } catch (error) {
      log.error({ err: error }, 'enqueue failed');
      res.status(500).json({ error: 'Failed to enqueue review completion job.' });
    }
  });

  app.get('/api/review-completion-jobs/:jobId', async (req: Request, res: Response) => {
    const authenticatedUserId = await getAuthenticatedUserId(req);
    if (!authenticatedUserId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const job = await store.get(String(req.params.jobId));
    if (!job || job.userId !== authenticatedUserId) {
      res.status(404).json({ error: 'Job not found.' });
      return;
    }
    const forced = job.decisions.filter((d) => d.lifecycle === 'FORCED').length;
    const scored = job.decisions.filter((d) => d.lifecycle === 'SCORED').length;
    res.status(200).json({
      jobId: job.jobId,
      status: job.status,
      complete: jobAuthoritativeComplete(job),
      progress: {
        total: job.decisions.length,
        forced,
        scored,
        remaining: job.decisions.length - forced - scored,
      },
      accuracyModelResult: job.accuracyModelResult,
      decisions: job.decisions.map((d) => ({
        decisionId: d.decisionId,
        positionHash: d.positionHash,
        lifecycle: d.lifecycle,
        tierReached: d.tierReached,
      })),
      evaluations: jobAuthoritativeComplete(job)
        ? job.decisions.map((d) => d.evaluation)
        : undefined,
    });
  });

  app.get('/api/review-completion-jobs', async (req: Request, res: Response) => {
    const authenticatedUserId = await getAuthenticatedUserId(req);
    if (!authenticatedUserId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const digest = typeof req.query.gameDigest === 'string' ? req.query.gameDigest : null;
    if (!digest) {
      res.status(400).json({ error: 'gameDigest query required.' });
      return;
    }
    const job = await store.getByGameDigest(digest, authenticatedUserId);
    if (!job || job.userId !== authenticatedUserId) {
      res.status(404).json({ error: 'Job not found.' });
      return;
    }
    res.status(200).json({
      jobId: job.jobId,
      status: job.status,
      complete: jobAuthoritativeComplete(job),
    });
  });
}
