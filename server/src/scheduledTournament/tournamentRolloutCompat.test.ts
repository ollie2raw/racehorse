/**
 * Phase 2B.1: pre-start cancellation is conditional, and the new server is
 * safe to deploy before M1 (with FRITZ_CUP_ENABLED off).
 *
 *  - cancelTournamentBeforeStart is one conditional PATCH (status still
 *    upcoming / registration_open) and reports whether it cancelled; the
 *    engine never cancels a tournament another starter has already moved on.
 *    (The race itself is proven on PostgreSQL by tournament-db-verify.sh §9.)
 *  - Every database request the Live Event paths make — reads, registration,
 *    withdrawal, lifecycle, bracket, results, recovery reads — is recorded
 *    against pre-M1 rows (no kind / owner_user_id) and must not name an
 *    M1-only object.
 *  - With the flag off, POST /api/tournaments/fritz-cup makes no database call.
 *  - /upcoming's Node-side kind filter cannot let cups displace Live Events.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Req = { path: string; method: string; body: string | undefined };
const h = vi.hoisted(() => ({
  requests: [] as Array<{ path: string; method: string; body: string | undefined }>,
  respond: null as null | ((path: string, method: string) => unknown),
}));

vi.mock('../platform/auth/supabaseAuth', () => ({
  verifyBearerToken: async (token: string | null | undefined) => (/^[0-9a-f-]{36}$/i.test(token ?? '') ? token! : null),
}));
vi.mock('../supabaseUtils', () => ({
  isSupabaseTimeoutError: () => false,
  supabaseFetch: vi.fn(async (path: string, init?: { method?: string; body?: string }) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    h.requests.push({ path, method, body: init?.body });
    const custom = h.respond?.(path, method);
    return custom === undefined ? [] : custom;
  }),
}));

import { cancelTournamentBeforeStart as cancelInDb } from './persistence';
import * as persistence from './persistence';
import { closeRegistrationAndStart } from './engine';
import { registerTournamentRoutes } from './routes';
import type { EnginePersistence } from './persistenceInterface';

afterAll(() => { vi.unstubAllEnvs(); });
beforeEach(() => {
  h.requests = [];
  h.respond = null;
  vi.stubEnv('TOURNAMENTS_ENABLED', 'true');
  vi.stubEnv('FRITZ_CUP_ENABLED', '');
});

const T = '5a000000-0000-4000-8000-000000000001';
const U = '5a000000-0000-4000-8000-0000000000a1';
/** A scheduled_tournaments row as the pre-M1 schema returns it: no kind, no owner_user_id. */
const preM1Row = (id: string, partial: Record<string, unknown> = {}) => ({
  id, scheduled_start: new Date(Date.now() + 30 * 60_000).toISOString(), registration_open_at: new Date().toISOString(),
  registration_close_at: new Date(Date.now() + 28 * 60_000).toISOString(), status: 'registration_open', format: '7-tile',
  win_target: 30, max_players: 8, winner_id: null, created_at: new Date().toISOString(), cancel_reason: null, ...partial,
});
const M1_ONLY = /\bkind\b|owner_user_id|start_fritz_cup|_tournament_user_conflict/;
const mentionsM1 = (r: Req) => M1_ONLY.test(r.path) || M1_ONLY.test(r.body ?? '');

function makeApp() {
  const routes = new Map<string, (req: any, res: any) => unknown>();
  const app = {
    get: (path: string, handler: any) => { routes.set(`GET ${path}`, handler); },
    post: (path: string, handler: any) => { routes.set(`POST ${path}`, handler); },
    delete: (path: string, handler: any) => { routes.set(`DELETE ${path}`, handler); },
  };
  registerTournamentRoutes(app as any, { emit: vi.fn(), sockets: { sockets: new Map() }, to: () => ({ emit: vi.fn() }) } as any);
  return async (method: string, path: string, opts: { as?: string; params?: Record<string, string> } = {}) => {
    let status = 200;
    let body: any;
    const res: any = { status: (c: number) => { status = c; return res; }, json: (b: unknown) => { body = b; return res; }, setHeader: () => res };
    await routes.get(`${method} ${path}`)!({
      headers: opts.as ? { authorization: `Bearer ${opts.as}` } : {}, params: opts.params ?? {}, body: {}, query: {},
      ip: '198.51.100.7', socket: { remoteAddress: '198.51.100.7' },
    }, res);
    return { status, body };
  };
}

