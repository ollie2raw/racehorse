/**
 * The production failure: REVIEW_SWEEP_ENABLED=true, the job is accepted, and it stays at "0 of N" forever. The database's claim function comes from a migration
 * the owner applies by hand; when it is missing every claim fails inside the sweep. Before, that was logged at warn as "will retry" and nothing else changed, so
 * neither the player's card nor /health could say why. This reproduces it with a store whose claim says what PostgREST says for a missing function.
 */
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { REVIEW_FIXTURE_CORPUS } from '../../../packages/game-core/src/reviewFixtureCorpus';
import { InMemoryCheckpointStore } from '../../../packages/review-engine/src/durableReviewCompletionRuntime';
import {
  enqueueReviewCompletionJob,
  registerReviewCompletionJobsRoute,
  setReviewCompletionStoreForTests,
  stopReviewCompletionSweepForTests,
  sweepReviewCompletionJobs,
} from './reviewCompletionWorker';
import { getReviewSweepStatus, resetReviewSweepStatusForTests } from './reviewSweepStatus';

vi.mock('../platform/auth/supabaseAuth', () => ({ getAuthenticatedUserId: async () => 'missing-fn-user' }));

const MISSING = new Error('Supabase request failed: 404 {"code":"PGRST202","message":"Could not find the function public.claim_review_completion_job_v2(p_backoff_base_ms) in the schema cache"}');

let server: Server | null = null;
let apiBase = '';

async function getJob(jobId: string): Promise<{ status: number; body: Record<string, any> }> {
  if (!server) {
    const app = express();
    app.use(express.json());
    registerReviewCompletionJobsRoute(app);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server!.once('listening', () => resolve()));
    apiBase = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  }
  const response = await fetch(`${apiBase}/api/review-completion-jobs/${encodeURIComponent(jobId)}`, { headers: { Authorization: 'Bearer test' } });
  return { status: response.status, body: await response.json() };
}

describe('a sweep whose claim function is missing from the database', () => {
  afterEach(() => {
    stopReviewCompletionSweepForTests();
    resetReviewSweepStatusForTests();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  afterAll(() => { server?.close(); server = null; });

  async function stuckJob() {
    vi.stubEnv('REVIEW_SWEEP_ENABLED', 'true');
    resetReviewSweepStatusForTests();
    const store = new InMemoryCheckpointStore();
    vi.spyOn(store, 'claim').mockRejectedValue(MISSING);
    setReviewCompletionStoreForTests(store);
    const snapshot = REVIEW_FIXTURE_CORPUS[0]!.snapshot;
    const job = await enqueueReviewCompletionJob({
      userId: 'missing-fn-user',
      gameDigest: `missing-fn-${Date.now()}-${Math.random()}`,
      sourceMatchId: 'missing-fn-match',
      snapshots: [snapshot],
      expectedDecisionIds: [snapshot.identifiers.decisionId],
    });
    await sweepReviewCompletionJobs().catch(() => undefined);
    return job;
  }

  it('records why, as a code the owner can act on', async () => {
    await stuckJob();
    expect(getReviewSweepStatus()).toMatchObject({ lastErrorCode: 'rpc_missing', lastErrorDetail: 'claim_review_completion_job_v2' });
  });

  it('the job route says the job is queued (not running) and names the sweep error', async () => {
    const job = await stuckJob();
    const { status, body } = await getJob(job.jobId);
    expect(status).toBe(200);
    expect(body.stage).toBe('queued');
    expect(body.progress).toMatchObject({ scored: 0, remaining: 1 });
    expect(body.sweepError).toEqual({ code: 'rpc_missing', detail: 'claim_review_completion_job_v2' });
    expect(body.waitingMs).toBeGreaterThanOrEqual(0);
  });

  it('a healthy sweep reports no sweep error', async () => {
    vi.stubEnv('REVIEW_SWEEP_ENABLED', 'true');
    resetReviewSweepStatusForTests();
    const store = new InMemoryCheckpointStore();
    setReviewCompletionStoreForTests(store);
    const snapshot = REVIEW_FIXTURE_CORPUS[0]!.snapshot;
    const job = await enqueueReviewCompletionJob({
      userId: 'missing-fn-user',
      gameDigest: `healthy-${Date.now()}-${Math.random()}`,
      sourceMatchId: 'healthy-match',
      snapshots: [snapshot],
      expectedDecisionIds: [snapshot.identifiers.decisionId],
    });
    const { body } = await getJob(job.jobId);
    expect(body.sweepError).toBeNull();
  });
});
