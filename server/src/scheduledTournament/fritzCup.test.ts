/**
 * Fritz Cup orchestration (Phase 2B): POST /api/tournaments/fritz-cup →
 * start_fritz_cup → the existing engine (closeRegistrationAndStart →
 * generate_tournament_bracket → dispatchScheduledStartMatches), crash recovery
 * through the ordinary scheduler tick, overlap and abuse refusals as HTTP, and
 * kind filtering.
 *
 * Real: the route, fritzCup.ts, the engine, the scheduler tick, dispatch,
 * rooms, recovery, the in-memory ports of the match and bracket RPCs
 * (inMemoryMatchRpc.testkit). Faked: the Supabase reads/writes in
 * `./persistence`, including in-memory ports of start_fritz_cup and
 * register_for_tournament (with the per-user lock as a per-user promise chain).
 * The database rules themselves — the advisory lock, the overlap query, the
 * limits, scheduled_start collisions — are proven against real PostgreSQL by
 * scripts/tournament-db-verify.sh §8; these tests prove the server around them.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;
const h = vi.hoisted(() => ({
  tournaments: new Map<string, Record<string, any>>(),
  matchesByTournament: new Map<string, Array<Record<string, any>>>(),
  regs: [] as Array<Record<string, any>>,
  liveSessions: new Map<string, Record<string, unknown>>(),
  /** Extra milliseconds on the fake database clock. */
  skewMs: 0,
  startFritzCupCalls: 0,
  failNextRpc: null as null | string,
  bracketFailures: 0,
  upcomingRows: [] as Array<Record<string, any>>,
}));

vi.mock('@sentry/node', () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock('../social/activityWriter', () => ({
  writeTournamentActivity: vi.fn().mockResolvedValue(undefined),
  writeMatchActivity: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../platform/auth/supabaseAuth', () => ({
  // The bearer token is the user's uuid.
  verifyBearerToken: async (token: string | null | undefined) =>
    (/^[0-9a-f-]{36}$/i.test(token ?? '') ? token! : null),
}));
vi.mock('../supabaseUtils', () => ({
  isSupabaseTimeoutError: () => false,
  supabaseFetch: vi.fn(async (path: string, init?: { method?: string; body?: string }) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    if (path.startsWith('/rest/v1/room_live_sessions')) {
      if (method === 'POST') {
        for (const row of JSON.parse(init!.body!) as Array<Record<string, unknown>>) h.liveSessions.set(String(row.room_code), structuredClone(row));
        return [];
      }
      const code = decodeURIComponent(/room_code=eq\.([^&]+)/.exec(path)?.[1] ?? '');
      if (method === 'DELETE') { h.liveSessions.delete(code); return []; }
      const row = h.liveSessions.get(code);
      return row ? [structuredClone(row)] : [];
    }
    if (path.startsWith('/rest/v1/scheduled_tournaments?select=*&scheduled_start=gte')) {
      const wantInProgress = path.includes('status=eq.in_progress');
      return h.upcomingRows.filter((r) => (r.status === 'in_progress') === wantInProgress).map((r) => structuredClone(r));
    }
    return [];
  }),
}));

