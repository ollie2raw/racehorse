/**
 * Durable, idempotent review-completion runtime.
 *
 * Ownership model:
 * - CheckpointStore is the authority for in-flight job state (Postgres on
 *   server, in-memory for tests, localStorage mirror on client).
 * - The browser is never the sole authority for whether analysis finishes.
 * - Each decision evaluation is idempotent by (jobId, decisionId, positionHash).
 * - Process/browser death leaves FAILED_RETRYABLE / PENDING checkpoints that
 *   a new runtime resumes without duplicating completed SCORED/FORCED rows.
 */

import { isForcedDecision } from '@racehorse/game-core/review';
import type {
  ReviewDecisionLifecycle,
  ReviewEvaluationV1,
  ReviewPositionSnapshotV2,
} from '@racehorse/game-core/review';
import { adaptiveEvaluateReviewPosition } from './adaptiveEvaluateReviewPosition';
import { transitionLifecycle } from './decisionLifecycleStateMachine';
import { computeGameAccuracyModel } from './gameAccuracyModel';

export type ReviewCompletionJobStatus =
  | 'pending'
  | 'running'
  | 'complete'
  | 'failed_fatal';

export type ReviewCompletionDecisionCheckpoint = {
  readonly decisionId: string;
  readonly positionHash: string;
  readonly lifecycle: ReviewDecisionLifecycle;
  readonly tierReached: 1 | 2 | 3 | 4 | null;
  readonly evaluation: ReviewEvaluationV1 | null;
  readonly updatedAt: number;
  readonly attemptCount: number;
};

export type ReviewCompletionJobRecord = {
  readonly jobVersion: 2;
  readonly jobId: string;
  readonly gameDigest: string;
  readonly sourceMatchId: string;
  readonly userId: string | null;
  readonly status: ReviewCompletionJobStatus;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly snapshots: readonly ReviewPositionSnapshotV2[];
  /** Canonical player-decision set captured before analysis begins. */
  readonly expectedDecisionIds: readonly string[];
  readonly captureFailures: readonly { decisionId: string; handId: string; sequence: number; reason: string }[];
  readonly decisions: readonly ReviewCompletionDecisionCheckpoint[];
  readonly accuracyModelResult: ReturnType<typeof computeGameAccuracyModel> | null;
  readonly claimToken: string | null;
  readonly nextAttemptAt: number;
  /** CAS generation from durable claim RPC / in-memory store. */
  readonly claimGeneration?: number;
  readonly leaseExpiresAt?: number | null;
};

export type CheckpointStore = {
  get(jobId: string): Promise<ReviewCompletionJobRecord | null>;
  getByGameDigest(gameDigest: string, userId?: string | null): Promise<ReviewCompletionJobRecord | null>;
  /** Durable insert/upsert before acknowledgment. Idempotent on jobId. */
  put(job: ReviewCompletionJobRecord): Promise<void>;
  /**
   * Atomic claim for worker. Returns claimed job with updated claimToken /
   * claimGeneration / lease, or null if lost race / terminal.
   */
  claim(
    jobId: string,
    claimToken: string,
    now: number,
    leaseMs?: number,
  ): Promise<ReviewCompletionJobRecord | null>;
  /**
   * CAS checkpoint after work. Must fail (throw or return null) if claim
   * was stolen. Generation must match the claim that started the pass.
   */
  checkpoint?(
    job: ReviewCompletionJobRecord,
    claimToken: string,
    claimGeneration: number,
    leaseMs?: number,
  ): Promise<ReviewCompletionJobRecord | null>;
  /** Sweep: jobs whose lease expired or that are pending. */
  listClaimable?(now: number, limit?: number): Promise<readonly ReviewCompletionJobRecord[]>;
};

/** Optional claim generation stamped on records for CAS stores. */
export type ReviewCompletionJobRecordWithGeneration = ReviewCompletionJobRecord & {
  readonly claimGeneration?: number;
};

export class InMemoryCheckpointStore implements CheckpointStore {
  private readonly jobs = new Map<string, ReviewCompletionJobRecord>();
  private readonly byDigest = new Map<string, string>();
  /** Simulated transient failures for Part B-E tests. */
  failNextPuts = 0;

