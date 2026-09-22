/**
 * E0d (docs/scoping/game-review-oracle-upgrade-2026-09-13.md, Phase E): the
 * read/reopen route. Uses a stateful fake supabaseFetch (not mocked store
 * functions) so insertGameReviewIdempotent/queryLatestGameReview run for
 * real against it -- these tests prove actual query behavior (the ownership
 * filter, the on_conflict/ignore-duplicates insert, the created_at-desc
 * ordering), not just that the right function was called.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Application } from 'express';

const { getAuthenticatedUserIdMock, warnLogMock } = vi.hoisted(() => ({
  getAuthenticatedUserIdMock: vi.fn<() => Promise<string | null>>(),
  warnLogMock: vi.fn(),
}));

vi.mock('../../platform/auth/supabaseAuth', () => ({
  getAuthenticatedUserId: getAuthenticatedUserIdMock,
}));

vi.mock('../../logger', () => ({
  childLogger: () => ({
    warn: warnLogMock,
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

/** A minimal PostgREST-shaped fake for the game_reviews table only. */
function createFakeGameReviewsTable() {
  const rows: Record<string, unknown>[] = [];
  let nextId = 1;
  return {
    rows,
    async fetch(path: string, init?: RequestInit): Promise<unknown> {
      const url = new URL(`http://fake${path}`);
      const method = init?.method ?? 'GET';

      if (method === 'POST') {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        const conflictCols = (url.searchParams.get('on_conflict') ?? '').split(',').filter(Boolean);
        const isDuplicate =
          conflictCols.length > 0 && rows.some((r) => conflictCols.every((c) => r[c] === body[c]));
        if (isDuplicate) return [];
        const row = {
          id: `review-${nextId++}`,
          created_at: new Date(Date.now() + rows.length).toISOString(),
          // Real Postgres returns every column on the row, defaulting an
          // unspecified nullable column to NULL rather than omitting the
          // key -- the game_reviews schema's only such column.
          source_match_id: null,
          ...body,
        };
        rows.push(row);
        return [row];
      }

      let filtered = rows.slice();
      for (const [key, value] of url.searchParams) {
        if (['order', 'limit', 'select', 'on_conflict'].includes(key)) continue;
        if (value.startsWith('eq.')) {
          const want = value.slice(3);
          filtered = filtered.filter((r) => String(r[key]) === want);
        }
      }
      if (url.searchParams.get('order') === 'created_at.desc') {
        filtered.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      }
      const limit = url.searchParams.get('limit');
      if (limit) filtered = filtered.slice(0, Number(limit));
      return filtered;
    },
  };
}

const fakeTable = createFakeGameReviewsTable();

vi.mock('../../supabaseUtils', () => ({
  supabaseFetch: (path: string, init?: RequestInit) => fakeTable.fetch(path, init),
}));

import { registerGameReviewsRoute } from './gameReviewsRoute';

type Handler = (req: unknown, res: unknown) => unknown | Promise<unknown>;

function makeHarness() {
  const routes = new Map<string, Handler>();
  const app = {
    get(path: string, h: Handler) {
      routes.set(`GET ${path}`, h);
    },
    post(path: string, h: Handler) {
      routes.set(`POST ${path}`, h);
    },
  };
  registerGameReviewsRoute(app as unknown as Application);
  return async (
    method: 'GET' | 'POST',
    path: string,
    options: { body?: unknown; query?: Record<string, string>; params?: Record<string, string> } = {},
  ) => {
    let handler = routes.get(`${method} ${path}`);
    let params = options.params ?? {};
    if (!handler && method === 'GET' && path.startsWith('/api/game-reviews/by-id/')) {
      handler = routes.get('GET /api/game-reviews/by-id/:reviewId');
      params = { reviewId: path.slice('/api/game-reviews/by-id/'.length) };
    }
    if (!handler) throw new Error(`no route ${method} ${path}`);
    let status = 200;
    let json: unknown;
    const res = {
      status(c: number) {
        status = c;
        return res;
      },
      json(v: unknown) {
        json = v;
        return res;
      },
    };
    await handler({ body: options.body ?? {}, query: options.query ?? {}, params }, res);
    return { status, body: json as Record<string, unknown> };
  };
}

