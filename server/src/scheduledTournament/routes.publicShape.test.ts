import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerTournamentRoutes } from './routes';
import { HISTORY_DEFAULT_LIMIT, HISTORY_MAX_LIMIT, HISTORY_READ_CONCURRENCY, mapInBatches, parseHistoryPage, publicBracketMatch } from './publicBracket';
import type { MatchRow } from './types';

/**
 * The public bracket answers with a fixed list of fields (no room code, no lobby timing), and the history list is a page read in small batches
 * (roadmap 3.8). Same in-process harness as routes.test.ts.
 */

beforeEach(() => {
  vi.stubEnv('TOURNAMENTS_ENABLED', 'true');
});
afterAll(() => {
  vi.unstubAllEnvs();
});

const USER = '11111111-1111-4111-8111-111111111111';
const TOURNAMENT = '22222222-2222-4222-8222-222222222222';

const mocks = vi.hoisted(() => ({
  supabaseFetch: vi.fn(),
  fetchRegistrationsForUser: vi.fn(),
  fetchTournamentById: vi.fn(),
  fetchBracketView: vi.fn(),
  fetchRegistrationsWithProfile: vi.fn(),
  fetchMatches: vi.fn(),
}));

vi.mock('../supabaseUtils', () => ({ supabaseFetch: (...args: unknown[]) => mocks.supabaseFetch(...args) }));
vi.mock('../platform/auth/supabaseAuth', () => ({
  verifyBearerToken: async () => {
    const result = (await mocks.supabaseFetch()) as { id?: string } | null;
    return result && typeof result.id === 'string' ? result.id : null;
  },
}));
vi.mock('./persistence', async () => {
  const actual = await vi.importActual<typeof import('./persistence')>('./persistence');
  return {
    ...actual,
    fetchBracketView: (...args: unknown[]) => mocks.fetchBracketView(...args),
    fetchTournamentById: (...args: unknown[]) => mocks.fetchTournamentById(...args),
    fetchRegistrationsForUser: (...args: unknown[]) => mocks.fetchRegistrationsForUser(...args),
    fetchRegistrationsWithProfile: (...args: unknown[]) => mocks.fetchRegistrationsWithProfile(...args),
    fetchMatches: (...args: unknown[]) => mocks.fetchMatches(...args),
  };
});

type RouteHandler = (req: any, res: any) => unknown | Promise<unknown>;

function harness() {
  const routes = new Map<string, RouteHandler>();
  const app = {
    get: (path: string, handler: RouteHandler) => routes.set(`GET ${path}`, handler),
    post: (path: string, handler: RouteHandler) => routes.set(`POST ${path}`, handler),
    delete: (path: string, handler: RouteHandler) => routes.set(`DELETE ${path}`, handler),
  };
  registerTournamentRoutes(app as any);
  return async (path: string, req: { headers?: Record<string, string>; query?: unknown; params?: unknown } = {}) => {
    const handler = routes.get(`GET ${path}`);
    if (!handler) throw new Error(`missing route: GET ${path}`);
    let status = 200;
    let body: any;
    const res = {
      status: vi.fn((code: number) => {
        status = code;
        return res;
      }),
      json: vi.fn((payload: unknown) => {
        body = payload;
        return res;
      }),
    };
    await handler({ headers: req.headers ?? {}, body: {}, query: req.query ?? {}, params: req.params ?? {} }, res);
    return { status, body };
  };
}

const fullMatch = (overrides: Partial<MatchRow> = {}): MatchRow => ({
  id: 'match-1',
  tournament_id: TOURNAMENT,
  round: 1,
  match_number: 1,
  player1_id: 'p1',
  player2_id: 'p2',
  winner_id: 'p1',
  room_code: 'SECRETROOM1',
  status: 'completed',
  ready_at: '2026-11-02T22:00:00.000Z',
  ready_deadline_at: '2026-11-02T22:02:00.000Z',
  started_at: '2026-11-02T22:01:00.000Z',
  completed_at: '2026-11-02T22:10:00.000Z',
  player1_joined_at: '2026-11-02T22:00:30.000Z',
  player2_joined_at: '2026-11-02T22:00:40.000Z',
  winner_source: 'game_over',
  status_reason: 'internal detail',
  forfeit_user_id: null,
  no_show_user_id: 'p2',
  bot_tier: null,
  player1_score: 100,
  player2_score: 60,
  ...overrides,
});