  async get(jobId: string): Promise<ReviewCompletionJobRecord | null> {
    return this.jobs.get(jobId) ?? null;
  }

  async getByGameDigest(
    gameDigest: string,
    userId?: string | null,
  ): Promise<ReviewCompletionJobRecord | null> {
    const key = `${userId ?? 'anon'}:${gameDigest}`;
    const id = this.byDigest.get(key) ?? this.byDigest.get(gameDigest);
    return id ? (this.jobs.get(id) ?? null) : null;
  }

  async put(job: ReviewCompletionJobRecord): Promise<void> {
    if (this.failNextPuts > 0) {
      this.failNextPuts -= 1;
      throw new Error('simulated durable repository transient error');
    }
    const existing = this.jobs.get(job.jobId);
    // Idempotent create: do not clobber a completed artifact with a newer pending.
    if (existing && existing.status === 'complete' && job.status !== 'complete') {
      return;
    }
    this.jobs.set(job.jobId, {
      ...job,
      claimGeneration: job.claimGeneration ?? existing?.claimGeneration ?? 0,
    });
    this.byDigest.set(`${job.userId ?? 'anon'}:${job.gameDigest}`, job.jobId);
    this.byDigest.set(job.gameDigest, job.jobId);
  }

  async claim(
    jobId: string,
    claimToken: string,
    now: number,
    leaseMs = 60_000,
  ): Promise<ReviewCompletionJobRecord | null> {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    if (job.status === 'complete' || job.status === 'failed_fatal') return null;
    const leaseExpired =
      job.leaseExpiresAt == null || job.leaseExpiresAt <= now || job.nextAttemptAt <= now;
    if (
      job.claimToken
      && job.claimToken !== claimToken
      && !leaseExpired
    ) {
      return null;
    }
    const claimed: ReviewCompletionJobRecord = {
      ...job,
      status: 'running',
      claimToken,
      claimGeneration: (job.claimGeneration ?? 0) + 1,
      updatedAt: now,
      nextAttemptAt: now + leaseMs,
      leaseExpiresAt: now + leaseMs,
    };
    this.jobs.set(jobId, claimed);
    return claimed;
  }

  async checkpoint(
    job: ReviewCompletionJobRecord,
    claimToken: string,
    claimGeneration: number,
    leaseMs = 60_000,
  ): Promise<ReviewCompletionJobRecord | null> {
    if (this.failNextPuts > 0) {
      this.failNextPuts -= 1;
      throw new Error('simulated durable repository transient error');
    }
    const current = this.jobs.get(job.jobId);
    if (!current) return null;
    if (current.claimToken !== claimToken || (current.claimGeneration ?? 0) !== claimGeneration) {
      return null;
    }
    if (current.status === 'complete' || current.status === 'failed_fatal') {
      // Immutable completed artifact.
      return current;
    }
    const now = Date.now();
    const next: ReviewCompletionJobRecord = {
      ...job,
      claimToken: job.status === 'complete' || job.status === 'failed_fatal' ? null : claimToken,
      claimGeneration,
      updatedAt: now,
      leaseExpiresAt:
        job.status === 'complete' || job.status === 'failed_fatal'
          ? null
          : (job.leaseExpiresAt ?? now + leaseMs),
      nextAttemptAt: job.nextAttemptAt,
    };
    this.jobs.set(job.jobId, next);
    return next;
  }

  async listClaimable(now: number, limit = 8): Promise<readonly ReviewCompletionJobRecord[]> {
    return [...this.jobs.values()]
      .filter((j) => {
        if (j.status !== 'pending' && j.status !== 'running') return false;
        if (j.nextAttemptAt > now) return false;
        const expired = j.leaseExpiresAt == null || j.leaseExpiresAt <= now || j.claimToken == null;
        return expired || j.status === 'pending';
      })
      .sort((a, b) => a.nextAttemptAt - b.nextAttemptAt || a.createdAt - b.createdAt)
      .slice(0, limit);
  }
}