vi.mock('./persistence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./persistence')>();
  // Loaded on first use: the kit imports the engine, which imports this (mocked) module.
  const kit = () => vi.importActual<typeof import('./inMemoryMatchRpc.testkit')>('./inMemoryMatchRpc.testkit');
  const { TournamentRpcError } = actual;
  const nowMs = () => Date.now() + h.skewMs;
  const HOLD_MS = 2 * 60 * 60_000;
  const matchesOf = (tid: string) => {
    if (!h.matchesByTournament.has(tid)) h.matchesByTournament.set(tid, []);
    return h.matchesByTournament.get(tid)!;
  };
  const allMatches = () => [...h.matchesByTournament.values()].flat();
  const tidOfMatch = (matchId: string) => allMatches().find((m) => m.id === matchId)?.tournament_id as string;
  const rpcFor = async (tid: string) => (await kit()).inMemoryMatchRpcForArrayStore({
    tournament: h.tournaments.get(tid) as any,
    matches: matchesOf(tid) as any,
    get regs() { return h.regs.filter((r) => r.tournament_id === tid) as any; },
  });

  // Per-user lock: the in-memory stand-in for pg_advisory_xact_lock('tournament_user:' || user).
  const userLocks = new Map<string, Promise<unknown>>();
  const withUserLock = <T>(userId: string, fn: () => Promise<T> | T): Promise<T> => {
    const prev = userLocks.get(userId) ?? Promise.resolve();
    const next = prev.then(() => new Promise<void>((r) => setImmediate(r))).then(fn);
    userLocks.set(userId, next.catch(() => undefined));
    return next;
  };
  // _tournament_user_conflict
  const conflictFor = (userId: string, startMs: number, excludeId: string | null) => {
    const held = h.regs
      .filter((r) => r.user_id === userId && (r.status === 'registered' || r.status === 'active'))
      .map((r) => h.tournaments.get(r.tournament_id))
      .filter((t): t is Row => Boolean(t) && ['upcoming', 'registration_open', 'in_progress'].includes(t!.status) && t!.id !== excludeId)
      .filter((t) => Date.parse(t.scheduled_start) < startMs + HOLD_MS && startMs < Date.parse(t.scheduled_start) + HOLD_MS)
      .sort((a, b) => Date.parse(a.scheduled_start) - Date.parse(b.scheduled_start));
    return held[0] ?? null;
  };
  const overlapError = (t: Row) => new TournamentRpcError('overlapping_tournament', {
    tournament_id: t.id, kind: t.kind, scheduled_start: t.scheduled_start,
  });

  return {
    ...actual,
    fetchTournamentById: async (id: string) => structuredClone(h.tournaments.get(id) ?? null),
    fetchTournamentsByIds: async (ids: string[]) => ids.map((id) => structuredClone(h.tournaments.get(id))).filter(Boolean),
    fetchTournamentsByStatus: async (statuses: string[]) =>
      [...h.tournaments.values()].filter((t) => statuses.includes(t.status)).map((t) => structuredClone(t)),
    fetchDueLifecycleTournaments: async (now: Date) =>
      [...h.tournaments.values()]
        .filter((t) => t.status === 'registration_open' || (t.status === 'upcoming' && Date.parse(t.registration_open_at) <= now.getTime()))
        .map((t) => structuredClone(t)),
    fetchMatches: async (tid: string) => structuredClone(matchesOf(tid)),
    fetchMatchesForTournaments: async (ids: string[]) => new Map(ids.map((id) => [id, structuredClone(matchesOf(id))] as const)),
    fetchMatchById: async (id: string) => structuredClone(allMatches().find((m) => m.id === id) ?? null),
    fetchMatchByRoomCode: async (code: string) => structuredClone(allMatches().find((m) => m.room_code === code) ?? null),
    fetchRegistrations: async (tid: string) => structuredClone(h.regs.filter((r) => r.tournament_id === tid)),
    fetchRegistrationsWithProfile: async (tid: string) =>
      structuredClone(h.regs.filter((r) => r.tournament_id === tid).map((r) => ({ ...r, username: `user-${String(r.user_id).slice(-2)}`, rating: 800 }))),
    fetchRegistrationsForUser: async (userId: string) => structuredClone(h.regs.filter((r) => r.user_id === userId)),
    fetchActiveAssignedMatchForUser: async (userId: string) => {
      const match = allMatches().find((m) => (m.player1_id === userId || m.player2_id === userId) && (m.status === 'ready' || m.status === 'in_progress'));
      if (!match) return null;
      return { match: structuredClone(match), tournament: structuredClone(h.tournaments.get(match.tournament_id)), opponentUsername: null };
    },
    updateMatch: async (id: string, patch: Row) => { Object.assign(allMatches().find((m) => m.id === id) ?? {}, patch); },
    // The conditional match write (updateMatchIf), over this fake's rows.
    updateMatchIf: async (id: string, expected: Record<string, unknown>, patch: Record<string, unknown>) => {
      const row = allMatches().find((m) => m.id === id);
      if (!row || Object.entries(expected).some(([k, v]) => (row[k] ?? null) !== (v ?? null))) return false;
      Object.assign(row, patch);
      return true;
    },
    updateTournamentStatus: async (id: string, status: string, extra: Row = {}) => { Object.assign(h.tournaments.get(id) ?? {}, { status, ...extra }); },
    updateRegistrationPlacement: async () => {},
    openRegistrationIfDue: async (id: string, now: Date) => {
      const t = h.tournaments.get(id);
      if (!t || t.status !== 'upcoming' || Date.parse(t.registration_open_at) > now.getTime()) return false;
      t.status = 'registration_open';
      return true;
    },
    // The conditional PATCH: only a tournament still before its start is cancelled.
    cancelTournamentBeforeStart: async (id: string, reason: string) => {
      const t = h.tournaments.get(id);
      if (!t || (t.status !== 'upcoming' && t.status !== 'registration_open')) return false;
      Object.assign(t, { status: 'cancelled', cancel_reason: reason });
      return true;
    },
    completeTournamentMatch: async (params: any) => (await rpcFor(tidOfMatch(params.matchId))).completeTournamentMatch(params),
    promoteTournamentMatch: async (matchId: string, ...rest: any[]) => ((await rpcFor(tidOfMatch(matchId))).promoteTournamentMatch as any)(matchId, ...rest),
    generateTournamentBracket: async (params: any) => {
      if (h.bracketFailures > 0) { h.bracketFailures -= 1; throw new Error('fetch failed'); }
      const result = await (await rpcFor(params.tournamentId)).generateTournamentBracket(params);
      // The kit numbers matches per store: make ids unique across tournaments.
      for (const m of matchesOf(params.tournamentId)) if (!m.id.startsWith(params.tournamentId)) m.id = `${params.tournamentId}:${m.id}`;
      return result;
    },

    // start_fritz_cup (port of supabase/migrations/2026-10-07_tournament_kind_fritz_cup.sql)
    startFritzCup: async (userId: string) => {
      h.startFritzCupCalls += 1;
      if (h.failNextRpc) { const code = h.failNextRpc; h.failNextRpc = null; throw new Error(code); }
      return withUserLock(userId, () => {
        const now = nowMs();
        const active = [...h.tournaments.values()]
          .filter((t) => t.kind === 'fritz_cup' && t.owner_user_id === userId && ['upcoming', 'registration_open', 'in_progress'].includes(t.status))
          .filter((t) => h.regs.some((r) => r.tournament_id === t.id && r.user_id === userId && (r.status === 'registered' || r.status === 'active')))
          .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
        if (active) return { existing: true, tournament: structuredClone(active) };
        const conflict = conflictFor(userId, now, null);
        if (conflict) throw overlapError(conflict);
        const mine = [...h.tournaments.values()].filter((t) => t.kind === 'fritz_cup' && t.owner_user_id === userId);
        const last = Math.max(-Infinity, ...mine.map((t) => Date.parse(t.created_at)));
        if (last > now - 60_000) throw new TournamentRpcError('fritz_cup_cooldown', { reason: 'cooldown', retry_after_ms: last + 60_000 - now });
        const day = mine.filter((t) => Date.parse(t.created_at) > now - 24 * 60 * 60_000);
        if (day.length >= 20) {
          const oldest = Math.min(...day.map((t) => Date.parse(t.created_at)));
          throw new TournamentRpcError('fritz_cup_cooldown', { reason: 'daily_limit', retry_after_ms: oldest + 24 * 60 * 60_000 - now });
        }
        const id = randomUUID();
        const start = new Date(now).toISOString();
        const row = {
          id, kind: 'fritz_cup', owner_user_id: userId, scheduled_start: start, registration_open_at: start, registration_close_at: start,
          status: 'registration_open', format: '7-tile', win_target: 30, max_players: 8, winner_id: null, created_at: start, cancel_reason: null,
        };
        h.tournaments.set(id, row);
        h.regs.push({ id: randomUUID(), tournament_id: id, user_id: userId, registered_at: start, seed: null, placement: null, status: 'registered' });
        return { existing: false, tournament: structuredClone(row) };
      });
    },

    // register_for_tournament (same port, with the M1 kind and overlap checks)
    registerForTournament: async (tournamentId: string, userId: string) => withUserLock(userId, () => {
      const t = h.tournaments.get(tournamentId);
      if (!t) throw new TournamentRpcError('tournament_not_found');
      if ((t.kind ?? 'live') !== 'live') throw new TournamentRpcError('registration_closed');
      const existing = h.regs.find((r) => r.tournament_id === tournamentId && r.user_id === userId);
      const taken = () => h.regs.filter((r) => r.tournament_id === tournamentId && r.status === 'registered').length;
      if (existing && (existing.status === 'registered' || existing.status === 'active')) {
        return { registered: true, already_registered: true, seats_taken: taken() };
      }
      if (t.status !== 'registration_open' || nowMs() >= Date.parse(t.registration_close_at)) throw new TournamentRpcError('registration_closed');
      if (taken() >= t.max_players) throw new TournamentRpcError('tournament_full');
      const conflict = conflictFor(userId, Date.parse(t.scheduled_start), tournamentId);
      if (conflict) throw overlapError(conflict);
      h.regs.push({ id: randomUUID(), tournament_id: tournamentId, user_id: userId, registered_at: new Date().toISOString(), seed: null, placement: null, status: 'registered' });
      return { registered: true, already_registered: false, seats_taken: taken() };
    }),
  };
});

