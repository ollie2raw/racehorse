import express from 'express';
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { REVIEW_FIXTURE_CORPUS } from '../../../packages/game-core/src/reviewFixtureCorpus';
import { InMemoryCheckpointStore } from '../../../packages/review-engine/src/durableReviewCompletionRuntime';
import {
  enqueueReviewCompletionJob,
  registerReviewCompletionJobsRoute,
  setReviewCompletionStoreForTests,
  takeReviewFunnel,
} from './reviewCompletionWorker';

const auth = vi.hoisted(() => ({ userId: 'funnel-user' as string | null }));
vi.mock('../platform/auth/supabaseAuth', () => ({
  getAuthenticatedUserId: async () => auth.userId,
}));

describe('review funnel counters', () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    vi.stubEnv('REVIEW_SWEEP_ENABLED', undefined);
    setReviewCompletionStoreForTests(new InMemoryCheckpointStore());
    const app = express();
    app.use(express.json());
    registerReviewCompletionJobsRoute(app);
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no port');
    base = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const post = (body: unknown) => fetch(`${base}/api/review-completion-jobs/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' },
    body: JSON.stringify(body),
  });

  it('counts eligible and opened from the client, started when a job is first created', async () => {
    takeReviewFunnel();
    expect((await post({ event: 'eligible', sourceMatchId: 'm' })).status).toBe(204);
    expect((await post({ event: 'opened', sourceMatchId: 'm' })).status).toBe(204);
    const snapshot = REVIEW_FIXTURE_CORPUS[0]!.snapshot;
    const input = {
      userId: 'funnel-user', gameDigest: `funnel-${Date.now()}`, sourceMatchId: 'm',
      snapshots: [snapshot], expectedDecisionIds: [snapshot.identifiers.decisionId],
    };
    await enqueueReviewCompletionJob(input);
    await enqueueReviewCompletionJob(input); // same game: existing job, not a new start
    expect(takeReviewFunnel()).toEqual({ eligible: 1, started: 1, opened: 1 });
    expect(takeReviewFunnel()).toEqual({ eligible: 0, started: 0, opened: 0 });
  });

  it('rejects unknown events and unauthenticated callers', async () => {
    expect((await post({ event: 'started' })).status).toBe(400);
    auth.userId = null;
    expect((await post({ event: 'opened' })).status).toBe(401);
    auth.userId = 'funnel-user';
    expect(takeReviewFunnel()).toEqual({ eligible: 0, started: 0, opened: 0 });
  });
});
