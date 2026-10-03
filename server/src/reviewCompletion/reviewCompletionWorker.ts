import type { Application, Request, Response } from 'express';
import {
  createReviewCompletionJob,
  InMemoryCheckpointStore,
  jobAuthoritativeComplete,
  runReviewCompletionPass,
  reviewCompletionJobBackoffMs,
  REVIEW_COMPLETION_LEASE_MS,
  REVIEW_COMPLETION_SWEEP_INTERVAL_MS,
  REVIEW_COMPLETION_DECISION_CONCURRENCY,
  REVIEW_COMPLETION_HEARTBEAT_MS,
  REVIEW_COMPLETION_MAX_ATTEMPTS,
  type CheckpointStore,
  type ReviewCompletionJobRecord,
  type RunCompletionPassOptions,
} from '@racehorse/review-engine';
import type { ReviewEvaluationV1, ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import { childLogger } from '../logger';
import { getAuthenticatedUserId } from '../platform/auth/supabaseAuth';
import { SupabaseCheckpointStore } from './supabaseCheckpointStore';
import { ReviewSearchRunner } from './reviewSearchRunner';
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
    return new InMemoryCheckpointStore({
      maxAttempts: REVIEW_COMPLETION_MAX_ATTEMPTS,
      backoffMs: reviewCompletionJobBackoffMs,
    });
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
  readonly expectedDecisionIds: readonly string[];
  readonly captureFailures?: ReviewCompletionJobRecord['captureFailures'];
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
    expectedDecisionIds: input.expectedDecisionIds,
    captureFailures: input.captureFailures,
    liveResultsByDecisionId: input.liveResultsByDecisionId,
  });
  // Durable before acknowledgment.
  await store.put(job);
  const confirmed = await store.get(job.jobId);
  if (!confirmed) {
    throw new Error('Failed to durably persist review completion job');
  }
  // The job stays queued when the sweep is off; it runs once the sweep is back on.
  if (isReviewSweepEnabled()) {
    void sweepReviewCompletionJobs().catch((error) => {
      log.warn({ err: error, jobId: job.jobId }, 'kick failed');
    });
  }
  return confirmed;
}

type SweepResult = { ran: number; completed: number; recovered: number };
type EvaluatePosition = NonNullable<RunCompletionPassOptions['evaluatePosition']>;

let searchRunner: ReviewSearchRunner | null = null;
let evaluatorOverride: EvaluatePosition | null = null;

/** Search runs in a worker thread, never on this process's event loop. */
function evaluatePositionOffThread(): EvaluatePosition {
  if (evaluatorOverride) return evaluatorOverride;
  searchRunner ??= new ReviewSearchRunner();
  const runner = searchRunner;
  return (snapshot, options) => runner.evaluate(snapshot, options);
}

/** Test seam: replace the worker-thread evaluator (null restores it). */
export function setReviewPositionEvaluatorForTests(next: EvaluatePosition | null): void {
  evaluatorOverride = next;
}

/** Test seam / shutdown: stop the search worker thread. */
export async function closeReviewSearchRunner(): Promise<void> {
  const runner = searchRunner;
  searchRunner = null;
  if (runner) await runner.close();
}

let sweepInFlight: Promise<SweepResult> | null = null;
let sweepRequestedAgain = false;

/**
 * Single flight: at most one sweep runs in this process. A tick or enqueue
 * kick that arrives while one is running asks it to go round once more
 * instead of starting a second pass over the same jobs. Across processes the
 * claim RPC decides, from the locked row, whether a job is due.
 */
export function sweepReviewCompletionJobs(limit = 4): Promise<SweepResult> {
  if (sweepInFlight) {
    sweepRequestedAgain = true;
    return Promise.resolve({ ran: 0, completed: 0, recovered: 0 });
  }
  const run = (async () => {
    const total: SweepResult = { ran: 0, completed: 0, recovered: 0 };
    do {
      sweepRequestedAgain = false;
      const round = await sweepOnce(limit);
      total.ran += round.ran;
      total.completed += round.completed;
      total.recovered += round.recovered;
    } while (sweepRequestedAgain);
    return total;
  })();
  sweepInFlight = run;
  void run.finally(() => {
    if (sweepInFlight === run) sweepInFlight = null;
  }).catch(() => undefined);
  return run;
}