const baseReviewBody = {
  gameDigest: 'digest-abc123',
  reviewEngineVersion: 'review-engine-v1',
  accuracyModelVersion: 'accuracy-model-v4-calibrated-2026-09-17',
  evaluations: [{ decisionId: 'd1', evidence: { source: 'exact' } }],
  accuracyModelResult: { accuracy: 88.1, grade: 'A' },
  mode: 'pvf',
};

const reconciledReviewBody = {
  ...baseReviewBody,
  gameDigest: 'digest-reconciliation',
  evaluations: [
    {
      evaluationVersion: 1,
      snapshotId: 'x',
      rulesVersion: 1,
      reviewEngineVersion: 'review-engine-v1',
      evidence: { source: 'exact', confidence: 'high', displayLabel: 'Exact analysis' },
      played: {
        action: { kind: 'play', tile: { low: 0, high: 1 }, position: 'left' },
        value: { expectedPointDifferential: 0, winProbability: null },
        immediatePoints: 0,
        principalVariation: [],
      },
      best: {
        action: { kind: 'play', tile: { low: 5, high: 6 }, position: 'left' },
        value: { expectedPointDifferential: 0, winProbability: null },
        immediatePoints: 0,
        principalVariation: [],
      },
      candidates: [
        {
          action: { kind: 'play', tile: { low: 0, high: 1 }, position: 'left' },
          value: { expectedPointDifferential: 0, winProbability: null },
          immediatePoints: 0,
          principalVariation: [],
        },
        {
          action: { kind: 'play', tile: { low: 5, high: 6 }, position: 'left' },
          value: { expectedPointDifferential: 0, winProbability: null },
          immediatePoints: 0,
          principalVariation: [],
        },
      ],
      loss: { expectedPointDifferential: 0, winProbability: null },
      search: { nodes: 2, depth: 1, hiddenStateSamples: 0, coverage: 1, complete: true },
      diagnostics: [],
    },
  ],
};

describe('E2 accuracy-model reconciliation on write', () => {
  const request = makeHarness();

  beforeEach(() => {
    process.env.POST_GAME_REVIEW_COHORT_USER_IDS =
      'user-match,user-mismatch,user-reconciliation-failure,user-a,user-b';
    fakeTable.rows.length = 0;
    getAuthenticatedUserIdMock.mockReset();
    warnLogMock.mockReset();
  });

  it('does not warn when the client assertion matches the server derivation', async () => {
    const { computeGameAccuracyModel } = await import('@racehorse/review-engine');
    const body = {
      ...reconciledReviewBody,
      accuracyModelResult: computeGameAccuracyModel(reconciledReviewBody.evaluations as never),
    };
    getAuthenticatedUserIdMock.mockResolvedValueOnce('user-match');

    const res = await request('POST', '/api/game-reviews', { body });

    expect(res.status).toBe(201);
    expect(fakeTable.rows).toHaveLength(1);
    expect(warnLogMock).not.toHaveBeenCalled();
  });

  it('warns on mismatch without blocking the successful persisted write', async () => {
    const clientAssertedAccuracyModelResult = { accuracy: 12, grade: 'D' };
    getAuthenticatedUserIdMock.mockResolvedValueOnce('user-mismatch');

    const res = await request('POST', '/api/game-reviews', {
      body: { ...reconciledReviewBody, accuracyModelResult: clientAssertedAccuracyModelResult },
    });

    expect(res.status).toBe(201);
    expect(fakeTable.rows).toHaveLength(1);
    expect(warnLogMock).toHaveBeenCalledTimes(1);
    expect(warnLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        gameDigest: reconciledReviewBody.gameDigest,
        userId: 'user-mismatch',
        clientAssertedAccuracyModelResult,
        serverDerivedAccuracyModelResult: expect.objectContaining({ accuracy: expect.any(Number) }),
      }),
      'client/server accuracy model mismatch',
    );
  });

  it('logs reconciliation failures distinctly without blocking the successful persisted write', async () => {
    getAuthenticatedUserIdMock.mockResolvedValueOnce('user-reconciliation-failure');

    const res = await request('POST', '/api/game-reviews', {
      body: {
        ...baseReviewBody,
        gameDigest: 'digest-reconciliation-failure',
        evaluations: [{ malformed: true }],
      },
    });

    expect(res.status).toBe(201);
    expect(fakeTable.rows).toHaveLength(1);
    expect(warnLogMock).toHaveBeenCalledTimes(1);
    expect(warnLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        gameDigest: 'digest-reconciliation-failure',
        userId: 'user-reconciliation-failure',
        err: expect.anything(),
      }),
      'accuracy model reconciliation failed',
    );
  });
});