describe('pre-start cancellation is conditional', () => {
  it('is one PATCH filtered on the pre-start statuses, and reports whether it cancelled', async () => {
    h.respond = () => [{ id: T }];
    expect(await cancelInDb(T, 'not_enough_players')).toBe(true);
    expect(h.requests).toEqual([{
      path: `/rest/v1/scheduled_tournaments?id=eq.${T}&status=in.(upcoming,registration_open)&select=id`,
      method: 'PATCH',
      body: JSON.stringify({ status: 'cancelled', cancel_reason: 'not_enough_players' }),
    }]);

    h.respond = () => [];
    expect(await cancelInDb(T, 'not_enough_players')).toBe(false);
  });

  /** An engine persistence double whose conditional cancel behaves as the database does. */
  function engineDouble(status: string, cancelReason: string | null = null) {
    const row = { ...preM1Row(T), status, cancel_reason: cancelReason };
    const io = { emit: vi.fn() } as any;
    const p = {
      fetchRegistrations: async () => [],
      fetchTournamentById: async () => ({ ...row }),
      updateTournamentStatus: vi.fn(),
      cancelTournamentBeforeStart: vi.fn(async (_id: string, reason: string) => {
        if (row.status !== 'upcoming' && row.status !== 'registration_open') return false;
        Object.assign(row, { status: 'cancelled', cancel_reason: reason });
        return true;
      }),
    } as unknown as EnginePersistence;
    return { row, io, p };
  }

  it('a truly empty Live Event in registration is still cancelled with not_enough_players', async () => {
    const { row, io, p } = engineDouble('registration_open');
    expect(await closeRegistrationAndStart(io, T, p)).toEqual({ started: false, reason: 'not_enough_players' });
    expect(row).toMatchObject({ status: 'cancelled', cancel_reason: 'not_enough_players' });
    expect(io.emit).toHaveBeenCalledWith('tournament:cancelled', { tournamentId: T });
    expect(p.updateTournamentStatus).not.toHaveBeenCalled(); // never the unconditional write
  });

  it('a tournament another starter already started is not cancelled (reported as started, no cancel event)', async () => {
    const { row, io, p } = engineDouble('in_progress');
    expect(await closeRegistrationAndStart(io, T, p)).toEqual({ started: true, reason: 'already_left_registration' });
    expect(row.status).toBe('in_progress');
    expect(io.emit).not.toHaveBeenCalled();
  });

  it('completed and already-cancelled tournaments are left exactly as they are', async () => {
    for (const [status, reason] of [['completed', null], ['cancelled', 'active_window_expired']] as const) {
      const { row, io, p } = engineDouble(status, reason);
      expect(await closeRegistrationAndStart(io, T, p)).toEqual({ started: false, reason: 'already_left_registration' });
      expect(row).toMatchObject({ status, cancel_reason: reason });
      expect(io.emit).not.toHaveBeenCalled();
    }
  });
});

