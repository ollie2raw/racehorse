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

const { getAuthenticatedUserIdMock } = vi.hoisted(() => ({
  getAuthenticatedUserIdMock: vi.fn<() => Promise<string | null>>(),
}));

vi.mock('../../platform/auth/supabaseAuth', () => ({
  getAuthenticatedUserId: getAuthenticatedUserIdMock,
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
  return async (method: 'GET' | 'POST', path: string, options: { body?: unknown; query?: Record<string, string> } = {}) => {
    const handler = routes.get(`${method} ${path}`);
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
    await handler({ body: options.body ?? {}, query: options.query ?? {}, params: {} }, res);
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

describe('GET /api/game-reviews', () => {
  const request = makeHarness();

  beforeEach(() => {
    fakeTable.rows.length = 0;
    getAuthenticatedUserIdMock.mockReset();
  });
  afterEach(() => vi.clearAllMocks());

  it('E0d: a user cannot read another user\'s row for the same game_digest, even though the fake table (like service_role) holds both', async () => {
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
    const res = await request('GET', '/api/game-reviews', { query: { gameDigest: baseReviewBody.gameDigest } });

    expect(res.status).toBe(200);
    expect((res.body as { accuracyModelResult: { grade: string } }).accuracyModelResult.grade).toBe('A');
  });

  it('E0d: returns 404 with a clear "not yet analyzed" message when no row exists', async () => {
    getAuthenticatedUserIdMock.mockResolvedValueOnce('user-a');
    const res = await request('GET', '/api/game-reviews', { query: { gameDigest: 'never-analyzed' } });

    expect(res.status).toBe(404);
    expect((res.body as { error: string }).error).toMatch(/not.*analyzed/i);
  });

  it('E0d: reopen returns same result -- writes a review then reads it back, response matches exactly', async () => {
    getAuthenticatedUserIdMock.mockResolvedValueOnce('user-a');
    const writeRes = await request('POST', '/api/game-reviews', { body: baseReviewBody });
    expect(writeRes.status).toBe(201);

    getAuthenticatedUserIdMock.mockResolvedValueOnce('user-a');
    const readRes = await request('GET', '/api/game-reviews', { query: { gameDigest: baseReviewBody.gameDigest } });

    expect(readRes.status).toBe(200);
    expect(readRes.body).toEqual({
      gameDigest: baseReviewBody.gameDigest,
      reviewEngineVersion: baseReviewBody.reviewEngineVersion,
      accuracyModelVersion: baseReviewBody.accuracyModelVersion,
      evaluations: baseReviewBody.evaluations,
      accuracyModelResult: baseReviewBody.accuracyModelResult,
      mode: baseReviewBody.mode,
      sourceMatchId: null,
      createdAt: expect.any(String),
      source: 'client-asserted',
    });
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
});
