/**
 * Postgres/Supabase-backed CheckpointStore — production authority for
 * review_completion_jobs. Uses claim/checkpoint RPCs for CAS lease semantics.
 */
import type {
  CheckpointStore,
  ReviewCompletionJobRecord,
} from '@racehorse/review-engine';
import {
  REVIEW_COMPLETION_LEASE_MS,
} from '@racehorse/review-engine';
import { supabaseFetch } from '../supabaseUtils';
import { childLogger } from '../logger';

const log = childLogger('review-completion-store');

type JobRow = {
  id: string;
  user_id: string | null;
  game_digest: string;
  source_match_id: string;
  status: ReviewCompletionJobRecord['status'];
  job_payload: ReviewCompletionJobRecord;
  claim_token: string | null;
  claim_generation: number;
  lease_expires_at: string | null;
  next_attempt_at: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

function rowToRecord(row: JobRow): ReviewCompletionJobRecord {
  const payload = row.job_payload;
  return {
    ...payload,
    jobId: row.id,
    userId: row.user_id,
    gameDigest: row.game_digest,
    sourceMatchId: row.source_match_id,
    status: row.status,
    claimToken: row.claim_token,
    claimGeneration: row.claim_generation,
    leaseExpiresAt: row.lease_expires_at ? Date.parse(row.lease_expires_at) : null,
    nextAttemptAt: Date.parse(row.next_attempt_at),
    createdAt: Date.parse(row.created_at),
    updatedAt: Date.parse(row.updated_at),
  };
}

function recordToPayload(job: ReviewCompletionJobRecord): ReviewCompletionJobRecord {
  // Persist full semantic job; table columns mirror identity/status/lease.
  return {
    ...job,
    // Snapshots cleared after complete to save storage (evaluations remain).
    snapshots:
      job.status === 'complete'
        ? []
        : job.snapshots,
  };
}

export class SupabaseCheckpointStore implements CheckpointStore {
  async get(jobId: string): Promise<ReviewCompletionJobRecord | null> {
    const rows = await supabaseFetch<JobRow[]>(
      `/rest/v1/review_completion_jobs?id=eq.${encodeURIComponent(jobId)}&select=*`,
      { method: 'GET' },
    );
    const row = rows?.[0];
    return row ? rowToRecord(row) : null;
  }

  async getByGameDigest(
    gameDigest: string,
    userId?: string | null,
  ): Promise<ReviewCompletionJobRecord | null> {
    const userFilter =
      userId === undefined || userId === null
        ? 'user_id=is.null'
        : `user_id=eq.${encodeURIComponent(userId)}`;
    const rows = await supabaseFetch<JobRow[]>(
      `/rest/v1/review_completion_jobs?${userFilter}&game_digest=eq.${encodeURIComponent(gameDigest)}&select=*&order=created_at.desc&limit=1`,
      { method: 'GET' },
    );
    const row = rows?.[0];
    return row ? rowToRecord(row) : null;
  }

  async put(job: ReviewCompletionJobRecord): Promise<void> {
    const existing = await this.get(job.jobId);
    if (existing?.status === 'complete' && job.status !== 'complete') {
      return;
    }
    const body = {
      id: job.jobId,
      user_id: job.userId,
      game_digest: job.gameDigest,
      source_match_id: job.sourceMatchId,
      status: job.status,
      job_payload: recordToPayload(job),
      claim_token: job.claimToken,
      claim_generation: job.claimGeneration ?? existing?.claimGeneration ?? 0,
      lease_expires_at:
        job.leaseExpiresAt != null ? new Date(job.leaseExpiresAt).toISOString() : null,
      next_attempt_at: new Date(job.nextAttemptAt).toISOString(),
      updated_at: new Date(job.updatedAt).toISOString(),
      completed_at: job.status === 'complete' ? new Date().toISOString() : null,
    };

    if (!existing) {
      await supabaseFetch('/rest/v1/review_completion_jobs?on_conflict=id', {
        method: 'POST',
        headers: { Prefer: 'return=minimal,resolution=ignore-duplicates' },
        body: JSON.stringify(body),
      });
      // If ignore-duplicates raced, re-read; do not overwrite complete.
      const after = await this.get(job.jobId);
      if (!after) {
        // Rare: insert ignored and get missed — force merge.
        await supabaseFetch(`/rest/v1/review_completion_jobs?id=eq.${encodeURIComponent(job.jobId)}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify(body),
        });
      }
      return;
    }

    await supabaseFetch(`/rest/v1/review_completion_jobs?id=eq.${encodeURIComponent(job.jobId)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(body),
    });
  }

  async claim(
    jobId: string,
    claimToken: string,
    _now: number,
    leaseMs = REVIEW_COMPLETION_LEASE_MS,
  ): Promise<ReviewCompletionJobRecord | null> {
    try {
      const rows = await supabaseFetch<JobRow[]>(
        '/rest/v1/rpc/claim_review_completion_job',
        {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({
            p_job_id: jobId,
            p_claim_token: claimToken,
            p_lease_ms: leaseMs,
          }),
        },
      );
      // RPC returns a single row object or null depending on PostgREST wrapping.
      const row = Array.isArray(rows) ? rows[0] : (rows as unknown as JobRow | null);
      if (!row || !row.id) return null;
      return rowToRecord(row);
    } catch (error) {
      log.warn({ err: error, jobId }, 'claim RPC failed');
      throw error;
    }
  }

  async checkpoint(
    job: ReviewCompletionJobRecord,
    claimToken: string,
    claimGeneration: number,
    leaseMs = REVIEW_COMPLETION_LEASE_MS,
  ): Promise<ReviewCompletionJobRecord | null> {
    const rows = await supabaseFetch<JobRow[]>(
      '/rest/v1/rpc/checkpoint_review_completion_job',
      {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          p_job_id: job.jobId,
          p_claim_token: claimToken,
          p_claim_generation: claimGeneration,
          p_job_payload: recordToPayload(job),
          p_status: job.status,
          p_lease_ms: leaseMs,
          p_next_attempt_at: new Date(job.nextAttemptAt).toISOString(),
        }),
      },
    );
    const row = Array.isArray(rows) ? rows[0] : (rows as unknown as JobRow | null);
    if (!row || !row.id) return null;
    return rowToRecord(row);
  }

  async listClaimable(_now: number, limit = 8): Promise<readonly ReviewCompletionJobRecord[]> {
    const rows = await supabaseFetch<JobRow[]>(
      '/rest/v1/rpc/list_claimable_review_completion_jobs',
      {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ p_limit: limit }),
      },
    );
    const list = Array.isArray(rows) ? rows : rows ? [rows as unknown as JobRow] : [];
    return list.filter((r) => r?.id).map(rowToRecord);
  }
}
