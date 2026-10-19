/**
 * Trust boundary of the V2 avgMoveQuality: GET /api/review-completion-jobs/... returns `moveQuality`, derived on the server from
 * the server's own evaluations. Real HTTP requests against the production routes; nothing the client sends can move it:
 *   - a forged avgMoveQuality / moveQuality / accuracyModelResult / evaluations / claimed score or result in the job body
 *   - a reordered or forged evaluation payload
 *   - a tampered candidate set (legalActions) or hand
 * and an unfinished or unscorable job reports unavailable (null with a reason), never 0 or 100.
 */
import express from 'express';
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ReviewEvaluationV1, ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import { REVIEW_FIXTURE_CORPUS } from '../../../packages/game-core/src/reviewFixtureCorpus';
import { adaptiveEvaluateReviewPosition } from '../../../packages/review-engine/src/adaptiveEvaluateReviewPosition';
import { computeGameAccuracyModel } from '../../../packages/review-engine/src/gameAccuracyModel';
import { InMemoryCheckpointStore } from '../../../packages/review-engine/src/durableReviewCompletionRuntime';
import {
  registerReviewCompletionJobsRoute,
  setReviewCompletionStoreForTests,
  setReviewPositionEvaluatorForTests,
} from './reviewCompletionWorker';

vi.mock('../platform/auth/supabaseAuth', () => ({ getAuthenticatedUserId: async () => 'move-quality-user' }));
vi.mock('../reviewPersistence/gameReviewCohort', () => ({ isGameReviewCohortUser: () => false }));

type MoveQuality =
  | { status: 'available'; avgMoveQuality: number; accuracyModelVersion: string; gradedDecisionCount: number; forcedDecisionCount: number }
  | { status: 'unavailable'; avgMoveQuality: null; reason: string };

type JobView = {
  jobId: string;
  complete: boolean;
  status: string;
  evaluations?: ReviewEvaluationV1[];
  accuracyModelResult?: { accuracy: number | null } | null;
  moveQuality: MoveQuality;
  progress: { total: number; scored: number; forced: number; remaining: number };
};

const honest: ReviewPositionSnapshotV2 = REVIEW_FIXTURE_CORPUS.find((f) => f.id === 'deliberately-poor-endgame-s78-a27')!.snapshot;

