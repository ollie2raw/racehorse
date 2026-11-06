/**
 * A review that sat at "Analyzing 0 / 50" with the sweep switched on was undiagnosable: a missing database function (an unapplied migration) failed the
 * claim inside the sweep, was logged at warn as "will retry", and the player saw a job that never moved. These pin that the cause is named, kept, and
 * reachable from /health and the job route.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  REVIEW_DATABASE_FUNCTIONS,
  classifyReviewError,
  getReviewSweepStatus,
  jobStage,
  noteReviewSweepError,
  noteReviewSweepTick,
  probeReviewDatabase,
  resetReviewSweepStatusForTests,
} from './reviewSweepStatus';

const missingFunction = (name: string) =>
  new Error(`Supabase request failed: 404 {"code":"PGRST202","details":"Searched for the function public.${name} with parameters p_job_id","hint":null,"message":"Could not find the function public.${name}(p_job_id) in the schema cache"}`);

beforeEach(() => resetReviewSweepStatusForTests());

describe('classifyReviewError', () => {
  it('names a missing database function and which one', () => {
    expect(classifyReviewError(missingFunction('claim_review_completion_job_v2'))).toEqual({
      code: 'rpc_missing',
      detail: 'claim_review_completion_job_v2',
    });
  });

  it('names a missing table or column as a schema problem', () => {
    expect(classifyReviewError(new Error('Supabase request failed: 404 {"code":"42P01","message":"relation \\"public.review_completion_jobs\\" does not exist"}')).code).toBe('schema_missing');
    expect(classifyReviewError(new Error('Supabase request failed: 400 {"code":"42703","message":"column review_completion_jobs.attempt_count does not exist"}')).code).toBe('schema_missing');
  });

  it('names a permission failure', () => {
    expect(classifyReviewError(new Error('Supabase request failed: 401 {"message":"permission denied for function claim_review_completion_job_v2"}')).code).toBe('permission_denied');
  });

  it('names a search worker that could not start or died', () => {
    expect(classifyReviewError(new Error("review search worker error: Cannot find module '@racehorse/review-engine'")).code).toBe('worker_failed');
    expect(classifyReviewError(new Error('review search worker exited (code 1)')).code).toBe('worker_failed');
  });

  it('names a timeout and falls back to a generic database error', () => {
    expect(classifyReviewError(new Error('Supabase request timed out after 8000ms: /rest/v1/rpc/x')).code).toBe('db_timeout');
    expect(classifyReviewError(new Error('Supabase request failed: 500 boom')).code).toBe('db_error');
    expect(classifyReviewError('nope').code).toBe('unknown');
  });
});

describe('review sweep status', () => {
  it('starts empty', () => {
    expect(getReviewSweepStatus()).toMatchObject({ ticks: 0, lastTickAt: null, lastErrorCode: null, lastErrorAt: null, database: null });
  });

  it('records ticks and the last job claimed', () => {
    noteReviewSweepTick(1_000, { ran: 1, completed: 0, jobId: 'job-1' });
    expect(getReviewSweepStatus()).toMatchObject({ ticks: 1, lastTickAt: 1_000, lastJobId: 'job-1', lastRan: 1 });
  });

  it('keeps the last error with its code, detail and time, and a later good tick does not erase it', () => {
    noteReviewSweepError(missingFunction('claim_review_completion_job_v2'), 2_000);
    noteReviewSweepTick(3_000, { ran: 0, completed: 0 });
    expect(getReviewSweepStatus()).toMatchObject({
      lastErrorCode: 'rpc_missing',
      lastErrorDetail: 'claim_review_completion_job_v2',
      lastErrorAt: 2_000,
      lastTickAt: 3_000,
    });
  });

  it('does not put raw error text, which can carry ids, into the public status', () => {
    noteReviewSweepError(new Error('Supabase request failed: 500 secret-token-abc'), 1);
    expect(JSON.stringify(getReviewSweepStatus())).not.toContain('secret-token-abc');
  });
});

describe('probeReviewDatabase', () => {
  it('lists the functions the sweep needs that the database does not have', async () => {
    const fetchImpl = async (path: string) => {
      const name = REVIEW_DATABASE_FUNCTIONS.find((candidate) => path.includes(`/rpc/${candidate}`));
      if (name === 'claim_review_completion_job_v2' || name === 'renew_review_completion_lease') throw missingFunction(name);
      return [] as never;
    };
    const result = await probeReviewDatabase(fetchImpl, 5_000);
    expect(result).toEqual({ ok: false, missing: ['claim_review_completion_job_v2', 'renew_review_completion_lease'], checkedAt: 5_000 });
    expect(getReviewSweepStatus().database).toEqual(result);
    expect(getReviewSweepStatus().lastErrorCode).toBe('rpc_missing');
  });

  it('is ok when every function answers', async () => {
    const result = await probeReviewDatabase(async () => [] as never, 7_000);
    expect(result).toEqual({ ok: true, missing: [], checkedAt: 7_000 });
    expect(getReviewSweepStatus().lastErrorCode).toBeNull();
  });

  it('does not call a failure that is not "function missing" a missing function', async () => {
    const result = await probeReviewDatabase(async () => { throw new Error('Supabase request timed out after 8000ms: x'); }, 9_000);
    expect(result.missing).toEqual([]);
    expect(result.ok).toBe(false);
  });
});

describe('jobStage', () => {
  const base = { status: 'pending', attemptCount: 0, leaseExpiresAt: null, claimToken: null } as const;
  it('says queued until a pass has claimed the job', () => {
    expect(jobStage({ ...base }, 1_000)).toBe('queued');
  });
  it('says running while a live lease is held', () => {
    expect(jobStage({ ...base, status: 'running', attemptCount: 1, claimToken: 't', leaseExpiresAt: 5_000 }, 1_000)).toBe('running');
  });
  it('goes back to queued when the lease lapsed (waiting for a retry)', () => {
    expect(jobStage({ ...base, status: 'running', attemptCount: 1, claimToken: 't', leaseExpiresAt: 500 }, 1_000)).toBe('queued');
  });
  it('maps terminal states', () => {
    expect(jobStage({ ...base, status: 'complete' }, 1)).toBe('complete');
    expect(jobStage({ ...base, status: 'failed_fatal' }, 1)).toBe('failed');
  });
});
