import express from 'express';
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { REVIEW_FIXTURE_CORPUS } from '../../../packages/game-core/src/reviewFixtureCorpus';
import { evaluateReviewPosition } from '../../../packages/review-engine/src/evaluateReviewPosition';
import {
  InMemoryCheckpointStore,
  jobAuthoritativeComplete,
} from '../../../packages/review-engine/src/durableReviewCompletionRuntime';
import {
  registerReviewCompletionJobsRoute,
  setReviewCompletionStoreForTests,
} from './reviewCompletionWorker';

vi.mock('../platform/auth/supabaseAuth', () => ({
  getAuthenticatedUserId: async () => 'review-integration-user',
}));
vi.mock('../reviewPersistence/gameReviewCohort', () => ({
  isGameReviewCohortUser: () => false,
}));
describe('deployed review completion HTTP flow', () => {
  let server: Server;
  let apiBase: string;
  const store = new InMemoryCheckpointStore();

  beforeAll(async () => {
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
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it('creates by authenticated HTTP, checkpoints in the worker, and polls persisted completion', async () => {
    const snapshot = REVIEW_FIXTURE_CORPUS[0]!.snapshot;
    const evaluation = evaluateReviewPosition(snapshot, {
      maxNodes: 8_000,
      maxHiddenStateSamples: 2,
      maxPlyDepth: 1,
      seed: 'pvf-http-integration',
      maxWallClockMs: 150,
    }, 0.02);
    const decisionId = snapshot.identifiers.decisionId;
    const createResponse = await fetch(`${apiBase}/api/review-completion-jobs`, {
      method: 'POST',
      headers: { Authorization: 'Bearer integration-session', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gameDigest: `http-integration-${Date.now()}`,
        sourceMatchId: 'safe-integration-match',
        snapshots: [snapshot],
        expectedDecisionIds: [decisionId],
        evaluations: [{ ...evaluation, snapshotId: decisionId }],
      }),
    });
    expect(createResponse.status).toBe(202);
    const created = await createResponse.json() as { jobId: string; progress: { total: number } };
    expect(created.progress.total).toBe(1);

    let status: Response | null = null;
    let result: {
      complete: boolean;
      status: string;
      progress: { total: number; scored: number; forced: number; remaining: number };
      evaluations?: readonly unknown[];
    } | null = null;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      status = await fetch(`${apiBase}/api/review-completion-jobs/${encodeURIComponent(created.jobId)}`, {
        headers: { Authorization: 'Bearer integration-session' },
      });
      result = await status.json() as typeof result;
      if (result?.complete) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(status?.status).toBe(200);
    const persisted = await store.get(created.jobId);
    expect(result?.complete).toBe(true);
    expect(result?.status).toBe('complete');
    expect(result!.progress.scored + result!.progress.forced).toBe(1);
    expect(result!.progress.remaining).toBe(0);
    expect(result!.evaluations).toHaveLength(1);
    expect(persisted).not.toBeNull();
    expect(jobAuthoritativeComplete(persisted!)).toBe(true);
    expect(persisted!.decisions[0]?.attemptCount).toBeGreaterThanOrEqual(0);
  });
});