export function reviewCompletionJobId(gameDigest: string, userId: string | null): string {
  return `rcv2:${userId ?? 'anon'}:${gameDigest}`;
}

export function createReviewCompletionJob(input: {
  readonly gameDigest: string;
  readonly sourceMatchId: string;
  readonly userId?: string | null;
  readonly snapshots: readonly ReviewPositionSnapshotV2[];
  readonly expectedDecisionIds?: readonly string[];
  readonly captureFailures?: ReviewCompletionJobRecord['captureFailures'];
  readonly liveResultsByDecisionId?: ReadonlyMap<string, ReviewEvaluationV1>;
  readonly now?: number;
}): ReviewCompletionJobRecord {
  const now = input.now ?? Date.now();
  const live = input.liveResultsByDecisionId ?? new Map<string, ReviewEvaluationV1>();
  const expectedDecisionIds = input.expectedDecisionIds ?? input.snapshots.map((snapshot) => snapshot.identifiers.decisionId);
  if (expectedDecisionIds.length === 0 || expectedDecisionIds.some((id) => !id.trim())) {
    throw new Error('Review completion requires a non-empty expected decision set');
  }
  if (new Set(expectedDecisionIds).size !== expectedDecisionIds.length) {
    throw new Error('Duplicate expected review decision ID');
  }
  const snapshotById = new Map(input.snapshots.map((snapshot) => [snapshot.identifiers.decisionId, snapshot] as const));
  if (snapshotById.size !== input.snapshots.length) throw new Error('Duplicate review snapshot decision ID');
  if (input.snapshots.some((snapshot) => !expectedDecisionIds.includes(snapshot.identifiers.decisionId))) {
    throw new Error('Snapshot decision ID is not in expected decision set');
  }
  const captureFailures = input.captureFailures ?? [];
  if (new Set(captureFailures.map((failure) => failure.decisionId)).size !== captureFailures.length
    || captureFailures.some((failure) => !expectedDecisionIds.includes(failure.decisionId) || snapshotById.has(failure.decisionId))) {
    throw new Error('Capture failure IDs must be unique expected decisions without snapshots');
  }
  const failuresById = new Set(captureFailures.map((failure) => failure.decisionId));
  if (expectedDecisionIds.some((decisionId) => !snapshotById.has(decisionId) && !failuresById.has(decisionId))) {
    throw new Error('Every expected decision without a snapshot requires an explicit capture failure');
  }
  const decisions: ReviewCompletionDecisionCheckpoint[] = expectedDecisionIds.map((decisionId) => {
    const snapshot = snapshotById.get(decisionId);
    if (!snapshot) return {
      decisionId,
      positionHash: decisionId,
      lifecycle: 'PENDING',
      tierReached: null,
      evaluation: null,
      updatedAt: now,
      attemptCount: 0,
    };
    const positionHash = snapshot.integrity.positionHash ?? decisionId;
    const existing = live.get(decisionId);
    if (existing && isForcedDecision(existing.candidates)) {
      return {
        decisionId,
        positionHash,
        lifecycle: 'FORCED' as const,
        tierReached: null,
        evaluation: {
          ...existing,
          evaluationProvenance: {
            phase: 'completion',
            lifecycle: 'FORCED',
            positionHash,
          },
        },
        updatedAt: now,
        attemptCount: 0,
      };
    }
    if (
      existing
      && (existing.evidence.source === 'exact' || existing.evidence.source === 'search')
    ) {
      return {
        decisionId,
        positionHash,
        lifecycle: 'SCORED' as const,
        tierReached: existing.evaluationProvenance?.escalationTier ?? 1,
        evaluation: {
          ...existing,
          evaluationProvenance: {
            phase: 'completion',
            lifecycle: 'SCORED',
            positionHash,
            escalationTier: existing.evaluationProvenance?.escalationTier,
          },
        },
        updatedAt: now,
        attemptCount: 0,
      };
    }
    return {
      decisionId,
      positionHash,
      lifecycle: 'PENDING' as const,
      tierReached: null,
      evaluation: existing ?? null,
      updatedAt: now,
      attemptCount: 0,
    };
  });

  return {
    jobVersion: 2,
    jobId: reviewCompletionJobId(input.gameDigest, input.userId ?? null),
    gameDigest: input.gameDigest,
    sourceMatchId: input.sourceMatchId,
    userId: input.userId ?? null,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    snapshots: input.snapshots,
    expectedDecisionIds,
    captureFailures,
    decisions,
    accuracyModelResult: null,
    claimToken: null,
    nextAttemptAt: now,
  };
}

