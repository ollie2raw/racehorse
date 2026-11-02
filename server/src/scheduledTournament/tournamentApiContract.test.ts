/**
 * The tournament REST contract (Phase 2C), endpoint by endpoint: every body —
 * success, a known refusal, and an unexpected failure — carries `serverNow`
 * (ISO-8601 UTC with milliseconds, from the server clock); every error is
 * `{ ok: false, error, serverNow, retryAfterMs?, conflict? }`; an unexpected
 * failure is 500 `internal` and never echoes database text; tournament rows
 * expose `kind` and never `owner_user_id`.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerTournamentRoutes } from './routes';
import { SERVER_NOW_ISO } from './serverNow.testkit';
import { TournamentRpcError } from './persistence';

const USER = '11111111-1111-4111-8111-111111111111';
const OWNER = '33333333-3333-4333-8333-333333333333';
const TID = '22222222-2222-4222-8222-222222222222';
const DB_TEXT = 'relation "scheduled_tournaments" violates constraint secret_internal_name';

const DB_TEXT_HOISTED = 'auth upstream: relation "auth.sessions" secret_internal_name';
const mocks = vi.hoisted(() => ({
  authUser: null as string | null,
  authThrows: false,
  fetchUpcomingTournaments: vi.fn(),
  fetchRegistrations: vi.fn(),
  fetchRegistrationsForUser: vi.fn(),
  fetchTournamentById: vi.fn(),
  fetchTournamentsByIds: vi.fn(),
  fetchMatchesForTournaments: vi.fn(),
  fetchRegistrationsWithProfile: vi.fn(),
  fetchBracketView: vi.fn(),
  fetchActiveAssignedMatchForUser: vi.fn(),
  registerForTournament: vi.fn(),
  withdrawFromTournament: vi.fn(),
  startOrResumeFritzCup: vi.fn(),
}));

vi.mock('@sentry/node', () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock('../supabaseUtils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../supabaseUtils')>()),
  supabaseFetch: vi.fn(async () => []),
}));
vi.mock('../platform/auth/supabaseAuth', () => ({ isGuestBearerToken: async () => false, verifyBearerToken: async () => {
  if (mocks.authThrows) throw new Error(DB_TEXT_HOISTED);
  return mocks.authUser;
} }));
vi.mock('./fritzCup', () => ({ startOrResumeFritzCup: (...a: unknown[]) => mocks.startOrResumeFritzCup(...a) }));
vi.mock('./persistence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./persistence')>();
  const pass = (name: keyof typeof mocks) => (...a: unknown[]) => (mocks[name] as (...x: unknown[]) => unknown)(...a);
  return {
    ...actual,
    fetchUpcomingTournaments: pass('fetchUpcomingTournaments'),
    fetchRegistrations: pass('fetchRegistrations'),
    fetchRegistrationsForUser: pass('fetchRegistrationsForUser'),
    fetchTournamentById: pass('fetchTournamentById'),
    fetchTournamentsByIds: pass('fetchTournamentsByIds'),
    fetchMatchesForTournaments: pass('fetchMatchesForTournaments'),
    fetchRegistrationsWithProfile: pass('fetchRegistrationsWithProfile'),
    fetchBracketView: pass('fetchBracketView'),
    fetchActiveAssignedMatchForUser: pass('fetchActiveAssignedMatchForUser'),
    registerForTournament: pass('registerForTournament'),
    withdrawFromTournament: pass('withdrawFromTournament'),
  };
});

const row = (over: Record<string, unknown> = {}) => ({
  id: TID,
  scheduled_start: '2026-10-09T20:00:00.000Z',
  registration_open_at: '2026-10-09T08:00:00.000Z',
  registration_close_at: '2026-10-09T19:58:00.000Z',
  status: 'completed',
  format: 'single_elimination',
  win_target: 100,
  max_players: 8,
  winner_id: USER,
  kind: 'fritz_cup',
  owner_user_id: OWNER,
  ...over,
});

type RouteHandler = (req: any, res: any) => unknown | Promise<unknown>;
let ipSeq = 0;

function makeApp() {
  const routes = new Map<string, RouteHandler>();
  const app = {
    get: (p: string, h: RouteHandler) => { routes.set(`GET ${p}`, h); },
    post: (p: string, h: RouteHandler) => { routes.set(`POST ${p}`, h); },
    delete: (p: string, h: RouteHandler) => { routes.set(`DELETE ${p}`, h); },
  };
  registerTournamentRoutes(app as any, { to: () => ({ emit: vi.fn() }), in: () => ({ fetchSockets: async () => [] }) } as any);
  ipSeq += 1;
  const ip = `198.51.100.${ipSeq % 250}`;
  return async (method: string, path: string, opts: { params?: Record<string, string>; auth?: boolean } = {}) => {
    const handler = routes.get(`${method} ${path}`);
    if (!handler) throw new Error(`missing route ${method} ${path}`);
    let status = 200;
    let body: any;
    const headers: Record<string, string> = {};
    const res: any = {
      headersSent: false,
      status: (c: number) => { status = c; return res; },
      json: (b: unknown) => { body = b; res.headersSent = true; return res; },
      setHeader: (k: string, v: string) => { headers[k] = v; return res; },
    };
    const before = Date.now();
    await handler({
      headers: opts.auth === false ? {} : { authorization: 'Bearer t' },
      params: opts.params ?? {},
      body: {},
      query: {},
      ip,
      socket: { remoteAddress: ip },
    }, res);
    const after = Date.now();
    return { status, body, headers, before, after };
  };
}

/** The contract every body must meet, whatever the endpoint and outcome. */
function expectContract(r: { status: number; body: any; before: number; after: number }) {
  expect(r.body.serverNow).toMatch(SERVER_NOW_ISO);
  const t = Date.parse(r.body.serverNow);
  expect(t).toBeGreaterThanOrEqual(r.before);
  expect(t).toBeLessThanOrEqual(r.after);
  expect(JSON.stringify(r.body)).not.toContain('owner_user_id');
  expect(JSON.stringify(r.body)).not.toContain(OWNER);
  if (r.status >= 400) {
    expect(r.body.ok).toBe(false);
    expect(typeof r.body.error).toBe('string');
  } else {
    expect(r.body.ok).toBe(true);
  }
}