async function sweepOnce(limit: number): Promise<SweepResult> {
  let ran = 0;
  let completed = 0;
  let recovered = 0;
  const listedAt = Date.now();
  // The list is only a hint: claim_review_completion_job_v2 re-checks each
  // job on its locked row when the claim lands.
  const claimable = store.listClaimable
    ? await store.listClaimable(listedAt, limit)
    : [];

  // One job at a time: there is one search worker thread.
  for (const job of claimable) {
    const hadForeignClaim =
      job.claimToken != null
      && job.leaseExpiresAt != null
      && job.leaseExpiresAt <= listedAt;
    ran += 1;
    try {
      const result = await runJobPass(job.jobId, `sweep-${process.pid}-${Date.now()}-${ran}`);
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

/**
 * One pass with a lease heartbeat. The heartbeat renews the lease, fenced on
 * token + generation, every REVIEW_COMPLETION_HEARTBEAT_MS; if the claim is
 * gone the pass stops at the next position and the search in flight is
 * killed, so a superseded pass neither keeps computing nor writes.
 */
async function runJobPass(jobId: string, claimToken: string) {
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let leaseLost = false;
  try {
    return await runReviewCompletionPass({
      store,
      jobId,
      claimToken,
      leaseMs: REVIEW_COMPLETION_LEASE_MS,
      concurrency: REVIEW_COMPLETION_DECISION_CONCURRENCY,
      nowFn: Date.now,
      jobBackoffMs: reviewCompletionJobBackoffMs,
      evaluatePosition: evaluatePositionOffThread(),
      shouldAbort: () => leaseLost,
      onClaimed: (claimed) => {
        if (!store.renewLease) return;
        const generation = claimed.claimGeneration ?? 1;
        heartbeat = setInterval(() => {
          void store.renewLease!(jobId, claimToken, generation, REVIEW_COMPLETION_LEASE_MS)
            .then((renewed) => {
              if (renewed || leaseLost) return;
              leaseLost = true;
              log.warn({ jobId, generation }, 'review lease lost; stopping pass');
              searchRunner?.abort('review lease lost');
            })
            .catch((error) => {
              // Transient: the lease has 3 heartbeats of slack before it lapses.
              log.warn({ err: error, jobId }, 'review lease renewal failed');
            });
        }, REVIEW_COMPLETION_HEARTBEAT_MS);
        heartbeat.unref?.();
      },
    });
  } finally {
    if (heartbeat) clearInterval(heartbeat);
  }
}

let sweepTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Idle backoff for the periodic sweep. Each sweep is a Supabase round trip
 * (5,760 a day at 15 s) and almost always finds nothing. After a sweep that
 * ran no job, the timer skips ticks until REVIEW_SWEEP_IDLE_INTERVAL_MS has
 * passed. New jobs are unaffected (enqueue kicks a sweep directly); a job
 * waiting out its retry backoff (>= 30 s) can start up to this much later.
 */
export const REVIEW_SWEEP_IDLE_INTERVAL_MS = 120_000;
let lastPeriodicSweepAt = 0;
let lastPeriodicSweepIdle = false;

export function shouldRunPeriodicSweep(now: number): boolean {
  return !lastPeriodicSweepIdle || now - lastPeriodicSweepAt >= REVIEW_SWEEP_IDLE_INTERVAL_MS;
}

export function notePeriodicSweep(now: number, ran: number): void {
  lastPeriodicSweepAt = now;
  lastPeriodicSweepIdle = ran === 0;
}

/**
 * Kill switch (#318, kept by the worker-isolation fix). Off unless
 * REVIEW_SWEEP_ENABLED is exactly "true". Off means no periodic sweep and no
 * kick on enqueue; jobs are still accepted and stay queued until the sweep is
 * turned back on.
 */
export function isReviewSweepEnabled(): boolean {
  return process.env.REVIEW_SWEEP_ENABLED === 'true';
}

export function scheduleReviewCompletionSweep(): void {
  if (!isReviewSweepEnabled()) {
    log.warn('review completion sweep DISABLED (REVIEW_SWEEP_ENABLED is not "true"); jobs stay queued');
    return;
  }
  log.info('review completion sweep ENABLED (REVIEW_SWEEP_ENABLED=true)');
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    if (!shouldRunPeriodicSweep(Date.now())) return;
    void sweepReviewCompletionJobs()
      .then((result) => notePeriodicSweep(Date.now(), result.ran))
      .catch((error) => {
        log.warn({ err: error }, 'periodic sweep failed');
      });
  }, REVIEW_COMPLETION_SWEEP_INTERVAL_MS);
  if (typeof sweepTimer.unref === 'function') sweepTimer.unref();
}

/** Test seam: clear the periodic sweep timer and its idle state. */
export function stopReviewCompletionSweepForTests(): void {
  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = null;
  lastPeriodicSweepAt = 0;
  lastPeriodicSweepIdle = false;
}

export function registerReviewCompletionJobsRoute(app: Application): void {
  app.post('/api/review-completion-jobs', async (req: Request, res: Response) => {
    const authenticatedUserId = await getAuthenticatedUserId(req);
    if (!authenticatedUserId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const body = req.body as {
      gameDigest?: unknown;
      sourceMatchId?: unknown;
      snapshots?: unknown;
      expectedDecisionIds?: unknown;
      captureFailures?: unknown;
      evaluations?: unknown;
    };
    if (typeof body.gameDigest !== 'string' || typeof body.sourceMatchId !== 'string') {
      res.status(400).json({ error: 'gameDigest and sourceMatchId are required.' });
      return;
    }
    if (!Array.isArray(body.snapshots) || !Array.isArray(body.expectedDecisionIds) || body.expectedDecisionIds.length === 0) {
      res.status(400).json({ error: 'snapshots[] and expectedDecisionIds[] are required.' });
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
        expectedDecisionIds: body.expectedDecisionIds as string[],
        captureFailures: Array.isArray(body.captureFailures)
          ? body.captureFailures as ReviewCompletionJobRecord['captureFailures']
          : [],
        liveResultsByDecisionId: live,
      });
      const forced = job.decisions.filter((d) => d.lifecycle === 'FORCED').length;
      const scored = job.decisions.filter((d) => d.lifecycle === 'SCORED').length;
      res.status(202).json({
        jobId: job.jobId,
        status: job.status,
        progress: {
          total: job.expectedDecisionIds.length,
          forced,
          scored,
          remaining: job.expectedDecisionIds.length - forced - scored,
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
    // Polled every few seconds: read the job without its snapshots.
    const jobId = String(req.params.jobId);
    const job = store.getSummary ? await store.getSummary(jobId) : await store.get(jobId);
    if (!job || job.userId !== authenticatedUserId) {
      res.status(404).json({ error: 'Job not found.' });
      return;
    }
    const forced = job.decisions.filter((d) => d.lifecycle === 'FORCED').length;
    const scored = job.decisions.filter((d) => d.lifecycle === 'SCORED').length;
    const complete = jobAuthoritativeComplete(job);
    res.status(200).json({
      jobId: job.jobId,
      status: job.status,
      complete,
      // Terminal for the client: the job failed, or the sweep is switched off
      // so nothing will advance it. The client stops polling and says so.
      unavailable: !complete && (job.status === 'failed_fatal' || !isReviewSweepEnabled()),
      progress: {
        total: job.expectedDecisionIds.length,
        forced,
        scored,
        remaining: job.expectedDecisionIds.length - forced - scored,
      },
      accuracyModelResult: job.accuracyModelResult,
      decisions: job.decisions.map((d) => ({
        decisionId: d.decisionId,
        positionHash: d.positionHash,
        lifecycle: d.lifecycle,
        tierReached: d.tierReached,
      })),
      evaluations: job.decisions.flatMap((d) => d.evaluation ? [d.evaluation] : []),
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