function backoffMs(attemptCount: number): number {
  const base = Math.min(60_000, 500 * 2 ** Math.min(attemptCount, 6));
  return base;
}

export type RunCompletionPassOptions = {
  readonly store: CheckpointStore;
  readonly jobId: string;
  readonly claimToken: string;
  readonly now?: number;
  /** Simulate process death after N newly-worked decisions. */
  readonly dieAfterDecisions?: number;
  readonly maxTier?: 1 | 2 | 3 | 4;
  readonly shouldAbort?: () => boolean;
  readonly leaseMs?: number;
  /**
   * Bounded parallel evaluation of independent pending decisions within one
   * claimed pass. Default 1 (serial). Cap 4 to protect host resources.
   * Results are written back in original decision-index order before the
   * durable checkpoint — arrival order never affects the artifact.
   */
  readonly concurrency?: number;
};

export type RunCompletionPassResult = {
  readonly job: ReviewCompletionJobRecord;
  readonly newlyCompleted: number;
  readonly interrupted: boolean;
  readonly claimLost?: boolean;
};

async function persistCheckpoint(
  store: CheckpointStore,
  job: ReviewCompletionJobRecord,
  claimToken: string,
  claimGeneration: number,
  leaseMs: number,
): Promise<ReviewCompletionJobRecord | null> {
  if (store.checkpoint) {
    return store.checkpoint(job, claimToken, claimGeneration, leaseMs);
  }
  await store.put(job);
  return job;
}

/**
 * One durable worker pass: claim → advance pending/retryable decisions →
 * checkpoint after each wave → finalize when forced+scored==total.
 *
 * Within a claimed lease, independent pending decisions may evaluate in a
 * bounded parallel wave (`concurrency`). Checkpoint order is always the
 * original decision-index order — never arrival order.
 */