function expectInternal(r: { status: number; body: any; before: number; after: number }) {
  expectContract(r);
  expect(r.status).toBe(500);
  expect(Object.keys(r.body).sort()).toEqual(['error', 'ok', 'serverNow']);
  expect(r.body.error).toBe('internal');
  expect(JSON.stringify(r.body)).not.toContain('secret_internal_name');
}

beforeEach(() => {
  vi.stubEnv('TOURNAMENTS_ENABLED', 'true');
  vi.stubEnv('FRITZ_CUP_ENABLED', 'true');
  for (const fn of Object.values(mocks)) if (typeof fn === 'function') (fn as any).mockReset();
  mocks.authUser = USER;
  mocks.authThrows = false;
  mocks.fetchUpcomingTournaments.mockResolvedValue([row({ status: 'registration_open', kind: 'live', owner_user_id: null })]);
  mocks.fetchRegistrations.mockResolvedValue([]);
  mocks.fetchRegistrationsForUser.mockResolvedValue([{ tournament_id: TID, user_id: USER, status: 'eliminated', placement: 1 }]);
  mocks.fetchTournamentById.mockResolvedValue(row());
  mocks.fetchTournamentsByIds.mockResolvedValue([row()]);
  mocks.fetchMatchesForTournaments.mockResolvedValue(new Map());
  mocks.fetchRegistrationsWithProfile.mockResolvedValue([{ user_id: USER, username: 'u', placement: 1, seed: 1, status: 'eliminated' }]);
  mocks.fetchBracketView.mockResolvedValue({
    tournament: row(),
    registrations: [{ user_id: USER, username: 'u', placement: 1, seed: 1, status: 'eliminated' }],
    matches: [],
  });
  mocks.fetchActiveAssignedMatchForUser.mockResolvedValue(null);
  mocks.registerForTournament.mockResolvedValue({ registered: true });
  mocks.withdrawFromTournament.mockResolvedValue(undefined);
  mocks.startOrResumeFritzCup.mockResolvedValue({ existing: false, tournament: row({ status: 'registration_open' }) });
});
afterAll(() => { vi.unstubAllEnvs(); });

const P = { params: { id: TID } };
type Case = {
  name: string;
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  opts?: { params?: Record<string, string> };
  /** Make the endpoint's main read/write fail with database text. */
  breakIt: () => void;
  /** A known refusal: status + error code. */
  refuse: { setup: () => void; status: number; error: string; opts?: { params?: Record<string, string>; auth?: boolean } };
  /** Where the response carries tournament rows, each must expose `kind`. */
  kinds?: (body: any) => unknown[];
};

