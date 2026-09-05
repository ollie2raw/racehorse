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