export async function runReviewCompletionPass(
  options: RunCompletionPassOptions,
): Promise<RunCompletionPassResult> {
  const clock = options.now ?? Date.now();
  const leaseMs = options.leaseMs ?? 60_000;
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 1, 4));
  const claimed = await options.store.claim(options.jobId, options.claimToken, clock, leaseMs);
  if (!claimed) {
    const current = await options.store.get(options.jobId);
    if (!current) throw new Error(`Unknown completion job ${options.jobId}`);
    return { job: current, newlyCompleted: 0, interrupted: false, claimLost: true };
  }
  const claimGeneration = claimed.claimGeneration ?? 1;

  let newlyCompleted = 0;
  let interrupted = false;
  const decisions = [...claimed.decisions];
  const snapshotById = new Map(
    claimed.snapshots.map((s) => [s.identifiers.decisionId, s] as const),
  );

  const pendingIndices: number[] = [];
  for (let i = 0; i < decisions.length; i += 1) {
    const row = decisions[i]!;
    if (row.lifecycle === 'SCORED' || row.lifecycle === 'FORCED' || row.lifecycle === 'FAILED_FATAL') {
      continue;
    }
    pendingIndices.push(i);
  }

  let worked = 0;
  for (let waveStart = 0; waveStart < pendingIndices.length; waveStart += concurrency) {
    if (options.shouldAbort?.()) {
      interrupted = true;
      break;
    }
    const wave = pendingIndices.slice(waveStart, waveStart + concurrency);

    const waveResults = await Promise.all(
      wave.map(async (i) => {
        const row = decisions[i]!;
        const snapshot = snapshotById.get(row.decisionId);
        if (!snapshot) {
          return {
            index: i,
            checkpoint: {
              decisionId: row.decisionId,
              positionHash: row.positionHash,
              // Capture-integrity failures remain explicitly pending. A
              // missing snapshot is not an evaluation and cannot be terminal.
              lifecycle: 'PENDING' as const,
              tierReached: row.tierReached,
              updatedAt: clock,
              attemptCount: row.attemptCount + 1,
              evaluation: row.evaluation
                ? {
                    ...row.evaluation,
                    evaluationProvenance: {
                      phase: 'completion',
                      lifecycle: 'PENDING',
                      failureReason: 'missing-snapshot' as const,
                      positionHash: row.positionHash,
                    },
                  }
                : null,
            } satisfies ReviewCompletionDecisionCheckpoint,
          };
        }

        const from =
          row.lifecycle === 'FAILED_RETRYABLE'
            ? transitionLifecycle('FAILED_RETRYABLE', 'PENDING')
            : row.lifecycle;
        const searching = transitionLifecycle(from === 'PENDING' ? 'PENDING' : from, 'SEARCHING');
        const result = adaptiveEvaluateReviewPosition(snapshot, {
          startTier: (row.tierReached ?? 1) as 1 | 2 | 3 | 4,
          maxTier: options.maxTier ?? 4,
          phase: 'completion',
          allowProgressiveBeyondTier: true,
          shouldAbort: options.shouldAbort,
          progressiveSampleOffset: row.attemptCount * 10_000,
        });
        const nextLife = transitionLifecycle(
          searching,
          result.lifecycle === 'FAILED_RETRYABLE' ? 'FAILED_RETRYABLE' : result.lifecycle,
        );
        return {
          index: i,
          checkpoint: {
            decisionId: row.decisionId,
            positionHash: result.positionHash,
            lifecycle: nextLife,
            tierReached: result.tier,
            evaluation: result.evaluation,
            updatedAt: clock,
            attemptCount: row.attemptCount + 1,
          },
        };
      }),
    );

    // Apply in original index order within the wave.
    waveResults.sort((a, b) => a.index - b.index);
    for (const item of waveResults) {
      decisions[item.index] = item.checkpoint;
      if (item.checkpoint.lifecycle === 'SCORED' || item.checkpoint.lifecycle === 'FORCED') {
        newlyCompleted += 1;
      }
      worked += 1;
    }

    const checkpoint: ReviewCompletionJobRecord = {
      ...claimed,
      status: 'running',
      updatedAt: clock,
      decisions: [...decisions],
      claimToken: options.claimToken,
      claimGeneration,
      nextAttemptAt: clock + leaseMs,
      leaseExpiresAt: clock + leaseMs,
    };
    const persisted = await persistCheckpoint(
      options.store,
      checkpoint,
      options.claimToken,
      claimGeneration,
      leaseMs,
    );
    if (!persisted) {
      const current = await options.store.get(options.jobId);
      return {
        job: current ?? checkpoint,
        newlyCompleted,
        interrupted: true,
        claimLost: true,
      };
    }

    if (options.dieAfterDecisions !== undefined && worked >= options.dieAfterDecisions) {
      return {
        job: persisted,
        newlyCompleted,
        interrupted: true,
      };
    }
  }

  const finalDecisions = decisions;
  const resolvedIds = finalDecisions.filter((d) => d.lifecycle === 'SCORED' || d.lifecycle === 'FORCED').map((d) => d.decisionId);
  const decisionIds = finalDecisions.map((d) => d.decisionId);
  const expected = new Set(claimed.expectedDecisionIds);
  const exactCoverage = expected.size === claimed.expectedDecisionIds.length
    && new Set(decisionIds).size === expected.size
    && decisionIds.every((id) => expected.has(id))
    && resolvedIds.length === expected.size
    && new Set(resolvedIds).size === expected.size
    && resolvedIds.every((id) => expected.has(id))
    && finalDecisions.length === expected.size;
  const allDone = exactCoverage && finalDecisions.every((d) => d.lifecycle === 'SCORED' || d.lifecycle === 'FORCED');
  const anyFatal = finalDecisions.some((d) => d.lifecycle === 'FAILED_FATAL');
  const evaluations = finalDecisions
    .map((d) => d.evaluation)
    .filter((e): e is ReviewEvaluationV1 => e !== null);

  let accuracyModelResult: ReturnType<typeof computeGameAccuracyModel> | null = null;
  if (allDone) {
    accuracyModelResult = computeGameAccuracyModel(evaluations);
  }

  const pendingRetry = finalDecisions.some(
    (d) => d.lifecycle === 'PENDING' || d.lifecycle === 'SEARCHING' || d.lifecycle === 'FAILED_RETRYABLE',
  );
  const maxAttempt = Math.max(0, ...finalDecisions.map((d) => d.attemptCount));

  const finished: ReviewCompletionJobRecord = {
    ...claimed,
    status: allDone
      ? 'complete'
      : anyFatal && !pendingRetry
        ? 'failed_fatal'
        : interrupted || pendingRetry
          ? 'pending'
          : 'running',
    updatedAt: clock,
    decisions: finalDecisions,
    accuracyModelResult,
    claimToken: allDone || (anyFatal && !pendingRetry) || interrupted || pendingRetry
      ? null
      : options.claimToken,
    claimGeneration,
    leaseExpiresAt: allDone || (anyFatal && !pendingRetry) ? null : clock + leaseMs,
    nextAttemptAt:
      allDone || (anyFatal && !pendingRetry)
        ? clock
        : clock + backoffMs(maxAttempt),
  };
  const persistedFinal = await persistCheckpoint(
    options.store,
    finished,
    options.claimToken,
    claimGeneration,
    leaseMs,
  );
  if (!persistedFinal) {
    const current = await options.store.get(options.jobId);
    return {
      job: current ?? finished,
      newlyCompleted,
      interrupted: true,
      claimLost: true,
    };
  }
  return { job: persistedFinal, newlyCompleted, interrupted };
}