const dbFail = (fn: ReturnType<typeof vi.fn>) => () => fn.mockRejectedValue(new Error(DB_TEXT));
const noAuth = () => { mocks.authUser = null; };

const CASES: Case[] = [
  {
    name: 'GET /upcoming', method: 'GET', path: '/api/tournaments/upcoming',
    breakIt: dbFail(mocks.fetchUpcomingTournaments),
    refuse: { setup: () => mocks.fetchUpcomingTournaments.mockRejectedValue(new Error('request timed out')), status: 503, error: 'upstream_timeout' },
    kinds: (b) => b.tournaments.map((t: any) => t.kind),
  },
  {
    name: 'POST /fritz-cup', method: 'POST', path: '/api/tournaments/fritz-cup',
    breakIt: dbFail(mocks.startOrResumeFritzCup),
    refuse: { setup: noAuth, status: 401, error: 'not_authenticated' },
    kinds: (b) => [b.kind, b.tournament.kind],
  },
  {
    name: 'GET /my', method: 'GET', path: '/api/tournaments/my',
    breakIt: dbFail(mocks.fetchRegistrationsForUser),
    refuse: { setup: noAuth, status: 401, error: 'not_authenticated' },
  },
  {
    name: 'GET /me', method: 'GET', path: '/api/tournaments/me',
    breakIt: dbFail(mocks.fetchRegistrationsForUser),
    // /me never refuses: an anonymous caller gets the empty state (still with serverNow).
    refuse: { setup: noAuth, status: 200, error: '' },
  },
  {
    name: 'GET /history', method: 'GET', path: '/api/tournaments/history',
    breakIt: dbFail(mocks.fetchRegistrationsForUser),
    refuse: { setup: noAuth, status: 401, error: 'not_authenticated' },
    kinds: (b) => b.history.map((h: any) => h.kind),
  },
  {
    name: 'GET /:id/bracket', method: 'GET', path: '/api/tournaments/:id/bracket', opts: P,
    breakIt: dbFail(mocks.fetchBracketView),
    refuse: { setup: () => mocks.fetchBracketView.mockResolvedValue(null), status: 404, error: 'not_found', opts: P },
    kinds: (b) => [b.view.tournament.kind],
  },
  {
    name: 'GET /:id', method: 'GET', path: '/api/tournaments/:id', opts: P,
    breakIt: dbFail(mocks.fetchTournamentById),
    refuse: { setup: () => {}, status: 400, error: 'invalid_tournament_id', opts: { params: { id: 'nope' } } },
    kinds: (b) => [b.tournament.kind],
  },
  {
    name: 'GET /:id/result', method: 'GET', path: '/api/tournaments/:id/result', opts: P,
    breakIt: dbFail(mocks.fetchBracketView),
    refuse: {
      setup: () => mocks.fetchBracketView.mockResolvedValue({ tournament: row({ status: 'in_progress' }), registrations: [], matches: [] }),
      status: 409, error: 'not_completed', opts: P,
    },
    kinds: (b) => [b.result.kind],
  },
  {
    name: 'POST /:id/register', method: 'POST', path: '/api/tournaments/:id/register', opts: P,
    breakIt: dbFail(mocks.registerForTournament),
    refuse: { setup: () => mocks.registerForTournament.mockRejectedValue(new Error('tournament_full')), status: 409, error: 'tournament_full', opts: P },
  },
  {
    name: 'DELETE /:id/register', method: 'DELETE', path: '/api/tournaments/:id/register', opts: P,
    breakIt: dbFail(mocks.withdrawFromTournament),
    refuse: { setup: () => mocks.withdrawFromTournament.mockRejectedValue(new Error('withdraw_closed')), status: 409, error: 'withdraw_closed', opts: P },
  },
];