describe('the public bracket', () => {
  const tournament = {
    id: TOURNAMENT, kind: 'live', owner_user_id: 'owner-secret', scheduled_start: '2026-11-02T22:00:00.000Z', registration_open_at: '2026-11-02T20:00:00.000Z',
    registration_close_at: '2026-11-02T21:55:00.000Z', status: 'in_progress', format: 'single_elimination', win_target: 100, max_players: 8, winner_id: null, created_at: '2026-11-01T00:00:00.000Z',
  };

  it('answers with a fixed list of match fields and leaves out the room code and lobby timing', async () => {
    mocks.fetchBracketView.mockResolvedValueOnce({ tournament, registrations: [], matches: [fullMatch()] });
    const { status, body } = await harness()('/api/tournaments/:id/bracket', { params: { id: TOURNAMENT } });
    expect(status).toBe(200);
    const match = body.view.matches[0];
    expect(Object.keys(match).sort()).toEqual([
      'bot_tier', 'completed_at', 'id', 'match_number', 'outcomeKind', 'player1_id', 'player1_score', 'player2_id', 'player2_score', 'round', 'started_at', 'status', 'tournament_id', 'winner_id',
    ]);
    const text = JSON.stringify(body);
    for (const secret of ['SECRETROOM1', 'internal detail', 'player1_joined_at', 'ready_deadline_at', 'no_show_user_id', 'forfeit_user_id', 'room_code', 'owner-secret']) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it('still says how a match ended, through the derived outcome kind', async () => {
    mocks.fetchBracketView.mockResolvedValueOnce({ tournament, registrations: [], matches: [fullMatch({ status_reason: null })] });
    const { body } = await harness()('/api/tournaments/:id/bracket', { params: { id: TOURNAMENT } });
    expect(body.view.matches[0].outcomeKind).toBe('played');
  });

  it('keeps a field that a later change adds to the row private until it is chosen', () => {
    const withExtra = { ...fullMatch(), brand_new_internal_column: 'x' } as MatchRow;
    expect(Object.keys(publicBracketMatch(withExtra))).not.toContain('brand_new_internal_column');
  });
});

describe('the tournament history', () => {
  const regs = (count: number, unfinished = 0) => [
    ...Array.from({ length: count }, (_, i) => ({
      id: `reg-${i}`, tournament_id: `t-${i}`, user_id: USER, seed: 1, status: 'eliminated',
      // reg-0 is the OLDEST registration, so the newest page starts at the highest index
      registered_at: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(), placement: 3,
    })),
    ...Array.from({ length: unfinished }, (_, i) => ({
      id: `open-${i}`, tournament_id: `open-${i}`, user_id: USER, seed: 1, status: 'registered', registered_at: '2026-12-01T00:00:00.000Z', placement: null,
    })),
  ];

  beforeEach(() => {
    Object.values(mocks).forEach((fn) => fn.mockReset());
    mocks.supabaseFetch.mockResolvedValue({ id: USER });
    mocks.fetchTournamentById.mockImplementation(async (id: string) => ({
      id, kind: 'live', scheduled_start: `2026-01-${String(Number(id.split('-')[1]) + 1).padStart(2, '0')}T22:00:00.000Z`, format: 'single_elimination', win_target: 100, winner_id: null,
    }));
    mocks.fetchRegistrationsWithProfile.mockResolvedValue([]);
    mocks.fetchMatches.mockResolvedValue([]);
  });

  const get = (query: Record<string, unknown> = {}) => harness()('/api/tournaments/history', { headers: { authorization: 'Bearer token' }, query });

  it('returns the newest page, with the total and whether there is more', async () => {
    mocks.fetchRegistrationsForUser.mockResolvedValue(regs(25, 2));
    const { body } = await get();
    expect(body).toMatchObject({ ok: true, total: 25, limit: HISTORY_DEFAULT_LIMIT, offset: 0, hasMore: true });
    expect(body.history).toHaveLength(HISTORY_DEFAULT_LIMIT);
    // newest registration first: the 20 most recent are t-24 down to t-5
    expect(new Set(body.history.map((entry: { tournamentId: string }) => entry.tournamentId))).toEqual(new Set(Array.from({ length: 20 }, (_, i) => `t-${24 - i}`)));
  });

  it('reads the next page, and says when it is the last', async () => {
    mocks.fetchRegistrationsForUser.mockResolvedValue(regs(25));
    const { body } = await get({ limit: '10', offset: '20' });
    expect(body).toMatchObject({ total: 25, limit: 10, offset: 20, hasMore: false });
    expect(body.history).toHaveLength(5);
  });

  it('reads three things per tournament on the page, not per tournament the player has ever finished', async () => {
    mocks.fetchRegistrationsForUser.mockResolvedValue(regs(120));
    await get({ limit: '10' });
    expect(mocks.fetchTournamentById).toHaveBeenCalledTimes(10);
    expect(mocks.fetchRegistrationsWithProfile).toHaveBeenCalledTimes(10);
    expect(mocks.fetchMatches).toHaveBeenCalledTimes(10);
  });

  it('never has more than a handful of tournaments being read at once', async () => {
    mocks.fetchRegistrationsForUser.mockResolvedValue(regs(50));
    let inFlight = 0;
    let peak = 0;
    mocks.fetchTournamentById.mockImplementation(async (id: string) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return { id, kind: 'live', scheduled_start: '2026-01-01T22:00:00.000Z', format: 'single_elimination', win_target: 100, winner_id: null };
    });
    await get({ limit: '50' });
    expect(peak).toBeLessThanOrEqual(HISTORY_READ_CONCURRENCY);
    expect(peak).toBeGreaterThan(1);
  });

  it('clamps a huge limit and falls back to the defaults for rubbish', async () => {
    mocks.fetchRegistrationsForUser.mockResolvedValue(regs(60));
    expect((await get({ limit: '5000' })).body.limit).toBe(HISTORY_MAX_LIMIT);
    const rubbish = (await get({ limit: 'many', offset: '-4' })).body;
    expect(rubbish).toMatchObject({ limit: HISTORY_DEFAULT_LIMIT, offset: 0 });
  });

  it('does not count a tournament the player has not finished', async () => {
    mocks.fetchRegistrationsForUser.mockResolvedValue(regs(3, 5));
    const { body } = await get();
    expect(body.total).toBe(3);
    expect(body.history).toHaveLength(3);
  });

  it('refuses a caller who is not signed in', async () => {
    mocks.supabaseFetch.mockResolvedValue(null);
    const { status } = await harness()('/api/tournaments/history', { headers: {}, query: {} });
    expect(status).toBe(401);
  });
});

describe('the paging helpers', () => {
  it('parse a page from a query string', () => {
    expect(parseHistoryPage({})).toEqual({ limit: HISTORY_DEFAULT_LIMIT, offset: 0 });
    expect(parseHistoryPage({ limit: '7', offset: '14' })).toEqual({ limit: 7, offset: 14 });
    expect(parseHistoryPage({ limit: '0' }).limit).toBe(HISTORY_DEFAULT_LIMIT);
    expect(parseHistoryPage({ limit: 1e9 }).limit).toBe(HISTORY_MAX_LIMIT);
    expect(parseHistoryPage({ offset: 'x' }).offset).toBe(0);
  });

  it('mapInBatches keeps order and never exceeds its batch size', async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapInBatches([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 3));
      inFlight -= 1;
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50, 60, 70]);
    expect(peak).toBe(3);
    expect(await mapInBatches([], 3, async (n: number) => n)).toEqual([]);
  });
});