import {
  getRoom,
  peekRoom,
  resetLiveRoomPersistHookForTests,
  resetRoomRuntimeForTests,
} from '../rooms';
import { initRoomSession, resetRoomSessionStoresForTests } from '../multiplayer/roomSession';
import { resetLiveRoomPersistenceForTests } from '../multiplayer/roomLivePersistence';
import { resetTournamentTurnClockForTests } from '../multiplayer/tournamentTurnClock';
import { registerTournamentRoutes } from './routes';
import { closeRegistrationAndStart } from './engine';
import { closeRegistrationWithEscalation, CLOSE_START_MAX_CONSECUTIVE_FAILURES, startTournamentScheduler, stopTournamentScheduler } from './scheduler';
import { recoverTournamentMatches } from './recovery';
import { recordMatchResultForTest } from './inMemoryMatchRpc.testkit';
import { defaultEnginePersistence } from './persistenceInterface';
import * as persistence from './persistence';
import { resetAlertThrottleForTests } from './tournamentAlerts';

const U1 = '9f000000-0000-4000-8000-0000000000a1';
const U2 = '9f000000-0000-4000-8000-0000000000a2';
const U3 = '9f000000-0000-4000-8000-0000000000a3';
const LIVE = '9f000000-0000-4000-8000-00000000011e';
const LIVE_FAR = '9f000000-0000-4000-8000-00000000022e';