describe('tournament REST contract (Phase 2C)', () => {
  it('covers every registered tournament route', () => {
    const seen: string[] = [];
    const app = {
      get: (p: string) => { seen.push(`GET ${p}`); },
      post: (p: string) => { seen.push(`POST ${p}`); },
      delete: (p: string) => { seen.push(`DELETE ${p}`); },
    };
    registerTournamentRoutes(app as any);
    expect(seen.sort()).toEqual(CASES.map((c) => `${c.method} ${c.path}`).sort());
  });

  for (const c of CASES) {
    describe(c.name, () => {
      it('success carries serverNow (and kind, never the owner id)', async () => {
        const r = await makeApp()(c.method, c.path, c.opts);
        expect(r.status).toBe(200);
        expectContract(r);
        if (c.kinds) {
          const kinds = c.kinds(r.body);
          expect(kinds.length).toBeGreaterThan(0);
          for (const k of kinds) expect(['live', 'fritz_cup']).toContain(k);
        }
      });

      it('a known refusal carries ok:false, its code and serverNow', async () => {
        c.refuse.setup();
        const r = await makeApp()(c.method, c.path, c.refuse.opts ?? c.opts);
        expect(r.status).toBe(c.refuse.status);
        expect(r.body.serverNow).toMatch(SERVER_NOW_ISO);
        if (c.refuse.error) {
          expectContract(r);
          expect(r.body.error).toBe(c.refuse.error);
        }
      });

      it('an unexpected database failure is 500 internal with serverNow, no database text', async () => {
        c.breakIt();
        expectInternal(await makeApp()(c.method, c.path, c.opts));
      });
    });
  }

  it('the feature switch body carries serverNow on refused and empty-state routes', async () => {
    vi.stubEnv('TOURNAMENTS_ENABLED', 'false');
    const request = makeApp();
    const refused = await request('POST', '/api/tournaments/:id/register', P);
    expect(refused.status).toBe(403);
    expectContract(refused);
    expect(refused.body.error).toBe('tournaments_disabled');
    const empty = await request('GET', '/api/tournaments/upcoming');
    expectContract(empty);
    expect(empty.body).toMatchObject({ ok: true, disabled: true, tournaments: [] });
  });

  it('a throw outside a handler\'s own try (the auth verifier) is 500 internal on every authenticated route', async () => {
    mocks.authThrows = true;
    const authenticated = ['POST /fritz-cup', 'GET /my', 'GET /me', 'GET /history', 'POST /:id/register', 'DELETE /:id/register'];
    for (const c of CASES.filter((x) => authenticated.includes(x.name))) {
      const r = await makeApp()(c.method, c.path, c.opts);
      expectInternal(r);
    }
  });

  describe('POST /fritz-cup refusals', () => {
    it('cooldown: 429 fritz_cup_cooldown with retryAfterMs and serverNow', async () => {
      mocks.startOrResumeFritzCup.mockRejectedValue(
        new TournamentRpcError('fritz_cup_cooldown', { retry_after_ms: 41_234.2, reason: 'cooldown' }),
      );
      const r = await makeApp()('POST', '/api/tournaments/fritz-cup');
      expect(r.status).toBe(429);
      expectContract(r);
      expect(r.body).toMatchObject({ ok: false, error: 'fritz_cup_cooldown', retryAfterMs: 41_235, reason: 'cooldown' });
    });

    it('overlap: 409 with the conflicting tournament and serverNow', async () => {
      mocks.startOrResumeFritzCup.mockRejectedValue(
        new TournamentRpcError('overlapping_tournament', { tournament_id: TID, kind: 'live', scheduled_start: '2026-10-09T20:00:00.000Z' }),
      );
      const r = await makeApp()('POST', '/api/tournaments/fritz-cup');
      expect(r.status).toBe(409);
      expectContract(r);
      expect(r.body.error).toBe('overlapping_tournament');
      expect(r.body.conflict).toBeTruthy();
    });

    it('the IP limiter: the 11th request in the window is a normalized 429 rate_limited', async () => {
      const request = makeApp();
      for (let i = 0; i < 10; i += 1) expect((await request('POST', '/api/tournaments/fritz-cup')).status).toBe(200);
      const r = await request('POST', '/api/tournaments/fritz-cup');
      expect(r.status).toBe(429);
      expectContract(r);
      expect(Object.keys(r.body).sort()).toEqual(['error', 'ok', 'retryAfterMs', 'serverNow']);
      expect(r.body).toMatchObject({ ok: false, error: 'rate_limited' });
      expect(r.body.retryAfterMs).toBeGreaterThan(0);
      expect(r.headers['Retry-After']).toBeTruthy();
      expect(mocks.startOrResumeFritzCup).toHaveBeenCalledTimes(10);
    });
  });
});
