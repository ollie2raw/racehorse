/**
 * Trust boundary of POST /api/review-completion-jobs: a hand-crafted authenticated request must NOT be able to change the
 * candidate set the review evaluates, nor inject pre-scored evaluations. Each case below is a real HTTP request against the
 * production route; the expected values are computed from the honest snapshot with the same evaluator.
 *
 *   1. omit the stronger legal move from snapshot.legalActions   (would turn a 13-point blunder into a "forced" move)
 *   2. add an illegal action to snapshot.legalActions
 *   3. replace the evaluation with a client-forged exact "loss 0" row
 *   4. tamper with the actor hand so the played tile is not held
 */
import express from 'express';
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ReviewEvaluationV1, ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import { REVIEW_FIXTURE_CORPUS } from '../../../packages/game-core/src/reviewFixtureCorpus';
import { adaptiveEvaluateReviewPosition } from '../../../packages/review-engine/src/adaptiveEvaluateReviewPosition';
import { InMemoryCheckpointStore } from '../../../packages/review-engine/src/durableReviewCompletionRuntime';
import {
  registerReviewCompletionJobsRoute,
  setReviewCompletionStoreForTests,
  setReviewPositionEvaluatorForTests,
} from './reviewCompletionWorker';

vi.mock('../platform/auth/supabaseAuth', () => ({ getAuthenticatedUserId: async () => 'trust-boundary-user' }));
vi.mock('../reviewPersistence/gameReviewCohort', () => ({ isGameReviewCohortUser: () => false }));

type JobView = {
  complete: boolean;
  status: string;
  evaluations?: ReviewEvaluationV1[];
  accuracyModelResult?: { accuracy: number | null } | null;
  captureFailures?: { decisionId: string; reason: string }[];
  progress: { total: number; scored: number; forced: number; failed?: number; remaining: number };
};

const honest: ReviewPositionSnapshotV2 = REVIEW_FIXTURE_CORPUS.find((f) => f.id === 'deliberately-poor-endgame-s78-a27')!.snapshot;

describe('review completion trust boundary (crafted requests)', () => {
  let server: Server;
  let base: string;
  const store = new InMemoryCheckpointStore();
  let counter = 0;

  beforeAll(async () => {
    vi.stubEnv('REVIEW_SWEEP_ENABLED', 'true');
    setReviewCompletionStoreForTests(store);
    setReviewPositionEvaluatorForTests((snapshot, options) => adaptiveEvaluateReviewPosition(snapshot, options));
    const app = express();
    app.use(express.json({ limit: '2mb' }));
    registerReviewCompletionJobsRoute(app);
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no port');
    base = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    setReviewPositionEvaluatorForTests(null);
    vi.unstubAllEnvs();
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  });

  async function submit(snapshot: unknown, extra: Record<string, unknown> = {}): Promise<JobView> {
    counter += 1;
    const decisionId = (snapshot as ReviewPositionSnapshotV2).identifiers.decisionId;
    const create = await fetch(`${base}/api/review-completion-jobs`, {
      method: 'POST',
      headers: { Authorization: 'Bearer crafted', 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameDigest: `crafted-${counter}-${Date.now()}`, sourceMatchId: 'crafted', snapshots: [snapshot], expectedDecisionIds: [decisionId], ...extra }),
    });
    expect(create.status).toBe(202);
    const { jobId } = await create.json() as { jobId: string };
    let view: JobView | null = null;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const res = await fetch(`${base}/api/review-completion-jobs/${encodeURIComponent(jobId)}`, { headers: { Authorization: 'Bearer crafted' } });
      view = await res.json() as JobView;
      if (view.complete || view.status === 'failed') break;
      await new Promise((r) => setTimeout(r, 25));
    }
    return view!;
  }

  const lossOf = (view: JobView) => view.evaluations?.[0]?.loss.expectedPointDifferential;

  it('baseline: the honest snapshot is a 13-point exact loss with two candidates', async () => {
    const view = await submit(honest);
    expect(view.complete).toBe(true);
    expect(lossOf(view)).toBe(13);
    expect(view.evaluations![0]!.candidates).toHaveLength(2);
  });

  it('omitting the stronger legal move cannot turn the blunder into a forced / zero-loss decision', async () => {
    const best = (await submit(honest)).evaluations![0]!.best.action;
    const forged = { ...honest, legalActions: honest.legalActions.filter((a) => JSON.stringify(a) !== JSON.stringify(best)) };
    expect(forged.legalActions).toHaveLength(1);
    const view = await submit(forged);
    expect(view.evaluations?.[0]?.candidates.length, 'the server must re-derive both legal actions').toBe(2);
    expect(lossOf(view)).toBe(13);
  });

  it('adding an illegal action cannot add a candidate', async () => {
    const illegal = { kind: 'play', tile: { low: 6, high: 6 }, position: 'left' };
    const forged = { ...honest, legalActions: [...honest.legalActions, illegal] };
    const view = await submit(forged);
    const keys = (view.evaluations?.[0]?.candidates ?? []).map((c) => JSON.stringify(c.action));
    expect(keys).not.toContain(JSON.stringify(illegal));
    expect(lossOf(view)).toBe(13);
  });

  it('a client-forged exact "loss 0" evaluation is not stored as the result', async () => {
    const real = (await submit(honest)).evaluations![0]!;
    const forgedEval = { ...real, snapshotId: honest.identifiers.decisionId, loss: { expectedPointDifferential: 0, winProbability: null }, played: real.best };
    const view = await submit(honest, { evaluations: [forgedEval] });
    expect(lossOf(view)).toBe(13);
  });

  it('a snapshot whose actor hand does not contain the played tile is rejected, not scored', async () => {
    const forged = { ...honest, preAction: { ...honest.preAction, actorHand: [] } };
    const view = await submit(forged);
    expect(view.progress.scored).toBe(0);
    expect(view.evaluations?.length ?? 0).toBe(0);
  });
});
