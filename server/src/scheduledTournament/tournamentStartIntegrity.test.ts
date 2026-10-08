/**
 * Phase 2A start integrity:
 *
 *  - A tournament room never starts unless its deterministic starter resolves
 *    to a current seat. A missing or unseated starter is alerted and the deal
 *    is refused (no seat-0 fallback); the match stays ready and the existing
 *    start-retry lifecycle (`all_joined_start_retry`, then the explicit
 *    administrative decision) handles it. Non-tournament rooms are unchanged.
 *  - Tournament room codes: new matches get `T` + 12 hex of the match id +
 *    `R{round}M{n}`; codes already stored on a match (including the original
 *    6-hex format) are kept and still recognised.
 *
 * Real: dispatch, the attach handler, the start gate, rooms, roster, the
 * live-session writer and restore, the reconciler, the in-memory port of the
 * result RPC. Faked: `supabaseFetch` (in-memory room_live_sessions) and the
 * scheduled-tournament row reads/writes in `./persistence`.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Sentry from '@sentry/node';

beforeEach(() => { vi.stubEnv('TOURNAMENTS_ENABLED', 'true'); });
afterAll(() => { vi.unstubAllEnvs(); });

type Row = Record<string, any>;
const db = vi.hoisted(() => ({
  liveSessions: new Map<string, Record<string, unknown>>(),
  matches: new Map<string, Record<string, any>>(),
  tournaments: new Map<string, Record<string, any>>(),
  regs: [] as Array<Record<string, any>>,
}));

vi.mock('@sentry/node', () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock('../social/activityWriter', () => ({
  writeTournamentActivity: vi.fn().mockResolvedValue(undefined),
  writeMatchActivity: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../supabaseUtils', () => ({
  isSupabaseTimeoutError: () => false,
  supabaseFetch: vi.fn(async (path: string, init?: { method?: string; body?: string }) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    if (path.startsWith('/rest/v1/room_live_sessions')) {
      if (method === 'POST') {
        for (const row of JSON.parse(init!.body!) as Array<Record<string, unknown>>) {
          db.liveSessions.set(String(row.room_code), structuredClone(row));
        }
        return [];
      }
      const code = decodeURIComponent(/room_code=eq\.([^&]+)/.exec(path)![1]);
      if (method === 'DELETE') {
        db.liveSessions.delete(code);
        return [];
      }
      const row = db.liveSessions.get(code);
      return row ? [structuredClone(row)] : [];
    }
    return [];
  }),
}));
vi.mock('./persistence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./persistence')>();
  const { inMemoryMatchRpcForArrayStore } = await vi.importActual<typeof import('./inMemoryMatchRpc.testkit')>('./inMemoryMatchRpc.testkit');
  const rpc = () => inMemoryMatchRpcForArrayStore({
    get tournament() { return [...db.tournaments.values()][0] as any; },
    get matches() { return [...db.matches.values()] as any; },
    get regs() { return db.regs as any; },
  });
  return {
    ...actual,
    fetchMatchById: async (id: string) => structuredClone(db.matches.get(id) ?? null),
    fetchMatchByRoomCode: async (code: string) =>
      structuredClone([...db.matches.values()].find((m) => m.room_code === code) ?? null),
    fetchMatches: async (tournamentId: string) =>
      [...db.matches.values()].filter((m) => m.tournament_id === tournamentId).map((m) => structuredClone(m)),
    fetchTournamentById: async (id: string) => structuredClone(db.tournaments.get(id) ?? null),
    fetchTournamentsByStatus: async (statuses: string[]) =>
      [...db.tournaments.values()].filter((t) => statuses.includes(String(t.status))).map((t) => structuredClone(t)),
    fetchRegistrations: async () => structuredClone(db.regs),
    fetchRegistrationsWithProfile: async () => [],
    updateMatch: async (id: string, patch: Record<string, unknown>) => {
      const row = db.matches.get(id);
      if (row) Object.assign(row, patch);
    },
    completeTournamentMatch: (params: Parameters<typeof actual.completeTournamentMatch>[0]) => rpc().completeTournamentMatch(params),
    promoteTournamentMatch: (...args: Parameters<typeof actual.promoteTournamentMatch>) => rpc().promoteTournamentMatch(...args),
  };
});

import {
  createReservedRoom,
  getRoom,
  joinRoom,
  peekRoom,
  resetLiveRoomPersistHookForTests,
  resetRoomRuntimeForTests,
} from '../rooms';
import { getRoomRoster, initRoomSession, resetRoomSessionStoresForTests, setRoomRoster } from '../multiplayer/roomSession';
import { registerRoomSessionHandlers } from '../multiplayer/registerRoomSessionHandlers';
import { markMatchStartReady, tryStartMatchIfReady } from '../multiplayer/matchStartReady';
import { persistLiveRoomSessionNow, resetLiveRoomPersistenceForTests } from '../multiplayer/roomLivePersistence';
import { resetTournamentTurnClockForTests } from '../multiplayer/tournamentTurnClock';
import { reconcileExpiredReadyMatches } from './engine';
import { dispatchTournamentMatch } from './matchDispatch';
import { resetAlertThrottleForTests } from './tournamentAlerts';
import { authorizeMatchParticipant } from './tournamentAuth';
import { isTournamentRoomCode, makeTournamentRoomCode } from './tournamentRoomCode';
import { tournamentStarterUserId } from './tournamentStarter';

const T = '7e000000-0000-4000-8000-000000000001';
const U1 = '7e000000-0000-4000-8000-0000000000a1';
const U2 = '7e000000-0000-4000-8000-0000000000a2';
const OUTSIDER = '7e000000-0000-4000-8000-0000000000ff';
const BOT = `bot:fritz:${T}:8`;

let socketSeq = 0;
function makeSocket(userId: string) {
  const handlers = new Map<string, (...args: any[]) => void>();
  const socket = {
    id: `sock-${userId.slice(-2)}-${++socketSeq}`,
    data: { userId, username: `user-${userId.slice(-2)}` } as Record<string, unknown>,
    rooms: new Set<string>(),
    connected: true,
    on: (event: string, handler: (...args: any[]) => void) => { handlers.set(event, handler); return socket; },
    join: (roomCode: string) => { socket.rooms.add(roomCode); },
    leave: (roomCode: string) => { socket.rooms.delete(roomCode); },
    emit: vi.fn(),
    disconnect: vi.fn(),
  };
  socket.rooms.add(socket.id);
  return { socket: socket as any, handlers };
}

function makeIo(sockets: any[] = []) {
  return {
    sockets: { sockets: new Map(sockets.map((s) => [s.id, s])), adapter: { rooms: new Map() } },
    to: () => ({ emit: vi.fn(), except: () => ({ emit: vi.fn() }) }),
    emit: vi.fn(),
  } as any;
}

function initSession() {
  initRoomSession(makeIo(), {
    resolveSocketIdentity: async (config: { userId?: unknown }) => ({
      username: 'Player', userId: typeof config?.userId === 'string' ? config.userId : null,
    }),
    normalizeUsername: (value: unknown) => (typeof value === 'string' ? value : 'Guest'),
    normalizeUserId: (value: unknown) => (typeof value === 'string' ? value : null),
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

function restart() {
  resetTournamentTurnClockForTests();
  resetLiveRoomPersistenceForTests();
  resetLiveRoomPersistHookForTests();
  resetRoomRuntimeForTests();
  resetRoomSessionStoresForTests();
  initSession();
}

let seq = 0;
/** A ready, never-dispatched match (room_code '' as the bracket RPC writes it). */
function seedMatch(p1: string, p2: string, partial: Row = {}): Row {
  seq += 1;
  const id = `7e000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
  db.tournaments.set(T, {
    id: T, scheduled_start: new Date(Date.now() - 60_000).toISOString(), registration_open_at: '', registration_close_at: '',
    status: 'in_progress', format: '7-tile', win_target: 30, max_players: 8, winner_id: null, created_at: '',
  });
  const isBot = (v: string) => v.startsWith('bot:');
  db.matches.set(id, {
    id, tournament_id: T, round: 1, match_number: 1, player1_id: p1, player2_id: p2, winner_id: null,
    room_code: '', status: 'ready', ready_at: null, ready_deadline_at: null, started_at: null, completed_at: null,
    player1_joined_at: null, player2_joined_at: null, winner_source: null, status_reason: null,
    forfeit_user_id: null, no_show_user_id: null, bot_tier: isBot(p1) || isBot(p2) ? 'standard' : null,
    player1_score: null, player2_score: null, ...partial,
  });
  db.regs = [U1, U2].map((u, i) => ({ id: `r-${u}`, tournament_id: T, user_id: u, registered_at: '', seed: i + 1, placement: null, status: 'active' }));
  return db.matches.get(id)!;
}

async function attach(userId: string, matchId: string) {
  const { socket, handlers } = makeSocket(userId);
  registerRoomSessionHandlers(makeIo([socket]), socket);
  const ack = vi.fn();
  await handlers.get('tournament:attach_assigned_match')?.({ matchId }, ack);
  return ack.mock.calls[0]?.[0] as Record<string, any>;
}

const starterAlerts = () =>
  vi.mocked(Sentry.captureMessage).mock.calls.filter(([m]) => m === '[tournament] tournament_starter_unresolved').length;
const tick = () => reconcileExpiredReadyMatches(makeIo(), new Date(), undefined, [structuredClone(db.tournaments.get(T)!) as any]);
const expireDeadline = (matchId: string) => { db.matches.get(matchId)!.ready_deadline_at = new Date(Date.now() - 1_000).toISOString(); };
const roomOf = (matchId: string) => getRoom(db.matches.get(matchId)!.room_code);

/** Break the starter on the dispatched room: `missing` drops it, `unseated` names nobody in the room. */
function breakStarter(matchId: string, how: 'missing' | 'unseated') {
  const room = roomOf(matchId);
  if (how === 'missing') delete room.scheduledTournamentStarterUserId;
  else room.scheduledTournamentStarterUserId = OUTSIDER;
}

beforeEach(() => {
  db.liveSessions.clear();
  db.matches.clear();
  db.tournaments.clear();
  db.regs = [];
  vi.mocked(Sentry.captureMessage).mockClear();
  resetAlertThrottleForTests();
  restart();
});
afterEach(() => { restart(); });

describe('tournament starter resolution fails closed', () => {
  it('a valid mapped starter starts the game normally, with that starter', async () => {
    const match = seedMatch(U1, U2);
    await dispatchTournamentMatch(makeIo(), match.id);
    await attach(U2, match.id);
    const ack = await attach(U1, match.id);

    expect(ack).toMatchObject({ ok: true, matchStarted: true });
    const room = roomOf(match.id);
    const starter = tournamentStarterUserId(match as any)!;
    const starterSeat = getRoomRoster(room.code).find((p) => p.userId === starter)!.id;
    expect(room.state!.handStarters).toEqual([starterSeat]);
    expect(starterAlerts()).toBe(0);
  });

  for (const how of ['missing', 'unseated'] as const) {
    it(`starter ${how}: nothing is dealt, the match stays ready, the anomaly is raised once`, async () => {
      const match = seedMatch(U1, BOT);
      await dispatchTournamentMatch(makeIo(), match.id);
      breakStarter(match.id, how);

      const ack = await attach(U1, match.id);
      const again = await attach(U1, match.id);

      expect(ack).toMatchObject({ ok: false, error: 'tournament_starter_unresolved' });
      expect(again).toMatchObject({ ok: false, error: 'tournament_starter_unresolved' });
      const room = roomOf(match.id);
      expect(room.state).toBeNull(); // no deal, so no seat-0 start
      expect(room.events.some((e) => e.type === 'match_started')).toBe(false);
      expect(db.matches.get(match.id)).toMatchObject({ status: 'ready', started_at: null, winner_id: null });
      // Logged each time, sent to Sentry once (rate-limited per match).
      expect(starterAlerts()).toBe(1);
      const [, context] = vi.mocked(Sentry.captureMessage).mock.calls.find(([m]) => m === '[tournament] tournament_starter_unresolved')!;
      expect((context as any).tags).toMatchObject({ match_id: match.id });
    });
  }

  it('an unresolved starter enters the existing start-retry pathway, and the redispatch repairs a missing starter', async () => {
    const match = seedMatch(U1, BOT);
    await dispatchTournamentMatch(makeIo(), match.id);
    breakStarter(match.id, 'missing');
    await attach(U1, match.id);
    expireDeadline(match.id);

    await tick();

    expect(db.matches.get(match.id)).toMatchObject({ status: 'ready', status_reason: 'all_joined_start_retry', winner_id: null });
    expect(Date.parse(db.matches.get(match.id)!.ready_deadline_at)).toBeGreaterThan(Date.now());
    // The redispatch re-derived the same deterministic starter; the re-attach starts normally.
    expect(roomOf(match.id).scheduledTournamentStarterUserId).toBe(tournamentStarterUserId(match as any));
    const ack = await attach(U1, match.id);
    expect(ack).toMatchObject({ ok: true, matchStarted: true });
  });

  it('a starter that still cannot be resolved after the retry reaches the explicit administrative resolution (two humans)', async () => {
    const match = seedMatch(U1, U2);
    await dispatchTournamentMatch(makeIo(), match.id);
    breakStarter(match.id, 'unseated');
    await attach(U1, match.id);
    await attach(U2, match.id);
    expireDeadline(match.id);
    await tick(); // retry: deadline extended once, room redispatched
    expect(db.matches.get(match.id)!.status_reason).toBe('all_joined_start_retry');

    breakStarter(match.id, 'unseated'); // identity still cannot be repaired
    expect(await attach(U1, match.id)).toMatchObject({ ok: false, error: 'tournament_starter_unresolved' });
    expireDeadline(match.id);
    await tick();

    expect(db.matches.get(match.id)).toMatchObject({
      status: 'completed', winner_id: U1, winner_source: 'no_show', no_show_user_id: null,
      status_reason: 'start_failed_after_retry_higher_seed_advanced',
    });
    expect(roomOf(match.id).state).toBeNull();
  });

  it('human vs Fritz: the same pathway ends with the joined human advancing (existing attendance rule)', async () => {
    const match = seedMatch(U1, BOT);
    await dispatchTournamentMatch(makeIo(), match.id);
    breakStarter(match.id, 'unseated');
    await attach(U1, match.id);
    expireDeadline(match.id);
    await tick();
    breakStarter(match.id, 'unseated');
    await attach(U1, match.id);
    expireDeadline(match.id);
    await tick();

    expect(db.matches.get(match.id)).toMatchObject({ status: 'completed', winner_id: U1, winner_source: 'no_show' });
    expect(roomOf(match.id).state).toBeNull();
  });

  it('non-tournament rooms are unchanged: no starter needed, the engine default applies', async () => {
    const code = 'PRIV2A';
    createReservedRoom(code, { winningScore: 60, skipPregameDraw: true });
    for (const seat of ['seat-p', 'seat-q']) {
      joinRoom(code, seat);
      setRoomRoster(code, [...getRoomRoster(code), { id: seat, socketId: '', username: seat, userId: null }]);
      markMatchStartReady(code, seat);
    }

    expect(await tryStartMatchIfReady(code, makeIo(), { broadcastStateUpdate: () => undefined })).toEqual({ started: true });

    const state = getRoom(code).state!;
    expect(state.handNumber).toBe(1);
    expect(state.playerIds[state.currentPlayerIndex]).toBe('seat-p');
    expect(starterAlerts()).toBe(0);
  });
});

describe('tournament room codes', () => {
  it('recognises the original and the current format, and rejects malformed codes', () => {
    for (const ok of ['TABCDEFR1M1', 'T7E0000R3M1', 'T0123456789ABR1M4', 'tabcdef012345r2m2', ' T0123456789ABR3M1 ']) {
      expect(isTournamentRoomCode(ok)).toBe(true);
    }
    for (const bad of ['', 'ABCDEF', 'TABCDER1M1', 'T0123456789AR1M1', 'T0123456789ABCR1M1', 'TABCDEFR4M1', 'TABCDEFR1M5',
      'TGHIJKLR1M1', 'XABCDEFR1M1', 'TABCDEFR1M1X', 'T01234567-9ABR1M1']) {
      expect(isTournamentRoomCode(bad)).toBe(false);
    }
  });

  it('a new match gets T + 12 hex of its match id + round/match; different match ids give different codes', () => {
    const a = { id: '0a1b2c3d-4e5f-4000-8000-000000000001', round: 2, match_number: 1 };
    const b = { id: '0a1b2c3d-4e5f-4000-8000-000000000002', round: 2, match_number: 1 };
    const c = { id: '0a1b2c3d-4e60-4000-8000-000000000001', round: 2, match_number: 1 };
    expect(makeTournamentRoomCode(a)).toBe('T0A1B2C3D4E5FR2M1');
    expect(isTournamentRoomCode(makeTournamentRoomCode(a))).toBe(true);
    // Same first 12 hex → same code; any difference in them → different code.
    expect(makeTournamentRoomCode(b)).toBe(makeTournamentRoomCode(a));
    expect(makeTournamentRoomCode(c)).not.toBe(makeTournamentRoomCode(a));
    // Two matches of the same tournament and slot shape no longer share a code.
    const codes = new Set(Array.from({ length: 200 }, (_, i) =>
      makeTournamentRoomCode({ id: `${(i * 2654435761 >>> 0).toString(16).padStart(8, '0')}-1111-4000-8000-000000000000`, round: 1, match_number: 1 })));
    expect(codes.size).toBe(200);
  });

  it('dispatch stores the new-format code on a new match; redispatch reuses the stored code', async () => {
    const match = seedMatch(U1, BOT);
    const expected = `T${match.id.replace(/-/g, '').slice(0, 12).toUpperCase()}R1M1`;

    const first = await dispatchTournamentMatch(makeIo(), match.id);
    const second = await dispatchTournamentMatch(makeIo(), match.id, { reason: 'repair', emitIfAlreadyReady: true });

    expect(first.roomCode).toBe(expected);
    expect(db.matches.get(match.id)!.room_code).toBe(expected);
    expect(second.roomCode).toBe(expected);
    expect(peekRoom(expected)?.scheduledTournamentMatchId).toBe(match.id);
  });

  it('a match already carrying an original-format code keeps it (never rewritten), dispatched and redispatched', async () => {
    const match = seedMatch(U1, BOT, { room_code: 'T7E0000R1M1' });

    await dispatchTournamentMatch(makeIo(), match.id);
    restart();
    await dispatchTournamentMatch(makeIo(), match.id, { reason: 'recovery', emitIfAlreadyReady: true });

    expect(db.matches.get(match.id)!.room_code).toBe('T7E0000R1M1');
    expect(peekRoom('T7E0000R1M1')?.scheduledTournamentMatchId).toBe(match.id);
  });

  it('a restart restores the same new-format room with its game', async () => {
    const match = seedMatch(U1, BOT);
    await attach(U1, match.id);
    const room = roomOf(match.id);
    const before = structuredClone(room.state!);
    const roster = getRoomRoster(room.code).map((p) => ({ seatId: p.id, userId: p.userId, username: p.username }));
    expect(await persistLiveRoomSessionNow(room, roster)).toBe(true);
    const code = room.code;
    restart();

    const ack = await attach(U1, match.id);

    expect(ack).toMatchObject({ ok: true, roomCode: code, matchStarted: true });
    expect(peekRoom(code)!.state).toEqual(before);
  });

  it('room codes are opaque to callers: the attach ack hands back the stored code, and the join ACL resolves both formats', async () => {
    const fresh = seedMatch(U1, BOT);
    const ack = await attach(U1, fresh.id);
    expect(ack.roomCode).toBe(db.matches.get(fresh.id)!.room_code);

    const legacy = seedMatch(U1, BOT, { room_code: 'T7E0001R1M1' });
    for (const code of [db.matches.get(fresh.id)!.room_code, legacy.room_code]) {
      const fetchMatchByRoomCode = vi.fn(async (c: string) => [...db.matches.values()].find((m) => m.room_code === c) as any);
      const authz = await authorizeMatchParticipant(U1, { roomCode: code }, { allowCompleted: true }, { fetchMatchByRoomCode });
      expect(fetchMatchByRoomCode).toHaveBeenCalledWith(code);
      expect(authz.ok).toBe(true);
      const stranger = await authorizeMatchParticipant(OUTSIDER, { roomCode: code }, { allowCompleted: true }, { fetchMatchByRoomCode });
      expect(stranger).toMatchObject({ ok: false, code: 'not_a_participant' });
    }
  });
});