beforeEach(() => {
  vi.stubEnv('TOURNAMENTS_ENABLED', 'true');
  vi.stubEnv('FRITZ_CUP_ENABLED', 'true');
});
afterAll(() => { vi.unstubAllEnvs(); });

const ownerSocket = (userId: string) => ({ id: `sock-${userId.slice(-2)}`, data: { userId }, emit: vi.fn() });
let sockets: Array<ReturnType<typeof ownerSocket>> = [];
function makeIo() {
  return {
    sockets: { sockets: new Map(sockets.map((s) => [s.id, s])), adapter: { rooms: new Map() } },
    to: () => ({ emit: vi.fn(), except: () => ({ emit: vi.fn() }) }),
    emit: vi.fn(),
  } as any;
}

function initSession() {
  initRoomSession(makeIo(), {
    resolveSocketIdentity: async () => ({ username: 'Player', userId: null }),
    normalizeUsername: (v: unknown) => (typeof v === 'string' ? v : 'Guest'),
    normalizeUserId: (v: unknown) => (typeof v === 'string' ? v : null),
    tryHydrateMatchmakingRoomShell: async () => 'skipped',
    waitUntilMatchmakingRoomSocketsReady: async () => undefined,
    onAfterMatchStarted: async () => undefined,
    notifyRoomPlayersInGame: () => undefined,
    maybeFinalizeTournamentMatch: () => undefined,
    persistRoomMatchLog: async () => undefined,
    onGameOver: () => null,
    finalizeTournamentMatch: () => undefined,
  } as any);
}

/** Everything a process restart loses. */
function restart() {
  resetTournamentTurnClockForTests();
  resetLiveRoomPersistenceForTests();
  resetLiveRoomPersistHookForTests();
  resetRoomRuntimeForTests();
  resetRoomSessionStoresForTests();
  initSession();
}

type RouteHandler = (req: any, res: any) => unknown | Promise<unknown>;
let ipSeq = 0;
/** The tournament routes, with an io; each harness gets its own client IP (the HTTP limiter keys on it). */
function makeApp() {
  const routes = new Map<string, RouteHandler>();
  const app = {
    get: (path: string, handler: RouteHandler) => { routes.set(`GET ${path}`, handler); },
    post: (path: string, handler: RouteHandler) => { routes.set(`POST ${path}`, handler); },
    delete: (path: string, handler: RouteHandler) => { routes.set(`DELETE ${path}`, handler); },
  };
  registerTournamentRoutes(app as any, makeIo());
  ipSeq += 1;
  const ip = `203.0.113.${ipSeq % 250}`;
  return async function request(
    method: 'GET' | 'POST',
    path: string,
    opts: { as?: string; params?: Record<string, string>; body?: unknown } = {},
  ): Promise<{ status: number; body: any }> {
    const handler = routes.get(`${method} ${path}`);
    if (!handler) throw new Error(`missing route ${method} ${path}`);
    let status = 200;
    let body: any;
    const res: any = {
      status: (code: number) => { status = code; return res; },
      json: (b: unknown) => { body = b; return res; },
      setHeader: () => res,
    };
    await handler({
      headers: opts.as ? { authorization: `Bearer ${opts.as}` } : {},
      params: opts.params ?? {},
      body: opts.body ?? {},
      query: {},
      ip,
      socket: { remoteAddress: ip },
    }, res);
    return { status, body };
  };
}

const cupsOf = (userId: string) => [...h.tournaments.values()].filter((t) => t.kind === 'fritz_cup' && t.owner_user_id === userId);
const matchesOf = (tid: string) => h.matchesByTournament.get(tid) ?? [];
const regOf = (tid: string, userId: string) => h.regs.find((r) => r.tournament_id === tid && r.user_id === userId);
const humanMatch = (tid: string, userId: string, round: number) =>
  matchesOf(tid).find((m) => m.round === round && (m.player1_id === userId || m.player2_id === userId));
const io = () => makeIo();

/** Play the human's match of `round` to a result (as the real game-over path would record it). */
async function playHumanMatch(tid: string, userId: string, round: number, humanWins: boolean) {
  const m = humanMatch(tid, userId, round)!;
  expect(m.status).toBe('ready');
  const opponent = m.player1_id === userId ? m.player2_id : m.player1_id;
  const winnerId = humanWins ? userId : opponent;
  await recordMatchResultForTest(io(), {
    matchId: m.id,
    winnerId,
    player1Score: m.player1_id === winnerId ? 30 : 12,
    player2Score: m.player2_id === winnerId ? 30 : 12,
    winnerSource: 'game_over',
  }, defaultEnginePersistence);
}