export function jobAuthoritativeComplete(job: ReviewCompletionJobRecord): boolean {
  if (job.status !== 'complete') return false;
  if (job.decisions.length === 0 || new Set(job.expectedDecisionIds).size !== job.expectedDecisionIds.length) return false;
  const decisionIds = job.decisions.map((d) => d.decisionId);
  if (new Set(decisionIds).size !== decisionIds.length) return false;
  const forced = job.decisions.filter((d) => d.lifecycle === 'FORCED').length;
  const scored = job.decisions.filter((d) => d.lifecycle === 'SCORED').length;
  const counts = job.decisions.map((d) => d.lifecycle);
  const everyResolvedDecisionHasEvaluation = job.decisions.every((decision) =>
    decision.evaluation !== null
      && (decision.lifecycle === 'FORCED'
        ? isForcedDecision(decision.evaluation.candidates)
          && decision.evaluation.evaluationProvenance?.lifecycle === 'FORCED'
        : decision.lifecycle === 'SCORED'
          && !isForcedDecision(decision.evaluation.candidates)
          && ['exact', 'search'].includes(decision.evaluation.evidence.source)
          && decision.evaluation.evaluationProvenance?.lifecycle === 'SCORED'),
  );
  return job.decisions.length === job.expectedDecisionIds.length
    && forced + scored === job.expectedDecisionIds.length
    && job.decisions.every((d) => job.expectedDecisionIds.includes(d.decisionId))
    && counts.every((lifecycle) => lifecycle === 'FORCED' || lifecycle === 'SCORED')
    && everyResolvedDecisionHasEvaluation;
}

export function finalArtifactFromJob(job: ReviewCompletionJobRecord): {
  readonly evaluations: readonly ReviewEvaluationV1[];
  readonly accuracyModelResult: ReturnType<typeof computeGameAccuracyModel> | null;
  readonly positionHashes: readonly string[];
  readonly lifecycles: readonly ReviewDecisionLifecycle[];
} {
  if (!jobAuthoritativeComplete(job)) {
    throw new Error('Cannot produce a final review artifact before exact decision coverage completes');
  }
  return {
    evaluations: job.decisions.map((d) => d.evaluation!).filter(Boolean),
    accuracyModelResult: job.accuracyModelResult,
    positionHashes: job.decisions.map((d) => d.positionHash),
    lifecycles: job.decisions.map((d) => d.lifecycle),
  };
}