describe('V2 avgMoveQuality on the authoritative job endpoints (crafted requests)', () => {
  let server: Server;
  let base: string;
  const store = new InMemoryCheckpointStore();
  let counter = 0;
  const headers = { Authorization: 'Bearer crafted', 'Content-Type': 'application/json' };

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

  async function submit(snapshot: unknown, extra: Record<string, unknown> = {}): Promise<{ view: JobView; digest: string }> {
    counter += 1;
    const digest = `move-quality-${counter}-${Date.now()}`;
    const decisionId = (snapshot as ReviewPositionSnapshotV2).identifiers.decisionId;
    const create = await fetch(`${base}/api/review-completion-jobs`, {
      method: 'POST', headers,
      body: JSON.stringify({ gameDigest: digest, sourceMatchId: 'move-quality', snapshots: [snapshot], expectedDecisionIds: [decisionId], ...extra }),
    });
    expect(create.status).toBe(202);
    const { jobId } = await create.json() as { jobId: string };
    let view: JobView | null = null;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const res = await fetch(`${base}/api/review-completion-jobs/${encodeURIComponent(jobId)}`, { headers });
      view = await res.json() as JobView;
      if (view.complete || view.status === 'failed') break;
      await new Promise((r) => setTimeout(r, 25));
    }
    return { view: view!, digest };
  }

  it('baseline: a finished job reports the V2 accuracy, identical to the accuracy model and to the review headline', async () => {
    const { view } = await submit(honest);
    expect(view.complete).toBe(true);
    expect(view.moveQuality.status).toBe('available');
    if (view.moveQuality.status !== 'available') return;
    const model = computeGameAccuracyModel(view.evaluations!);
    expect(view.moveQuality.avgMoveQuality).toBe(model.accuracy);
    expect(view.moveQuality.avgMoveQuality, 'one definition: the same number the review shows').toBe(view.accuracyModelResult!.accuracy);
    expect(view.moveQuality.gradedDecisionCount).toBe(1);
    expect(view.moveQuality.forcedDecisionCount).toBe(0);
    expect(view.moveQuality.avgMoveQuality).toBeLessThan(100);
  });

  it('forged avgMoveQuality / moveQuality / accuracyModelResult / evaluations / score / result in the body change nothing', async () => {
    const { view: honestView } = await submit(honest);
    const real = honestView.evaluations![0]!;
    const forgedEval = { ...real, snapshotId: honest.identifiers.decisionId, loss: { expectedPointDifferential: 0, winProbability: null }, played: real.best };
    const { view } = await submit(honest, {
      avgMoveQuality: 100,
      moveQuality: { status: 'available', avgMoveQuality: 100 },
      accuracyModelResult: { status: 'complete', accuracy: 100, grade: 'S', coverageFraction: 1 },
      evaluations: [forgedEval, forgedEval],
      winnerScore: 200, loserScore: 0, result: 'win', claimedWin: true,
    });
    expect(view.moveQuality).toEqual(honestView.moveQuality);
    expect(view.accuracyModelResult).toEqual(honestView.accuracyModelResult);
  });

  it('a tampered candidate set cannot raise the number (omitting the stronger move, adding an illegal one)', async () => {
    const { view: honestView } = await submit(honest);
    const best = honestView.evaluations![0]!.best.action;
    const omitted = { ...honest, legalActions: honest.legalActions.filter((a) => JSON.stringify(a) !== JSON.stringify(best)) };
    const illegal = { ...honest, legalActions: [...honest.legalActions, { kind: 'play', tile: { low: 6, high: 6 }, position: 'left' }] };
    expect((await submit(omitted)).view.moveQuality).toEqual(honestView.moveQuality);
    expect((await submit(illegal)).view.moveQuality).toEqual(honestView.moveQuality);
  });

  it('the by-digest endpoint reports the same value as the by-id endpoint', async () => {
    const { view, digest } = await submit(honest);
    const res = await fetch(`${base}/api/review-completion-jobs?gameDigest=${encodeURIComponent(digest)}`, { headers });
    const byDigest = await res.json() as { complete: boolean; moveQuality: MoveQuality };
    expect(byDigest.complete).toBe(true);
    expect(byDigest.moveQuality).toEqual(view.moveQuality);
  });

  it('a decision the server cannot score leaves the stat unavailable (null, with a reason), never 0 or 100', async () => {
    const forged = { ...honest, preAction: { ...honest.preAction, actorHand: [] } };
    const { view } = await submit(forged);
    expect(view.complete).toBe(false);
    expect(view.moveQuality).toEqual({ status: 'unavailable', avgMoveQuality: null, reason: 'review-incomplete' });
  });

  it('exactly once: submitting the same game again returns the same job and the same value, whatever the second body says', async () => {
    const digest = `move-quality-idem-${Date.now()}`;
    const decisionId = honest.identifiers.decisionId;
    const post = async (extra: Record<string, unknown> = {}, snapshot: unknown = honest) => {
      const res = await fetch(`${base}/api/review-completion-jobs`, {
        method: 'POST', headers,
        body: JSON.stringify({ gameDigest: digest, sourceMatchId: 'move-quality-idem', snapshots: [snapshot], expectedDecisionIds: [decisionId], ...extra }),
      });
      expect(res.status).toBe(202);
      return (await res.json() as { jobId: string }).jobId;
    };
    const readQuality = async (jobId: string): Promise<MoveQuality> => {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const view = await (await fetch(`${base}/api/review-completion-jobs/${encodeURIComponent(jobId)}`, { headers })).json() as JobView;
        if (view.complete) return view.moveQuality;
        await new Promise((r) => setTimeout(r, 25));
      }
      throw new Error('job never completed');
    };
    const first = await post();
    const firstQuality = await readQuality(first);
    // a retry, and a hostile replay that claims a perfect game for the same digest
    const best = (await (await fetch(`${base}/api/review-completion-jobs/${encodeURIComponent(first)}`, { headers })).json() as JobView).evaluations![0]!.best.action;
    const retry = await post();
    const replay = await post({ avgMoveQuality: 100 }, { ...honest, actualAction: best });
    expect(retry).toBe(first);
    expect(replay).toBe(first);
    expect(await readQuality(retry)).toEqual(firstQuality);
    expect(await readQuality(replay)).toEqual(firstQuality);
  });

  it('a game with no captured decisions cannot create a job (no snapshots, no number)', async () => {
    for (const body of [
      { gameDigest: 'move-quality-empty-1', sourceMatchId: 'x', snapshots: [], expectedDecisionIds: [] },
      { gameDigest: 'move-quality-empty-2', sourceMatchId: 'x', snapshots: [honest], expectedDecisionIds: [] },
    ]) {
      const res = await fetch(`${base}/api/review-completion-jobs`, { method: 'POST', headers, body: JSON.stringify(body) });
      expect(res.status).toBe(400);
    }
  });

  /**
   * TRIPWIRE, not a goal. The server evaluates the positions and moves a client submits; it re-derives the legal set and ignores
   * client evaluations, but the PLAYED action (`actualAction`) is part of the claim and nothing binds a job to a game this server
   * saw. So the value is authoritative about the claimed decisions, not proof that they were played. That is why moveQuality is
   * returned only to the owner of the job, is not persisted to `matches`, and must not reach a public/competitive surface until
   * snapshots are server-issued. If binding is added this test flips: delete it then.
   */
  it('TRIPWIRE: the played move is the client\'s claim (so the value is owner-only and must not feed a shared surface)', async () => {
    const { view: honestView } = await submit(honest);
    const best = honestView.evaluations![0]!.best.action;
    const { view: claimed } = await submit({ ...honest, actualAction: best });
    expect(honestView.moveQuality).toMatchObject({ status: 'available' });
    expect((honestView.moveQuality as { avgMoveQuality: number }).avgMoveQuality).toBeLessThan(10);
    expect(claimed.moveQuality).toMatchObject({ status: 'available', avgMoveQuality: 100 });
  });
});