function seedLiveEvent(id: string, startInMs: number) {
  const start = new Date(Date.now() + startInMs).toISOString();
  h.tournaments.set(id, {
    id, kind: 'live', owner_user_id: null, scheduled_start: start,
    registration_open_at: new Date(Date.now() - 60_000).toISOString(),
    registration_close_at: new Date(Date.now() + startInMs - 2 * 60_000).toISOString(),
    status: 'registration_open', format: '7-tile', win_target: 30, max_players: 8, winner_id: null, created_at: new Date().toISOString(),
  });
}

/** One scheduler tick (the real one), run until `done` holds. */
async function schedulerTickUntil(done: () => boolean) {
  startTournamentScheduler(io());
  try {
    await vi.waitFor(() => { if (!done()) throw new Error('not yet'); }, { timeout: 5_000, interval: 5 });
  } finally {
    stopTournamentScheduler();
  }
}

beforeEach(() => {
  h.tournaments.clear();
  h.matchesByTournament.clear();
  h.regs = [];
  h.liveSessions.clear();
  h.skewMs = 0;
  h.startFritzCupCalls = 0;
  h.failNextRpc = null;
  h.bracketFailures = 0;
  h.upcomingRows = [];
  sockets = [];
  resetAlertThrottleForTests();
  restart();
});
afterEach(() => {
  stopTournamentScheduler();
  restart();
});

describe('creating a Fritz Cup', () => {
  it('flag off: no new cup, and the RPC is never called', async () => {
    vi.stubEnv('FRITZ_CUP_ENABLED', 'false');
    const res = await makeApp()('POST', '/api/tournaments/fritz-cup', { as: U1 });
    expect(res).toMatchObject({ status: 403, body: { ok: false, error: 'tournaments_disabled' } });
    expect(h.startFritzCupCalls).toBe(0);
    expect(cupsOf(U1)).toHaveLength(0);
  });

  it('requires authentication', async () => {
    const res = await makeApp()('POST', '/api/tournaments/fritz-cup');
    expect(res).toMatchObject({ status: 401, body: { ok: false, error: 'not_authenticated' } });
    expect(h.startFritzCupCalls).toBe(0);
  });

  it('first creation: owned by the authenticated user (body ignored), 1 human + 7 Fritz, bot QFs resolved, the human\'s QF dispatched', async () => {
    sockets = [ownerSocket(U1)];
    const res = await makeApp()('POST', '/api/tournaments/fritz-cup', { as: U1, body: { userId: U2 } });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, existing: false, kind: 'fritz_cup' });
    const [cup] = cupsOf(U1);
    expect(cupsOf(U2)).toHaveLength(0);
    expect(res.body.tournament).toMatchObject({ id: cup.id, kind: 'fritz_cup', status: 'in_progress' });
    expect(res.body.tournament).not.toHaveProperty('owner_user_id');

    const matches = matchesOf(cup.id);
    expect(matches).toHaveLength(7);
    const entrants = matches.filter((m) => m.round === 1).flatMap((m) => [m.player1_id, m.player2_id]);
    expect(entrants.filter((id) => id === U1)).toHaveLength(1);
    expect(entrants.filter((id) => String(id).startsWith(`bot:fritz:${cup.id}:`))).toHaveLength(7);
    expect(h.regs.filter((r) => r.tournament_id === cup.id)).toEqual([expect.objectContaining({ user_id: U1, status: 'active', seed: 1 })]);

    const qf = humanMatch(cup.id, U1, 1)!;
    expect(qf).toMatchObject({ status: 'ready', bot_tier: 'standard' });
    expect(peekRoom(qf.room_code)?.scheduledTournamentMatchId).toBe(qf.id);
    expect(matches.filter((m) => m.round === 1 && m.id !== qf.id).every((m) => m.status === 'completed' && m.status_reason === 'bot_simulated')).toBe(true);
    // The two bot-only quarterfinals feeding the other semifinal cascade on: that semifinal is played too.
    expect(matches.find((m) => m.round === 2 && !(m.player1_id === null || m.player2_id === null) && !String(m.player1_id).includes(U1) && m.player1_id !== U1 && m.player2_id !== U1)?.status).toBe('completed');
    expect(res.body.activeAssignedMatch).toMatchObject({ matchId: qf.id, tournamentId: cup.id, roomCode: qf.room_code, round: 1 });
    expect(sockets[0].emit).toHaveBeenCalledWith('tournament:match_ready', expect.objectContaining({ matchId: qf.id, tournamentId: cup.id }));
  });

  it('a retry (inside the cooldown) returns the same cup: no second cup, bracket or room', async () => {
    const request = makeApp();
    const first = await request('POST', '/api/tournaments/fritz-cup', { as: U1 });
    const cupId = first.body.tournament.id;
    const qfRoom = humanMatch(cupId, U1, 1)!.room_code;

    const second = await request('POST', '/api/tournaments/fritz-cup', { as: U1 });

    expect(second.body).toMatchObject({ ok: true, existing: true, tournament: { id: cupId } });
    expect(cupsOf(U1)).toHaveLength(1);
    expect(matchesOf(cupId)).toHaveLength(7);
    expect(humanMatch(cupId, U1, 1)!.room_code).toBe(qfRoom);
    expect(second.body.activeAssignedMatch).toMatchObject({ roomCode: qfRoom });
  });

  it('concurrent double create: one cup, both responses name it', async () => {
    const request = makeApp();
    const [a, b] = await Promise.all([
      request('POST', '/api/tournaments/fritz-cup', { as: U1 }),
      request('POST', '/api/tournaments/fritz-cup', { as: U1 }),
    ]);
    expect(cupsOf(U1)).toHaveLength(1);
    expect(a.body.tournament.id).toBe(b.body.tournament.id);
    expect([a.body.existing, b.body.existing].sort()).toEqual([false, true]);
    const cup = cupsOf(U1)[0];
    expect(cup.status).toBe('in_progress');
    expect(matchesOf(cup.id)).toHaveLength(7);
  });

  it('an unexpected database error is a plain 500 internal (no raw text)', async () => {
    h.failNextRpc = 'ERROR: relation "x" does not exist';
    const res = await makeApp()('POST', '/api/tournaments/fritz-cup', { as: U1 });
    expect(res).toMatchObject({ status: 500, body: { ok: false, error: 'internal' } });
  });
});

