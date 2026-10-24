/**
 * Trust boundary of the OWNER-ONLY reviewed move quality: GET /api/review-completion-jobs/... returns `reviewedMoveQuality`,
 * derived on the server from the server's own candidate set and evaluations, over the played action the client asserted. Real
 * HTTP requests against the production routes. Nothing the client sends except the played action can move it:
 *   - a forged avgMoveQuality / moveQuality / reviewedMoveQuality / provenance / accuracyModelResult / evaluations / score / result
 *   - a reordered or forged evaluation payload
 *   - a tampered candidate set (legalActions) or hand
 * an unfinished or unscorable job reports unavailable (null with a reason), never 0 or 100, and every result says, in its own
 * provenance, that the played action is client-asserted and that the value is owner-only (never shareable).
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

// Two real identities and an anonymous caller, chosen by the bearer token, so ownership is actually exercised.
vi.mock('../platform/auth/supabaseAuth', () => ({
  getAuthenticatedUserId: async (req: { headers: { authorization?: string } }) => {
    const authorization = req.headers.authorization;
    if (authorization === 'Bearer crafted') return 'move-quality-user';
    if (authorization === 'Bearer intruder') return 'intruder-user';
    return null;
  },
}));
vi.mock('../reviewPersistence/gameReviewCohort', () => ({ isGameReviewCohortUser: () => false }));

type MoveQuality = (
  | { status: 'available'; avgMoveQuality: number; accuracyModelVersion: string; gradedDecisionCount: number; forcedDecisionCount: number }
  | { status: 'unavailable'; avgMoveQuality: null; reason: string }
) & {
  provenance: { candidateSet: string; evaluation: string; playedAction: string };
  ownerOnly: boolean;
};

type JobView = {
  jobId: string;
  complete: boolean;
  status: string;
  evaluations?: ReviewEvaluationV1[];
  accuracyModelResult?: { accuracy: number | null } | null;
  reviewedMoveQuality: MoveQuality;
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
    expect(view.reviewedMoveQuality.status).toBe('available');
    if (view.reviewedMoveQuality.status !== 'available') return;
    const model = computeGameAccuracyModel(view.evaluations!);
    expect(view.reviewedMoveQuality.avgMoveQuality).toBe(model.accuracy);
    expect(view.reviewedMoveQuality.avgMoveQuality, 'one definition: the same number the review shows').toBe(view.accuracyModelResult!.accuracy);
    expect(view.reviewedMoveQuality.gradedDecisionCount).toBe(1);
    expect(view.reviewedMoveQuality.forcedDecisionCount).toBe(0);
    expect(view.reviewedMoveQuality.avgMoveQuality).toBeLessThan(100);
    // the trust level travels with the number: server candidates and evaluation, client-asserted played action, owner-only
    expect(view.reviewedMoveQuality.ownerOnly).toBe(true);
    expect(view.reviewedMoveQuality.provenance).toEqual({ candidateSet: 'server-derived', evaluation: 'server-evaluated', playedAction: 'client-asserted' });
  });

  it('forged avgMoveQuality / moveQuality / reviewedMoveQuality / provenance / accuracyModelResult / evaluations / score / result in the body change nothing', async () => {
    const { view: honestView } = await submit(honest);
    const real = honestView.evaluations![0]!;
    const forgedEval = { ...real, snapshotId: honest.identifiers.decisionId, loss: { expectedPointDifferential: 0, winProbability: null }, played: real.best };
    const { view } = await submit(honest, {
      avgMoveQuality: 100,
      moveQuality: { status: 'available', avgMoveQuality: 100 },
      reviewedMoveQuality: { status: 'available', avgMoveQuality: 100, ownerOnly: false, provenance: { playedAction: 'server-authoritative' } },
      provenance: { candidateSet: 'server-derived', evaluation: 'server-evaluated', playedAction: 'server-authoritative' },
      accuracyModelResult: { status: 'complete', accuracy: 100, grade: 'S', coverageFraction: 1 },
      evaluations: [forgedEval, forgedEval],
      winnerScore: 200, loserScore: 0, result: 'win', claimedWin: true,
    });
    expect(view.reviewedMoveQuality).toEqual(honestView.reviewedMoveQuality);
    expect(view.accuracyModelResult).toEqual(honestView.accuracyModelResult);
  });

  it('a tampered candidate set cannot raise the number (omitting the stronger move, adding an illegal one)', async () => {
    const { view: honestView } = await submit(honest);
    const best = honestView.evaluations![0]!.best.action;
    const omitted = { ...honest, legalActions: honest.legalActions.filter((a) => JSON.stringify(a) !== JSON.stringify(best)) };
    const illegal = { ...honest, legalActions: [...honest.legalActions, { kind: 'play', tile: { low: 6, high: 6 }, position: 'left' }] };
    expect((await submit(omitted)).view.reviewedMoveQuality).toEqual(honestView.reviewedMoveQuality);
    expect((await submit(illegal)).view.reviewedMoveQuality).toEqual(honestView.reviewedMoveQuality);
  });

  it('the by-digest endpoint reports the same value as the by-id endpoint', async () => {
    const { view, digest } = await submit(honest);
    const res = await fetch(`${base}/api/review-completion-jobs?gameDigest=${encodeURIComponent(digest)}`, { headers });
    const byDigest = await res.json() as { complete: boolean; reviewedMoveQuality: MoveQuality };
    expect(byDigest.complete).toBe(true);
    expect(byDigest.reviewedMoveQuality).toEqual(view.reviewedMoveQuality);
  });

  it('owner-only: another user and an anonymous caller get no job and no value, by id and by digest', async () => {
    const { view, digest } = await submit(honest);
    expect(view.reviewedMoveQuality.status).toBe('available');
    const byIdUrl = `${base}/api/review-completion-jobs/${encodeURIComponent(view.jobId)}`;
    const byDigestUrl = `${base}/api/review-completion-jobs?gameDigest=${encodeURIComponent(digest)}`;
    const intruder = { Authorization: 'Bearer intruder' };

    // the owner can read both
    expect((await fetch(byIdUrl, { headers })).status).toBe(200);
    expect((await fetch(byDigestUrl, { headers })).status).toBe(200);

    // a different authenticated user: 404, and the body carries nothing about the value
    for (const url of [byIdUrl, byDigestUrl]) {
      const res = await fetch(url, { headers: intruder });
      expect(res.status, url).toBe(404);
      const text = JSON.stringify(await res.json());
      expect(text).not.toMatch(/reviewedMoveQuality|avgMoveQuality|accuracyModelResult|provenance/);
    }
    // an anonymous caller: 401
    for (const url of [byIdUrl, byDigestUrl]) expect((await fetch(url)).status, url).toBe(401);
    // the intruder cannot reach the owner's job by submitting the same digest either: it gets its own, separate job
    const own = await fetch(`${base}/api/review-completion-jobs`, {
      method: 'POST', headers: { ...intruder, 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameDigest: digest, sourceMatchId: 'move-quality', snapshots: [honest], expectedDecisionIds: [honest.identifiers.decisionId] }),
    });
    expect(own.status).toBe(202);
    expect((await own.json() as { jobId: string }).jobId).not.toBe(view.jobId);
  });

  it('a decision the server cannot score leaves the stat unavailable (null, with a reason), never 0 or 100', async () => {
    const forged = { ...honest, preAction: { ...honest.preAction, actorHand: [] } };
    const { view } = await submit(forged);
    expect(view.complete).toBe(false);
    expect(view.reviewedMoveQuality).toMatchObject({ status: 'unavailable', avgMoveQuality: null, reason: 'review-incomplete' });
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
        if (view.complete) return view.reviewedMoveQuality;
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
   * TRIPWIRE, not a goal. The server derives the candidate set and evaluates every candidate itself, but the identity of the
   * PLAYED action (`actualAction`) is part of what the client submits, and nothing binds a job to a game this server saw. Same
   * position, a different legal action claimed: 7.3 becomes 100. So PLAYED ACTION IS SERVER-AUTHORITATIVE: NO. That is why the
   * value is named "reviewed", is owner-only, says so in its provenance, is refused by assertMoveQualityShareable, and is not
   * persisted anywhere. If the played action is ever bound to a game the server saw, this test flips: update provenance, then.
   */
  it('TRIPWIRE: the played action is the client\'s claim, so the value says client-asserted and is never shareable', async () => {
    const { view: honestView } = await submit(honest);
    const best = honestView.evaluations![0]!.best.action;
    const { view: claimed } = await submit({ ...honest, actualAction: best });
    expect(honestView.reviewedMoveQuality).toMatchObject({ status: 'available' });
    expect((honestView.reviewedMoveQuality as { avgMoveQuality: number }).avgMoveQuality).toBeLessThan(10);
    expect(claimed.reviewedMoveQuality).toMatchObject({ status: 'available', avgMoveQuality: 100 });
    // ...and the value that moved on a claim is labelled as exactly that, owner-only
    expect(claimed.reviewedMoveQuality.provenance.playedAction).toBe('client-asserted');
    expect(claimed.reviewedMoveQuality.ownerOnly).toBe(true);
  });
});
