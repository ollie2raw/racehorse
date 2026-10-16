import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Application } from 'express';
import { registerRankingRoutes, type RankingRouteDeps } from './ranking';

type Handler = (req: unknown, res: unknown) => unknown | Promise<unknown>;

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';

function makeHarness(overrides: Partial<RankingRouteDeps> = {}) {
  const routes = new Map<string, Handler>();
  const app = {
    get(path: string, handler: Handler) { routes.set(`GET ${path}`, handler); },
    post(path: string, handler: Handler) { routes.set(`POST ${path}`, handler); },
  };
  const supabaseFetch = vi.fn();
  const getAuthenticatedUserId = vi.fn().mockResolvedValue(USER_ID);
  const deps: RankingRouteDeps = {
    supabaseFetch: supabaseFetch as unknown as RankingRouteDeps['supabaseFetch'],
    getAuthenticatedUserId,
    isAdminSecret: () => false,
    getLeaderboard: async () => [],
    processRatingPeriod: async () => null,
    computeOnlineCurrentWinStreak: () => 3,
    isFritzId: () => false,
    DEFAULT_RATING: 1500,
    DEFAULT_RD: 350,
    ...overrides,
  };
  registerRankingRoutes(app as unknown as Application, deps);

  async function request(route: string, userId: string) {
    const handler = routes.get(`GET ${route}`);
    if (!handler) throw new Error(`Missing route GET ${route}`);
    let status = 200;
    let payload: unknown;
    const res = {
      status(code: number) { status = code; return res; },
      json(value: unknown) { payload = value; return res; },
      setHeader() { return res; },
      set() { return res; },
    };
    await handler({ headers: {}, params: { userId }, query: {}, body: {} }, res);
    return { status, body: payload as Record<string, unknown> };
  }

  return { request, supabaseFetch, getAuthenticatedUserId };
}

describe('GET /api/ranking/profile/:userId', () => {
  const route = '/api/ranking/profile/:userId';

  let harness: ReturnType<typeof makeHarness>;
  beforeEach(() => {
    harness = makeHarness();
  });

  it('rejects a guest seat id with 400 and never queries Supabase', async () => {
    const response = await harness.request(route, 'guest_mabc123_x7y8z9q0');

    expect(response.status).toBe(400);
    expect(response.body).not.toHaveProperty('glicko_rating');
    expect(harness.supabaseFetch).not.toHaveBeenCalled();
  });

  it.each(['fritz', 'not-a-uuid', `${USER_ID}&select=*`, `${USER_ID},id.neq.x`])(
    'rejects non-uuid id %j with 400 without querying',
    async (id) => {
      const response = await harness.request(route, id);
      expect(response.status).toBe(400);
      expect(harness.supabaseFetch).not.toHaveBeenCalled();
    },
  );

  it('returns 404 for a well-formed id with no profile row', async () => {
    harness.supabaseFetch.mockResolvedValueOnce([]);

    const response = await harness.request(route, USER_ID);

    expect(response.status).toBe(404);
    expect(harness.supabaseFetch).toHaveBeenCalledTimes(1);
  });

  it('returns the public ranked summary for a registered player', async () => {
    harness.supabaseFetch
      .mockResolvedValueOnce([
        { id: USER_ID, glicko_rating: 1620, glicko_rd: 80, provisional: false, ranked_games_played: 12, peak_rating: 1650 },
      ])
      .mockResolvedValueOnce([{ id: OTHER_ID }, { id: USER_ID }])
      .mockResolvedValueOnce([]);

    const response = await harness.request(route, USER_ID);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      glicko_rating: 1620,
      glicko_rd: 80,
      provisional: false,
      ranked_games_played: 12,
      peak_rating: 1650,
      rank: 2,
      currentWinStreak: 3,
    });
  });

  it('still reports a genuine upstream failure as 500', async () => {
    harness.supabaseFetch.mockRejectedValueOnce(new Error('upstream down'));

    const response = await harness.request(route, USER_ID);

    expect(response.status).toBe(500);
  });
});

describe('GET /api/ranking/history/:userId', () => {
  const route = '/api/ranking/history/:userId';

  it('rejects a guest seat id with 400 and never queries Supabase', async () => {
    const harness = makeHarness();

    const response = await harness.request(route, 'guest_mabc123_x7y8z9q0');

    expect(response.status).toBe(400);
    expect(harness.supabaseFetch).not.toHaveBeenCalled();
  });

  it('still requires authentication for a registered player id', async () => {
    const harness = makeHarness();
    harness.getAuthenticatedUserId.mockResolvedValueOnce(null);

    const response = await harness.request(route, USER_ID);

    expect(response.status).toBe(401);
    expect(harness.supabaseFetch).not.toHaveBeenCalled();
  });

  it("forbids reading another registered player's ranked history (IDOR) without touching the database", async () => {
    const harness = makeHarness();

    const response = await harness.request(route, OTHER_ID);

    expect(response.status).toBe(403);
    expect(harness.supabaseFetch).not.toHaveBeenCalled();
  });

  it("serves the caller's own history", async () => {
    const harness = makeHarness();
    harness.supabaseFetch.mockResolvedValueOnce([{ id: USER_ID, glicko_rating: 1600 }]).mockResolvedValueOnce([]);

    const response = await harness.request(route, USER_ID);

    expect(response.status).toBe(200);
    expect(response.body.currentRating).toBe(1600);
  });
});