describe('a Fritz Cup plays out on the normal engine', () => {
  it('the human loses: the rest of the bracket completes at once, the human is placed, a new cup is allowed after the cooldown', async () => {
    const request = makeApp();
    const cupId = (await request('POST', '/api/tournaments/fritz-cup', { as: U1 })).body.tournament.id;

    await playHumanMatch(cupId, U1, 1, false);

    expect(h.tournaments.get(cupId)).toMatchObject({ status: 'completed' });
    expect(String(h.tournaments.get(cupId)!.winner_id)).toMatch(/^bot:fritz:/);
    expect(matchesOf(cupId).every((m) => m.status === 'completed')).toBe(true);
    expect(regOf(cupId, U1)).toMatchObject({ status: 'eliminated', placement: 5 });

    const tooSoon = await request('POST', '/api/tournaments/fritz-cup', { as: U1 });
    expect(tooSoon).toMatchObject({ status: 429, body: { error: 'fritz_cup_cooldown', reason: 'cooldown' } });
    h.skewMs = 61_000;
    const next = await request('POST', '/api/tournaments/fritz-cup', { as: U1 });
    expect(next.body).toMatchObject({ ok: true, existing: false });
    expect(next.body.tournament.id).not.toBe(cupId);
    // The database clock is 61 s ahead of this server's here: the new cup is
    // still started and its human match dispatched at once.
    expect(humanMatch(next.body.tournament.id, U1, 1)?.status).toBe('ready');
  });

  it('the human wins three matches and is champion with placement 1 (the creation flag turned off midway changes nothing)', async () => {
    const cupId = (await makeApp()('POST', '/api/tournaments/fritz-cup', { as: U1 })).body.tournament.id;
    vi.stubEnv('FRITZ_CUP_ENABLED', 'false');

    await playHumanMatch(cupId, U1, 1, true);
    await playHumanMatch(cupId, U1, 2, true);
    await playHumanMatch(cupId, U1, 3, true);

    expect(h.tournaments.get(cupId)).toMatchObject({ status: 'completed', winner_id: U1 });
    expect(regOf(cupId, U1)).toMatchObject({ status: 'winner', placement: 1 });
    // The semifinal and final opponents were Fritz at the higher tiers.
    expect(humanMatch(cupId, U1, 2)!.bot_tier).toBe('elite');
    expect(humanMatch(cupId, U1, 3)!.bot_tier).toBe('master');
  });
});