describe('the new server before M1 (FRITZ_CUP_ENABLED off)', () => {
  it('no Live Event database request names an M1-only object (reads, registration, lifecycle, bracket, results, recovery reads)', async () => {
    h.respond = (path, method) => {
      if (path.startsWith('/rest/v1/scheduled_tournaments') && method === 'GET') return [preM1Row(T)];
      if (path.includes('/rpc/register_for_tournament')) return { registered: true, already_registered: false, seats_taken: 1 };
      if (path.includes('/rpc/withdraw_from_tournament')) return { withdrawn: true };
      if (path.includes('/rpc/generate_tournament_bracket')) return { created: true, repaired: false, matches: [] };
      if (path.includes('/rpc/complete_tournament_match')) return { status: 'completed', applied: true, conflict: false };
      if (path.includes('/rpc/promote_tournament_match')) return { applied: true };
      return undefined;
    };
    const calls: Array<[string, () => Promise<unknown>]> = [
      ['upcoming', () => persistence.fetchUpcomingTournaments(5)],
      ['tournament', () => persistence.fetchTournamentById(T)],
      ['tournaments by ids (/me)', () => persistence.fetchTournamentsByIds([T])],
      ['registrations for user (/my, /me, history)', () => persistence.fetchRegistrationsForUser(U)],
      ['matches for tournaments (/me)', () => persistence.fetchMatchesForTournaments([T])],
      ['active assigned match (/me, recovery)', () => persistence.fetchActiveAssignedMatchForUser(U)],
      ['register', () => persistence.registerForTournament(T, U)],
      ['withdraw', () => persistence.withdrawFromTournament(T, U)],
      ['due lifecycle (scheduler tick)', () => persistence.fetchDueLifecycleTournaments(new Date())],
      ['by status (scheduler tick, recovery)', () => persistence.fetchTournamentsByStatus(['in_progress'])],
      ['open registration', () => persistence.updateTournamentStatus(T, 'registration_open')],
      ['cancel before start', () => persistence.cancelTournamentBeforeStart(T, 'not_enough_players')],
      ['registrations', () => persistence.fetchRegistrations(T)],
      ['registrations with profile (start)', () => persistence.fetchRegistrationsWithProfile(T)],
      ['bracket', () => persistence.generateTournamentBracket({ tournamentId: T, qfPairs: [], seeds: [], actor: 'compat' })],
      ['matches', () => persistence.fetchMatches(T)],
      ['match', () => persistence.fetchMatchById(T)],
      ['match by room code', () => persistence.fetchMatchByRoomCode('TABCDEFR1M1')],
      ['update match (dispatch)', () => persistence.updateMatch(T, { status: 'ready' })],
      ['promote match', () => persistence.promoteTournamentMatch(T, 'in_progress')],
      ['result', () => persistence.completeTournamentMatch({ matchId: T, winnerId: U, winnerSource: 'game_over' })],
      ['bracket view', () => persistence.fetchBracketView(T)],
    ];
    for (const [label, call] of calls) {
      const before = h.requests.length;
      await call().catch(() => undefined);
      expect(h.requests.length, `${label} made no request`).toBeGreaterThan(before);
    }
    const offending = h.requests.filter(mentionsM1);
    expect(offending).toEqual([]);
  });

  it('/upcoming, /my and /me answer from pre-M1 rows; Live Events default to kind live', async () => {
    h.respond = (path, method) => {
      if (path.startsWith('/rest/v1/scheduled_tournaments?select=*&scheduled_start=gte') && path.includes('status=in.')) return [preM1Row(T)];
      if (path.startsWith('/rest/v1/scheduled_tournament_registrations') && method === 'GET') {
        return [{ id: 'r1', tournament_id: T, user_id: U, status: 'registered', seed: null, placement: null, registered_at: new Date().toISOString() }];
      }
      if (path.startsWith('/rest/v1/scheduled_tournaments') && method === 'GET') return [preM1Row(T)];
      return undefined;
    };
    const request = makeApp();
    const upcoming = await request('GET', '/api/tournaments/upcoming');
    expect(upcoming.body.tournaments).toEqual([expect.objectContaining({ id: T, kind: 'live' })]);
    expect((await request('GET', '/api/tournaments/my', { as: U })).body).toMatchObject({ ok: true, registrations: [expect.objectContaining({ tournament_id: T })] });
    expect((await request('GET', '/api/tournaments/me', { as: U })).body).toMatchObject({ ok: true, activeTournamentId: T });
    expect(h.requests.filter(mentionsM1)).toEqual([]);
  });

  it('flag off: POST /api/tournaments/fritz-cup returns before any database call (no start_fritz_cup, nothing at all)', async () => {
    for (const flag of ['', 'false', 'FALSE', '1']) {
      vi.stubEnv('FRITZ_CUP_ENABLED', flag);
      h.requests = [];
      const res = await makeApp()('POST', '/api/tournaments/fritz-cup', { as: U });
      expect(res).toMatchObject({ status: 403, body: { ok: false, error: 'tournaments_disabled' } });
      expect(h.requests).toEqual([]);
    }
  });

  it('flag on before M1 (a misconfiguration): the missing RPC is a plain 500 internal, nothing else touched', async () => {
    vi.stubEnv('FRITZ_CUP_ENABLED', 'true');
    h.respond = (path) => {
      if (path.includes('/rpc/start_fritz_cup')) {
        throw new Error('Supabase request failed: 404 {"code":"PGRST202","details":"Searched for the function public.start_fritz_cup","hint":null,"message":"Could not find the function public.start_fritz_cup(p_user_id) in the schema cache"}');
      }
      return undefined;
    };
    const res = await makeApp()('POST', '/api/tournaments/fritz-cup', { as: U });
    expect(res).toMatchObject({ status: 500, body: { ok: false, error: 'internal' } });
    expect(h.requests.map((r) => r.path)).toEqual(['/rest/v1/rpc/start_fritz_cup']);
  });
});

describe('/upcoming kind filter', () => {
  it('reads past its limit, so cups that briefly pass the time filter cannot displace Live Events', async () => {
    const soon = (ms: number) => new Date(Date.now() + ms).toISOString();
    const cups = Array.from({ length: 5 }, (_, i) => ({ ...preM1Row(`cup-${i}`, { scheduled_start: soon(1 + i) }), kind: 'fritz_cup', owner_user_id: U }));
    const lives = Array.from({ length: 6 }, (_, i) => ({ ...preM1Row(`live-${i}`, { scheduled_start: soon(60_000 * (i + 1)) }), kind: 'live' }));
    h.respond = (path) => {
      if (!path.startsWith('/rest/v1/scheduled_tournaments?select=*&scheduled_start=gte')) return undefined;
      const limit = Number(/limit=(\d+)/.exec(path)![1]);
      return path.includes('status=in.') ? [...cups, ...lives].slice(0, limit) : [];
    };

    const result = await persistence.fetchUpcomingTournaments(5);

    expect(result.map((t) => t.id)).toEqual(['live-0', 'live-1', 'live-2', 'live-3', 'live-4']);
    expect(h.requests.every((r) => /limit=25/.test(r.path))).toBe(true);
  });
});