describe('GET /api/game-reviews', () => {
  const request = makeHarness();

  beforeEach(() => {
    process.env.POST_GAME_REVIEW_COHORT_USER_IDS = 'user-a,user-b';
    fakeTable.rows.length = 0;
    getAuthenticatedUserIdMock.mockReset();
  });
  afterEach(() => vi.clearAllMocks());

  it("E0d: a user cannot read another user's row for the same game_digest, even though the fake table (like service_role) holds both", async () => {
    getAuthenticatedUserIdMock.mockResolvedValueOnce('user-a');
    await request('POST', '/api/game-reviews', { body: baseReviewBody });

    getAuthenticatedUserIdMock.mockResolvedValueOnce('user-b');
    await request('POST', '/api/game-reviews', {
      body: { ...baseReviewBody, accuracyModelResult: { accuracy: 12, grade: 'D' } },
    });

    // Both rows exist in the table under the same game_digest -- the read
    // must be scoped by the requester's own user_id, not just game_digest.
    expect(fakeTable.rows).toHaveLength(2);

    getAuthenticatedUserIdMock.mockResolvedValueOnce('user-a');
    const res = await request('GET', '/api/game-reviews', {
      query: { gameDigest: baseReviewBody.gameDigest },
    });

    expect(res.status).toBe(200);
    expect((res.body as { accuracyModelResult: { grade: string } }).accuracyModelResult.grade).toBe(
      'A',
    );
  });

  it('E0d: returns 404 with a clear "not yet analyzed" message when no row exists', async () => {
    getAuthenticatedUserIdMock.mockResolvedValueOnce('user-a');
    const res = await request('GET', '/api/game-reviews', {
      query: { gameDigest: 'never-analyzed' },
    });

    expect(res.status).toBe(404);
    expect((res.body as { error: string }).error).toMatch(/not.*analyzed/i);
  });

  it('E0d: reopen returns same result -- writes a review then reads it back, response matches exactly', async () => {
    getAuthenticatedUserIdMock.mockResolvedValueOnce('user-a');
    const writeRes = await request('POST', '/api/game-reviews', { body: baseReviewBody });
    expect(writeRes.status).toBe(201);

    getAuthenticatedUserIdMock.mockResolvedValueOnce('user-a');
    const readRes = await request('GET', '/api/game-reviews', {
      query: { gameDigest: baseReviewBody.gameDigest },
    });

    expect(readRes.status).toBe(200);
    expect(readRes.body).toEqual({
      id: expect.any(String),
      gameDigest: baseReviewBody.gameDigest,
      reviewEngineVersion: baseReviewBody.reviewEngineVersion,
      accuracyModelVersion: baseReviewBody.accuracyModelVersion,
      evaluations: baseReviewBody.evaluations,
      accuracyModelResult: baseReviewBody.accuracyModelResult,
      mode: baseReviewBody.mode,
      sourceMatchId: null,
      createdAt: expect.any(String),
      replayArtifact: null,
      source: 'client-asserted',
    });
  });

  it('F1e-5: persists and returns replayArtifact unchanged; by-id is exact', async () => {
    const replayArtifact = {
      artifactVersion: 1,
      analysis: { accuracy: 90, analyzedMoves: [] },
      decisionIds: [{ moveNumber: 1, decisionId: 'd1' }],
      decisions: [
        {
          decisionId: 'd1',
          coachingFacts: { missKind: 'better_tile' },
          coachingProse: { headline: 'h', detail: 'd', takeaway: 't' },
        },
      ],
    };
    getAuthenticatedUserIdMock.mockResolvedValueOnce('user-a');
    const writeRes = await request('POST', '/api/game-reviews', {
      body: { ...baseReviewBody, gameDigest: 'digest-replay', replayArtifact },
    });
    expect(writeRes.status).toBe(201);
    const reviewId = (writeRes.body.review as { id: string }).id;

    // Insert a newer row for the same digest under a different engine version.
    getAuthenticatedUserIdMock.mockResolvedValueOnce('user-a');
    await request('POST', '/api/game-reviews', {
      body: {
        ...baseReviewBody,
        gameDigest: 'digest-replay',
        reviewEngineVersion: 'review-engine-v2',
        replayArtifact: {
          ...replayArtifact,
          decisions: [
            {
              decisionId: 'd1',
              coachingFacts: { missKind: 'better_tile' },
              coachingProse: { headline: 'NEWER', detail: 'd', takeaway: 't' },
            },
          ],
        },
      },
    });

    getAuthenticatedUserIdMock.mockResolvedValueOnce('user-a');
    const byId = await request('GET', `/api/game-reviews/by-id/${reviewId}`);
    expect(byId.status).toBe(200);
    expect(byId.body.id).toBe(reviewId);
    expect(byId.body.replayArtifact).toEqual(replayArtifact);
    expect((byId.body.replayArtifact as { decisions: { coachingProse: { headline: string } }[] }).decisions[0]
      .coachingProse.headline).toBe('h');

    getAuthenticatedUserIdMock.mockResolvedValueOnce('user-a');
    const latest = await request('GET', '/api/game-reviews', { query: { gameDigest: 'digest-replay' } });
    expect(latest.status).toBe(200);
    expect(
      (latest.body.replayArtifact as { decisions: { coachingProse: { headline: string } }[] }).decisions[0]
        .coachingProse.headline,
    ).toBe('NEWER');
  });

  it('F1e-5: rejects unsupported replayArtifact versions', async () => {
    getAuthenticatedUserIdMock.mockResolvedValueOnce('user-a');
    const res = await request('POST', '/api/game-reviews', {
      body: {
        ...baseReviewBody,
        gameDigest: 'digest-bad-version',
        replayArtifact: { artifactVersion: 99, analysis: {}, decisionIds: [], decisions: [] },
      },
    });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/artifactVersion/);
  });

  it('F1e-5: lists recent reviews for history entry', async () => {
    getAuthenticatedUserIdMock.mockResolvedValueOnce('user-a');
    await request('POST', '/api/game-reviews', {
      body: { ...baseReviewBody, gameDigest: 'digest-recent-1' },
    });
    getAuthenticatedUserIdMock.mockResolvedValueOnce('user-a');
    const list = await request('GET', '/api/game-reviews/recent', { query: { limit: '5' } });
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.reviews)).toBe(true);
    expect((list.body.reviews as unknown[]).length).toBeGreaterThan(0);
  });

  it('E0d: 401s when unauthenticated', async () => {
    getAuthenticatedUserIdMock.mockResolvedValueOnce(null);
    const res = await request('GET', '/api/game-reviews', { query: { gameDigest: 'x' } });
    expect(res.status).toBe(401);
  });

  it('E0d: 400s when gameDigest is missing', async () => {
    getAuthenticatedUserIdMock.mockResolvedValueOnce('user-a');
    const res = await request('GET', '/api/game-reviews', { query: {} });
    expect(res.status).toBe(400);
  });

  it('denies reads and writes for authenticated users outside the cohort', async () => {
    getAuthenticatedUserIdMock.mockResolvedValueOnce('not-in-cohort');
    const writeRes = await request('POST', '/api/game-reviews', { body: baseReviewBody });
    expect(writeRes.status).toBe(403);

    getAuthenticatedUserIdMock.mockResolvedValueOnce('not-in-cohort');
    const readRes = await request('GET', '/api/game-reviews', {
      query: { gameDigest: baseReviewBody.gameDigest },
    });
    expect(readRes.status).toBe(403);
  });

  it('reports cohort access separately and fails closed for missing auth', async () => {
    getAuthenticatedUserIdMock.mockResolvedValueOnce('user-a');
    const enabled = await request('GET', '/api/game-reviews/access');
    expect(enabled).toEqual({ status: 200, body: { enabled: true } });

    getAuthenticatedUserIdMock.mockResolvedValueOnce('not-in-cohort');
    const disabled = await request('GET', '/api/game-reviews/access');
    expect(disabled).toEqual({ status: 200, body: { enabled: false } });

    getAuthenticatedUserIdMock.mockResolvedValueOnce(null);
    const unauthenticated = await request('GET', '/api/game-reviews/access');
    expect(unauthenticated.status).toBe(401);
  });
});