describe('crash recovery uses the ordinary scheduler and recovery paths', () => {
  it('after the RPC committed, before the bracket: the scheduler tick starts the cup and dispatches the human', async () => {
    const { tournament } = await persistence.startFritzCup(U1);

    await schedulerTickUntil(() => humanMatch(tournament.id, U1, 1)?.status === 'ready');

    expect(h.tournaments.get(tournament.id)!.status).toBe('in_progress');
    expect(matchesOf(tournament.id)).toHaveLength(7);
    expect(peekRoom(humanMatch(tournament.id, U1, 1)!.room_code)).toBeDefined();
  });

  it('after the bracket, before the dispatch: the scheduler tick dispatches', async () => {
    const { tournament } = await persistence.startFritzCup(U1);
    await closeRegistrationAndStart(io(), tournament.id);
    expect(humanMatch(tournament.id, U1, 1)!.status).toBe('waiting');

    await schedulerTickUntil(() => humanMatch(tournament.id, U1, 1)?.status === 'ready');
  });

  it('after the first dispatch: a restart\'s boot recovery re-creates the human\'s room', async () => {
    const cupId = (await makeApp()('POST', '/api/tournaments/fritz-cup', { as: U1 })).body.tournament.id;
    const code = humanMatch(cupId, U1, 1)!.room_code;
    restart();
    expect(peekRoom(code)).toBeUndefined();

    await recoverTournamentMatches(io());

    expect(getRoom(code).scheduledTournamentMatchId).toBe(humanMatch(cupId, U1, 1)!.id);
  });

  it('a retry resumes an interrupted start (no second cup)', async () => {
    const { tournament } = await persistence.startFritzCup(U1); // the first request died here
    const res = await makeApp()('POST', '/api/tournaments/fritz-cup', { as: U1 });
    expect(res.body).toMatchObject({ existing: true, tournament: { id: tournament.id, status: 'in_progress' } });
    expect(humanMatch(tournament.id, U1, 1)!.status).toBe('ready');
    expect(cupsOf(U1)).toHaveLength(1);
  });

  it('the route and a scheduler tick starting the same cup together: started once, never cancelled', async () => {
    const { tournament } = await persistence.startFritzCup(U1);
    // The scheduler's close-and-start reads the registrations after the route's bracket made them active.
    await closeRegistrationAndStart(io(), tournament.id);
    const stale = await closeRegistrationAndStart(io(), tournament.id);
    expect(stale).toMatchObject({ reason: 'already_left_registration' });
    expect(h.tournaments.get(tournament.id)!.status).toBe('in_progress');

    const { tournament: t2 } = await persistence.startFritzCup(U2);
    await Promise.all([closeRegistrationAndStart(io(), t2.id), closeRegistrationAndStart(io(), t2.id).catch(() => null)]);
    expect(h.tournaments.get(t2.id)!.status).toBe('in_progress');
    expect(matchesOf(t2.id)).toHaveLength(7);
  });

  it('a start that keeps failing is cancelled by the existing escalation; the user may then start another', async () => {
    const { tournament } = await persistence.startFritzCup(U1);
    h.bracketFailures = CLOSE_START_MAX_CONSECUTIVE_FAILURES;
    const failures = new Map<string, number>();
    for (let i = 0; i < CLOSE_START_MAX_CONSECUTIVE_FAILURES; i += 1) await closeRegistrationWithEscalation(io(), tournament.id, failures);

    expect(h.tournaments.get(tournament.id)).toMatchObject({ status: 'cancelled', cancel_reason: 'bracket_generation_failed:fetch failed' });
    h.skewMs = 61_000;
    const res = await makeApp()('POST', '/api/tournaments/fritz-cup', { as: U1 });
    expect(res.body).toMatchObject({ ok: true, existing: false });
    expect(res.body.tournament.id).not.toBe(tournament.id);
  });
});

describe('overlap with Live Events', () => {
  it('Live registration, then a cup → 409 overlapping_tournament naming the event', async () => {
    seedLiveEvent(LIVE, 30 * 60_000);
    const request = makeApp();
    expect((await request('POST', '/api/tournaments/:id/register', { as: U1, params: { id: LIVE } })).body).toMatchObject({ ok: true });

    const res = await request('POST', '/api/tournaments/fritz-cup', { as: U1 });

    expect(res).toMatchObject({
      status: 409,
      body: { ok: false, error: 'overlapping_tournament', conflict: { tournamentId: LIVE, kind: 'live', scheduledStart: h.tournaments.get(LIVE)!.scheduled_start } },
    });
    expect(cupsOf(U1)).toHaveLength(0);
  });

  it('a cup, then a Live registration → 409 naming the cup; a Live Event 5 h later is allowed', async () => {
    seedLiveEvent(LIVE, 30 * 60_000);
    seedLiveEvent(LIVE_FAR, 5 * 60 * 60_000);
    const request = makeApp();
    const cupId = (await request('POST', '/api/tournaments/fritz-cup', { as: U1 })).body.tournament.id;

    const res = await request('POST', '/api/tournaments/:id/register', { as: U1, params: { id: LIVE } });
    expect(res).toMatchObject({ status: 409, body: { error: 'overlapping_tournament', conflict: { tournamentId: cupId, kind: 'fritz_cup' } } });
    expect(regOf(LIVE, U1)).toBeUndefined();

    expect((await request('POST', '/api/tournaments/:id/register', { as: U1, params: { id: LIVE_FAR } })).body).toMatchObject({ ok: true });
  });

  it('a cup and a Live registration racing: exactly one hold', async () => {
    seedLiveEvent(LIVE, 30 * 60_000);
    const request = makeApp();
    const [cup, reg] = await Promise.all([
      request('POST', '/api/tournaments/fritz-cup', { as: U1 }),
      request('POST', '/api/tournaments/:id/register', { as: U1, params: { id: LIVE } }),
    ]);
    const ok = [cup.body.ok, reg.body.ok].filter(Boolean);
    expect(ok).toHaveLength(1);
    expect([cup.body.error, reg.body.error].filter(Boolean)).toEqual(['overlapping_tournament']);
    const holds = h.regs.filter((r) => r.user_id === U1 && (r.status === 'registered' || r.status === 'active'));
    expect(holds).toHaveLength(1);
  });

  it('nobody can register into someone else\'s cup through the public route', async () => {
    const request = makeApp();
    const cupId = (await request('POST', '/api/tournaments/fritz-cup', { as: U1 })).body.tournament.id;
    const res = await request('POST', '/api/tournaments/:id/register', { as: U3, params: { id: cupId } });
    expect(res).toMatchObject({ status: 409, body: { ok: false, error: 'registration_closed' } });
    expect(regOf(cupId, U3)).toBeUndefined();
  });
});

