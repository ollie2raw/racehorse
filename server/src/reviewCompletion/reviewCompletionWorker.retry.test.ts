import express from 'express';
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { REVIEW_FIXTURE_CORPUS } from '../../../packages/game-core/src/reviewFixtureCorpus';
import {
  InMemoryCheckpointStore,
  createReviewCompletionJob,
  type ReviewCompletionJobRecord,
} from '../../../packages/review-engine/src/durableReviewCompletionRuntime';
import {
  REVIEW_RETRY_COOLDOWN_MS,
  registerReviewCompletionJobsRoute,
  retryReviewCompletionJob,
  setReviewCompletionStoreForTests,
} from './reviewCompletionWorker';

const OWNER = 'review-retry-owner';
let requestUser: string | null = OWNER;

vi.mock('../platform/auth/supabaseAuth', () => ({
  getAuthenticatedUserId: async () => requestUser,
}));

const snapshots = REVIEW_FIXTURE_CORPUS.slice(0, 2).map((entry) => entry.snapshot);
const expectedDecisionIds = snapshots.map((snapshot) => snapshot.identifiers.decisionId);
const FAILED_AT = 1_000_000;

function failedJob(overrides: Partial<ReviewCompletionJobRecord> = {}): ReviewCompletionJobRecord {
  const base = createReviewCompletionJob({
    gameDigest: 'retry-digest',
    sourceMatchId: 'retry-match',
    userId: OWNER,
    snapshots,
    expectedDecisionIds,
    now: FAILED_AT - 5_000,
  });
  return { ...base, status: 'failed_fatal', failureReason: 'max_attempts_exceeded', attemptCount: 5, updatedAt: FAILED_AT, ...overrides };
}

describe('retrying a failed review job', () => {
  const store = new InMemoryCheckpointStore();

  beforeEach(() => {
    requestUser = OWNER;
    setReviewCompletionStoreForTests(store);
  });

  it('restarts a failed job from its stored positions, with the attempt count reset', async () => {
    const job = failedJob();
    await store.put(job);
    const result = await retryReviewCompletionJob({ userId: OWNER, jobId: job.jobId, now: FAILED_AT + REVIEW_RETRY_COOLDOWN_MS });
    expect(result.kind).toBe('restarted');
    if (result.kind !== 'restarted') return;
    expect(result.job.status).toBe('pending');
    expect(result.job.attemptCount ?? 0).toBe(0);
    expect(result.job.failureReason ?? null).toBeNull();
    expect(result.job.expectedDecisionIds).toEqual(expectedDecisionIds);
    expect(result.job.snapshots.map((s) => s.identifiers.decisionId)).toEqual(expectedDecisionIds);
    const stored = await store.get(job.jobId);
    expect(stored?.status).toBe('pending');
  });

  it('keeps decisions that already finished and re-runs only the rest', async () => {
    const base = failedJob();
    const scored = base.decisions.map((decision, index) => (index === 0
      ? { ...decision, lifecycle: 'SCORED' as const, tierReached: 2 as const }
      : decision));
    await store.put({ ...base, decisions: scored });
    const result = await retryReviewCompletionJob({ userId: OWNER, jobId: base.jobId, now: FAILED_AT + REVIEW_RETRY_COOLDOWN_MS });
    expect(result.kind).toBe('restarted');
    if (result.kind !== 'restarted') return;
    expect(result.job.decisions[0]?.lifecycle).toBe('SCORED');
    expect(result.job.decisions[0]?.tierReached).toBe(2);
    expect(result.job.decisions[1]?.lifecycle).toBe('PENDING');
  });

  it('makes the caller wait out the cooldown', async () => {
    const job = failedJob();
    await store.put(job);
    const result = await retryReviewCompletionJob({ userId: OWNER, jobId: job.jobId, now: FAILED_AT + 10_000 });
    expect(result.kind).toBe('cooldown');
    if (result.kind !== 'cooldown') return;
    expect(result.retryAfterMs).toBe(REVIEW_RETRY_COOLDOWN_MS - 10_000);
    expect((await store.get(job.jobId))?.status).toBe('failed_fatal');
  });

  it('does nothing for a job that is not failed', async () => {
    const pending = failedJob({ status: 'pending', failureReason: null });
    await store.put(pending);
    const result = await retryReviewCompletionJob({ userId: OWNER, jobId: pending.jobId, now: FAILED_AT + REVIEW_RETRY_COOLDOWN_MS });
    expect(result.kind).toBe('not_failed');
  });

  it("never touches another user's job", async () => {
    const job = failedJob();
    await store.put(job);
    const result = await retryReviewCompletionJob({ userId: 'someone-else', jobId: job.jobId, now: FAILED_AT + REVIEW_RETRY_COOLDOWN_MS });
    expect(result.kind).toBe('not_found');
    expect((await store.get(job.jobId))?.status).toBe('failed_fatal');
  });

  it('reports an unknown job as not found', async () => {
    const result = await retryReviewCompletionJob({ userId: OWNER, jobId: 'no-such-job' });
    expect(result.kind).toBe('not_found');
  });
});

describe('POST /api/review-completion-jobs/:jobId/retry', () => {
  let server: Server;
  let apiBase: string;
  const store = new InMemoryCheckpointStore();

  beforeAll(async () => {
    vi.stubEnv('REVIEW_SWEEP_ENABLED', 'false');
    setReviewCompletionStoreForTests(store);
    const app = express();
    app.use(express.json({ limit: '2mb' }));
    registerReviewCompletionJobsRoute(app);
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test HTTP server did not bind');
    apiBase = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  beforeEach(() => {
    requestUser = OWNER;
    setReviewCompletionStoreForTests(store);
  });

  it('requires a signed-in user', async () => {
    requestUser = null;
    const response = await fetch(`${apiBase}/api/review-completion-jobs/anything/retry`, { method: 'POST' });
    expect(response.status).toBe(401);
  });

  it('answers 404 for a job that is not the caller\'s', async () => {
    const job = failedJob({ updatedAt: 1 });
    await store.put(job);
    requestUser = 'someone-else';
    const response = await fetch(`${apiBase}/api/review-completion-jobs/${job.jobId}/retry`, { method: 'POST' });
    expect(response.status).toBe(404);
  });

  it('restarts an old failed job and answers 202', async () => {
    const job = failedJob({ updatedAt: 1 });
    await store.put(job);
    const response = await fetch(`${apiBase}/api/review-completion-jobs/${job.jobId}/retry`, { method: 'POST' });
    expect(response.status).toBe(202);
    const body = await response.json() as { restarted: boolean; status: string };
    expect(body.restarted).toBe(true);
    expect(body.status).toBe('pending');
  });

  it('answers 429 with Retry-After during the cooldown', async () => {
    const job = failedJob({ updatedAt: Date.now() });
    await store.put(job);
    const response = await fetch(`${apiBase}/api/review-completion-jobs/${job.jobId}/retry`, { method: 'POST' });
    expect(response.status).toBe(429);
    expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0);
  });
});
