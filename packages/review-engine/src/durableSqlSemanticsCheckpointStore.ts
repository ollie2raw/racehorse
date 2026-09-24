/**
 * In-process durable store that mirrors the Postgres claim/checkpoint RPC
 * predicates in supabase/migrations/2026-09-23_review_completion_jobs_claim_rpc.sql.
 *
 * Used for multi-worker / process-death integration tests without a live
 * Supabase. Production authority remains SupabaseCheckpointStore (server),
 * which calls the same RPCs.
 */
import type {
  CheckpointStore,
  ReviewCompletionJobRecord,
} from './durableReviewCompletionRuntime';

export class SqlSemanticsCheckpointStore implements CheckpointStore {
  private readonly rows = new Map<string, ReviewCompletionJobRecord>();
  private readonly byDigest = new Map<string, string>();
  /** Simulate transient repository errors (Part B-E). */
  failNextMutations = 0;
  /** Count of successful claim recoveries after expired lease. */
  recoveredClaims = 0;

  async get(jobId: string): Promise<ReviewCompletionJobRecord | null> {
    return this.rows.get(jobId) ?? null;
  }

  async getByGameDigest(
    gameDigest: string,
    userId?: string | null,
  ): Promise<ReviewCompletionJobRecord | null> {
    const key = `${userId ?? 'anon'}:${gameDigest}`;
    const id = this.byDigest.get(key);
    return id ? (this.rows.get(id) ?? null) : null;
  }

  async put(job: ReviewCompletionJobRecord): Promise<void> {
    this.maybeFail();
    const existing = this.rows.get(job.jobId);
    // Immutable completed artifact — refuse demotion.
    if (existing?.status === 'complete' && job.status !== 'complete') {
      return;
    }
    // Unique (user_id, game_digest): do not create a parallel authoritative job.
    const digestKey = `${job.userId ?? 'anon'}:${job.gameDigest}`;
    const existingId = this.byDigest.get(digestKey);
    if (existingId && existingId !== job.jobId) {
      return;
    }
    this.rows.set(job.jobId, {
      ...job,
      claimGeneration: job.claimGeneration ?? existing?.claimGeneration ?? 0,
    });
    this.byDigest.set(digestKey, job.jobId);
  }

  async claim(
    jobId: string,
    claimToken: string,
    now: number,
    leaseMs = 60_000,
  ): Promise<ReviewCompletionJobRecord | null> {
    this.maybeFail();
    const job = this.rows.get(jobId);
    if (!job) return null;
    // Mirrors claim_review_completion_job WHERE:
    // status in (pending, running) AND (token null OR same OR lease expired)
    if (job.status !== 'pending' && job.status !== 'running') return null;
    const leaseExpired =
      job.leaseExpiresAt == null || job.leaseExpiresAt <= now;
    const mayClaim =
      job.claimToken == null
      || job.claimToken === claimToken
      || leaseExpired;
    if (!mayClaim) return null;

    if (job.claimToken != null && job.claimToken !== claimToken && leaseExpired) {
      this.recoveredClaims += 1;
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
    this.rows.set(jobId, claimed);
    return claimed;
  }

  async checkpoint(
    job: ReviewCompletionJobRecord,
    claimToken: string,
    claimGeneration: number,
    leaseMs = 60_000,
  ): Promise<ReviewCompletionJobRecord | null> {
    this.maybeFail();
    const current = this.rows.get(job.jobId);
    if (!current) return null;
    // Mirrors checkpoint_review_completion_job WHERE:
    // claim_token = p AND claim_generation = p AND status in (pending, running)
    if (current.claimToken !== claimToken) return null;
    if ((current.claimGeneration ?? 0) !== claimGeneration) return null;
    if (current.status !== 'pending' && current.status !== 'running') {
      // Already terminal — return immutable row.
      return current;
    }

    const now = Date.now();
    const terminal = job.status === 'complete' || job.status === 'failed_fatal';
    const next: ReviewCompletionJobRecord = {
      ...job,
      claimToken: terminal ? null : claimToken,
      claimGeneration,
      updatedAt: now,
      // Honor explicit lease/nextAttempt from the worker when provided.
      leaseExpiresAt: terminal
        ? null
        : (job.leaseExpiresAt ?? now + leaseMs),
      nextAttemptAt: job.nextAttemptAt,
      snapshots: job.status === 'complete' ? [] : job.snapshots,
    };
    this.rows.set(job.jobId, next);
    return next;
  }

  async listClaimable(now: number, limit = 8): Promise<readonly ReviewCompletionJobRecord[]> {
    return [...this.rows.values()]
      .filter((j) => {
        if (j.status !== 'pending' && j.status !== 'running') return false;
        if (j.nextAttemptAt > now) return false;
        return (
          j.leaseExpiresAt == null
          || j.leaseExpiresAt <= now
          || j.claimToken == null
        );
      })
      .sort((a, b) => a.nextAttemptAt - b.nextAttemptAt || a.createdAt - b.createdAt)
      .slice(0, limit);
  }

  private maybeFail(): void {
    if (this.failNextMutations > 0) {
      this.failNextMutations -= 1;
      throw new Error('simulated durable repository transient error');
    }
  }
}
