import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../supabaseUtils', () => ({ supabaseFetch: vi.fn() }));
vi.mock('./socialAuth', () => ({
  requireAuth: vi.fn(),
  friendIdsFromRows: vi.fn(() => []),
  getFriendRows: vi.fn(async () => []),
}));
vi.mock('./presenceRegistry', () => ({ getPresenceBatch: vi.fn(async () => ({})) }));

import type { Router } from 'express';
import { supabaseFetch } from '../supabaseUtils';
import { requireAuth } from './socialAuth';
import { registerSocialFriendsRoutes } from './socialFriends';

const mockFetch = supabaseFetch as ReturnType<typeof vi.fn>;
const mockAuth = requireAuth as ReturnType<typeof vi.fn>;

type Handler = (req: any, res: any) => unknown | Promise<unknown>;

function captureRoutes() {
  const routes = new Map<string, Handler>();
  const router = {
    get(path: string, h: Handler) { routes.set(`GET ${path}`, h); },
    post(path: string, h: Handler) { routes.set(`POST ${path}`, h); },
    put(path: string, h: Handler) { routes.set(`PUT ${path}`, h); },
    patch(path: string, h: Handler) { routes.set(`PATCH ${path}`, h); },
    delete(path: string, h: Handler) { routes.set(`DELETE ${path}`, h); },
  } as unknown as Router;
  registerSocialFriendsRoutes(router);
  return routes;
}

function makeRes() {
  const res = {
    statusCode: 200,
    body: null as unknown,
    status(c: number) { res.statusCode = c; return res; },
    json(v: unknown) { res.body = v; return res; },
  };
  return res;
}

const routes = captureRoutes();

/** The PostgREST 409 that friends_pair_unique_idx produces, as supabaseFetch throws it. */
function pairConflictError() {
  return new Error(
    'Supabase request failed: 409 {"code":"23505","message":"duplicate key value violates '
    + 'unique constraint \\"friends_pair_unique_idx\\""}',
  );
}

beforeEach(() => {
  mockFetch.mockReset();
  mockAuth.mockReset();
  mockAuth.mockResolvedValue('user-a');
});

describe('SA-7 — friend-request race returns 409, not 500', () => {
  for (const route of ['POST /friends/request/:userId', 'POST /friends/request'] as const) {
    it(`${route}: the losing side of a mutual-request race gets a clean 409`, async () => {
      const handler = routes.get(route)!;
      // /friends/request resolves the target by username first.
      if (route === 'POST /friends/request') {
        mockFetch.mockResolvedValueOnce([{ id: 'user-b' }]); // profiles lookup
      }
      mockFetch.mockResolvedValueOnce([]); // existing-pair check: nothing yet (both racers see this)
      mockFetch.mockResolvedValueOnce([]); // block check: no block between them
      mockFetch.mockRejectedValueOnce(pairConflictError()); // the INSERT loses the unique-index race

      const res = makeRes();
      await handler(
        { params: { userId: 'user-b' }, body: { targetUsername: 'bee' } },
        res,
      );

      expect(res.statusCode).toBe(409);
      expect((res.body as { error: string }).error).toMatch(/already exists/i);
    });
  }

  it('a genuine non-conflict error still surfaces as 500', async () => {
    const handler = routes.get('POST /friends/request/:userId')!;
    mockFetch.mockResolvedValueOnce([]);
    mockFetch.mockResolvedValueOnce([]); // block check
    mockFetch.mockRejectedValueOnce(new Error('Supabase request failed: 503 upstream down'));

    const res = makeRes();
    await handler({ params: { userId: 'user-b' }, body: {} }, res);

    expect(res.statusCode).toBe(500);
  });

  it('the pre-check still short-circuits a pending duplicate with 409 before any insert', async () => {
    const handler = routes.get('POST /friends/request/:userId')!;
    mockFetch.mockResolvedValueOnce([{ id: 'f1', status: 'pending' }]);

    const res = makeRes();
    await handler({ params: { userId: 'user-b' }, body: {} }, res);

    expect(res.statusCode).toBe(409);
    expect(mockFetch).toHaveBeenCalledTimes(1); // no INSERT attempted
  });
});

describe('blocking — friend requests', () => {
  for (const route of ['POST /friends/request/:userId', 'POST /friends/request'] as const) {
    it(`${route}: a block in either direction refuses the request with 403 and inserts nothing`, async () => {
      const handler = routes.get(route)!;
      if (route === 'POST /friends/request') {
        mockFetch.mockResolvedValueOnce([{ id: 'user-b' }]); // profiles lookup
      }
      mockFetch.mockResolvedValueOnce([]); // existing-pair check
      mockFetch.mockResolvedValueOnce([{ blocker_user_id: 'user-b', blocked_user_id: 'user-a' }]); // block check

      const res = makeRes();
      await handler({ params: { userId: 'user-b' }, body: { targetUsername: 'bee' } }, res);

      expect(res.statusCode).toBe(403);
      expect((res.body as { error: string }).error).not.toMatch(/block/i); // doesn't reveal who blocked
      const methods = mockFetch.mock.calls.map(([, init]) => (init as { method?: string } | undefined)?.method ?? 'GET');
      expect(methods).not.toContain('POST');
      const blockQuery = String(mockFetch.mock.calls.at(-1)?.[0]);
      expect(blockQuery).toContain('/rest/v1/user_blocks?or=(and(blocker_user_id.eq.user-a,blocked_user_id.eq.user-b),and(blocker_user_id.eq.user-b,blocked_user_id.eq.user-a))');
    });
  }

  it('unrelated users are unaffected: no block row means the request is inserted', async () => {
    const handler = routes.get('POST /friends/request/:userId')!;
    mockFetch.mockResolvedValueOnce([]); // existing-pair check
    mockFetch.mockResolvedValueOnce([]); // block check
    mockFetch.mockResolvedValueOnce(undefined); // insert

    const res = makeRes();
    await handler({ params: { userId: 'user-c' }, body: {} }, res);

    expect(res.statusCode).toBe(200);
    expect(mockFetch.mock.calls.at(-1)?.[0]).toBe('/rest/v1/friends');
  });

  it('fails closed: when block state cannot be read, nothing is inserted and the reply is generic', async () => {
    const handler = routes.get('POST /friends/request/:userId')!;
    mockFetch.mockResolvedValueOnce([]); // existing-pair check
    mockFetch.mockRejectedValueOnce(new Error('Supabase request failed: 503 upstream down')); // block check

    const res = makeRes();
    await handler({ params: { userId: 'user-b' }, body: {} }, res);

    expect(res.statusCode).toBe(503);
    const message = (res.body as { error: string }).error;
    expect(message).toMatch(/unavailable/i);
    expect(message).not.toMatch(/block|supabase|503/i);
    const methods = mockFetch.mock.calls.map(([, init]) => (init as { method?: string } | undefined)?.method ?? 'GET');
    expect(methods).not.toContain('POST');
  });
});