describe('abuse controls', () => {
  it('cooldown: 429 fritz_cup_cooldown with retryAfterMs; the daily limit uses the same code with reason daily_limit', async () => {
    const request = makeApp();
    const cupId = (await request('POST', '/api/tournaments/fritz-cup', { as: U1 })).body.tournament.id;
    h.tournaments.get(cupId)!.status = 'cancelled';
    const cool = await request('POST', '/api/tournaments/fritz-cup', { as: U1 });
    expect(cool).toMatchObject({ status: 429, body: { ok: false, error: 'fritz_cup_cooldown', reason: 'cooldown' } });
    expect(cool.body.retryAfterMs).toBeGreaterThan(0);
    expect(cool.body.retryAfterMs).toBeLessThanOrEqual(60_000);

    for (let i = 0; i < 20; i += 1) {
      const at = new Date(Date.now() - (23 * 60 - i * 60) * 60_000).toISOString();
      const id = randomUUID();
      h.tournaments.set(id, { id, kind: 'fritz_cup', owner_user_id: U2, status: 'completed', scheduled_start: at, created_at: at });
    }
    const daily = await request('POST', '/api/tournaments/fritz-cup', { as: U2 });
    expect(daily).toMatchObject({ status: 429, body: { error: 'fritz_cup_cooldown', reason: 'daily_limit' } });
    expect(daily.body.retryAfterMs).toBeGreaterThan(0);
  });

  it('HTTP limiter: the 11th request in 10 minutes from one IP is 429 rate_limited, before any database call', async () => {
    const request = makeApp();
    for (let i = 0; i < 10; i += 1) {
      expect((await request('POST', '/api/tournaments/fritz-cup', { as: U1 })).status).toBe(200);
    }
    const calls = h.startFritzCupCalls;
    const res = await request('POST', '/api/tournaments/fritz-cup', { as: U1 });
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ error: 'rate_limited' });
    expect(h.startFritzCupCalls).toBe(calls);
    expect(cupsOf(U1)).toHaveLength(1);
  });
});

describe('kind filtering', () => {
  it('/upcoming lists Live Events only, without owner ids', async () => {
    const soon = new Date(Date.now() + 10 * 60_000).toISOString();
    h.upcomingRows = [
      { id: LIVE, kind: 'live', owner_user_id: null, status: 'registration_open', scheduled_start: soon },
      { id: 'cup-row', kind: 'fritz_cup', owner_user_id: U1, status: 'registration_open', scheduled_start: soon },
    ];
    const res = await makeApp()('GET', '/api/tournaments/upcoming');
    expect(res.body.tournaments.map((t: Row) => t.id)).toEqual([LIVE]);
    expect(res.body.tournaments[0]).toMatchObject({ kind: 'live' });
    expect(res.body.tournaments[0]).not.toHaveProperty('owner_user_id');
  });

  it('the owner still finds their cup (/my), /:id shows kind without the owner id, and history labels it a Fritz Cup', async () => {
    const request = makeApp();
    const cupId = (await request('POST', '/api/tournaments/fritz-cup', { as: U1 })).body.tournament.id;

    const my = await request('GET', '/api/tournaments/my', { as: U1 });
    expect(my.body.registrations.map((r: Row) => r.tournament_id)).toContain(cupId);
    const detail = await request('GET', '/api/tournaments/:id', { params: { id: cupId } });
    expect(detail.body.tournament).toMatchObject({ id: cupId, kind: 'fritz_cup' });
    expect(detail.body.tournament).not.toHaveProperty('owner_user_id');

    await playHumanMatch(cupId, U1, 1, false);
    const history = await request('GET', '/api/tournaments/history', { as: U1 });
    expect(history.body.history).toEqual([expect.objectContaining({ tournamentId: cupId, kind: 'fritz_cup', placement: 5 })]);
  });
});
