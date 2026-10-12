/**
 * Phase 2A.1: another tournament match's persisted session, room or archive
 * under a colliding (legacy, 24-bit) room code is never published, taken
 * over, recorded, closed or displayed as this match's.
 *
 *  - Restore checks the stored `scheduled_tournament_match_id` before the room
 *    is created: a foreign session is never visible in the room map, not even
 *    while the rest of hydration is awaiting (the concurrency test pauses at
 *    exactly that point).
 *  - Dispatch, the tournament attach, and the engine's room lookups refuse a
 *    foreign room already in memory, and leave it untouched.
 *  - The terminal-join answer uses the shared archive identity rule.
 *
 * Real: rooms, roster, the live-session writer/loader and hydration, restore,
 * dispatch, the attach handler, the engine. Faked: `supabaseFetch` (in-memory
 * room_live_sessions + room_match_logs), and the receipts load that follows
 * room publication in hydration (gated, so the test controls when it ends).
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Sentry from '@sentry/node';

beforeEach(() => { vi.stubEnv('TOURNAMENTS_ENABLED', 'true'); });
afterAll(() => { vi.unstubAllEnvs(); });

type Row = Record<string, any>;
const h = vi.hoisted(() => {
  let release: () => void = () => {};
  let signalRequested: () => void = () => {};
  return {
    liveSessions: new Map<string, Record<string, unknown>>(),
    matchLogs: [] as Array<Record<string, any>>,
    matches: new Map<string, Record<string, any>>(),
    tournaments: new Map<string, Record<string, any>>(),
    regs: [] as Array<Record<string, any>>,
    receipts: {
      gate: Promise.resolve() as Promise<void>,
      requested: Promise.resolve() as Promise<void>,
      calls: 0,
      arm() {
        this.gate = new Promise<void>((resolve) => { release = resolve; });
        this.requested = new Promise<void>((resolve) => { signalRequested = resolve; });
        this.calls = 0;
      },
      release: () => release(),
      signal: () => signalRequested(),
    },
  };
});

vi.mock('@sentry/node', () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock('../social/activityWriter', () => ({
  writeTournamentActivity: vi.fn().mockResolvedValue(undefined),
  writeMatchActivity: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../multiplayer/roomCommandReceiptStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../multiplayer/roomCommandReceiptStore')>();
  return {
    ...actual,
    // Hydration awaits this right after it creates the room: in the old
    // publish-then-validate order, a foreign room sat in the map for as long
    // as this took.
    loadRoomCommandReceiptsForRoom: vi.fn(async () => {
      h.receipts.calls += 1;
      h.receipts.signal();
      await h.receipts.gate;
      return [];
    }),
  };
});
vi.mock('../supabaseUtils', () => ({
  isSupabaseTimeoutError: () => false,
  supabaseFetch: vi.fn(async (path: string, init?: { method?: string; body?: string }) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    if (path.startsWith('/rest/v1/room_live_sessions')) {
      if (method === 'POST') {
        for (const row of JSON.parse(init!.body!) as Array<Record<string, unknown>>) {
          h.liveSessions.set(String(row.room_code), structuredClone(row));
        }
        return [];
      }
      const code = decodeURIComponent(/room_code=eq\.([^&]+)/.exec(path)![1]);
      if (method === 'DELETE') {
        h.liveSessions.delete(code);
        return [];
      }
      const row = h.liveSessions.get(code);
      return row ? [structuredClone(row)] : [];
    }
    if (path.startsWith('/rest/v1/room_match_logs')) {
      const code = decodeURIComponent(/room_code=eq\.([^&]+)/.exec(path)?.[1] ?? '');
      return h.matchLogs
        .filter((r) => r.room_code === code)
        .sort((a, b) => Date.parse(b.archived_at) - Date.parse(a.archived_at))
        .slice(0, Number(/limit=(\d+)/.exec(path)?.[1] ?? 1))
        .map((r) => structuredClone(r));
    }
    return [];
  }),
}));
vi.mock('./persistence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./persistence')>();
  const { inMemoryMatchRpcForArrayStore } = await vi.importActual<typeof import('./inMemoryMatchRpc.testkit')>('./inMemoryMatchRpc.testkit');
  const rpc = () => inMemoryMatchRpcForArrayStore({
    get tournament() { return [...h.tournaments.values()][0] as any; },
    get matches() { return [...h.matches.values()] as any; },
    get regs() { return h.regs as any; },
  });
  return {
    ...actual,
    fetchMatchById: async (id: string) => structuredClone(h.matches.get(id) ?? null),
    fetchMatchByRoomCode: async (code: string) =>
      structuredClone([...h.matches.values()].find((m) => m.room_code === code) ?? null),
    fetchMatches: async (tournamentId: string) =>
      [...h.matches.values()].filter((m) => m.tournament_id === tournamentId).map((m) => structuredClone(m)),
    fetchTournamentById: async (id: string) => structuredClone(h.tournaments.get(id) ?? null),
    fetchTournamentsByStatus: async (statuses: string[]) =>
      [...h.tournaments.values()].filter((t) => statuses.includes(String(t.status))).map((t) => structuredClone(t)),
    fetchRegistrations: async () => structuredClone(h.regs),
    fetchRegistrationsWithProfile: async () => [],
    updateMatch: async (id: string, patch: Record<string, unknown>) => {
      const row = h.matches.get(id);
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
  startGameUnlocked,
} from '../rooms';
import { getRoomRoster, initRoomSession, resetRoomSessionStoresForTests, setRoomRoster } from '../multiplayer/roomSession';
import { registerRoomSessionHandlers } from '../multiplayer/registerRoomSessionHandlers';
import { persistLiveRoomSessionNow, resetLiveRoomPersistenceForTests } from '../multiplayer/roomLivePersistence';
import { resetRoomMatchLogPersistenceForTests } from '../multiplayer/roomMatchLogPersistence';
import { resolveArchivedTerminalJoin } from '../multiplayer/matchTerminalJoin';
import { resetTournamentTurnClockForTests } from '../multiplayer/tournamentTurnClock';
import { reconcileExpiredReadyMatches } from './engine';
import { dispatchTournamentMatch } from './matchDispatch';
import { resetAlertThrottleForTests } from './tournamentAlerts';
import { restoreOrCreateTournamentRoom } from './tournamentRoomRestore';
import { TOURNAMENT_MATCH_CAP_MS_DEFAULT } from './tournamentTimeouts';

const T = '3d000000-0000-4000-8000-000000000001';
const U1 = '3d000000-0000-4000-8000-0000000000a1';
const U2 = '3d000000-0000-4000-8000-0000000000a2';
const U3 = '3d000000-0000-4000-8000-0000000000a3';
/** A legacy (6-hex) code shared by two matches of different tournaments. */
const CODE = 'T3D0000R1M1';
const MATCH_A = '3d000000-0000-4000-8000-00000000000a'; // owns the stored session
const MATCH_B = '3d000000-0000-4000-8000-00000000000b'; // being restored

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
  resetRoomMatchLogPersistenceForTests();
  resetLiveRoomPersistHookForTests();
  resetRoomRuntimeForTests();
  resetRoomSessionStoresForTests();
  initSession();
}

function matchRow(id: string, partial: Row = {}): Row {
  return {
    id, tournament_id: T, round: 1, match_number: 1, player1_id: U1, player2_id: U2, winner_id: null,
    room_code: CODE, status: 'in_progress', ready_at: null, ready_deadline_at: null,
    started_at: new Date(Date.now() - 5 * 60_000).toISOString(), completed_at: null,
    player1_joined_at: new Date(Date.now() - 5 * 60_000).toISOString(), player2_joined_at: new Date(Date.now() - 5 * 60_000).toISOString(),
    winner_source: null, status_reason: null, forfeit_user_id: null, no_show_user_id: null, bot_tier: null,
    player1_score: null, player2_score: null, ...partial,
  };
}

function seedTournament() {
  h.tournaments.set(T, {
    id: T, scheduled_start: new Date(Date.now() - 30 * 60_000).toISOString(), registration_open_at: '', registration_close_at: '',
    status: 'in_progress', format: '7-tile', win_target: 30, max_players: 8, winner_id: null, created_at: '',
  });
  h.regs = [U1, U2].map((u, i) => ({ id: `r-${u}`, tournament_id: T, user_id: u, registered_at: '', seed: i + 1, placement: null, status: 'active' }));
}

/** Match A's game in progress, its live session written under CODE, then the room is dropped. */
async function storeMatchASession(): Promise<Record<string, unknown>> {
  const room = createReservedRoom(CODE, { winningScore: 30 });
  room.scheduledTournamentMatchId = MATCH_A;
  room.scheduledTournamentId = T;
  for (const [seat, user] of [['seat-a1', U1], ['seat-a2', U2]] as const) {
    joinRoom(CODE, seat);
    setRoomRoster(CODE, [...getRoomRoster(CODE), { id: seat, socketId: '', username: seat, userId: user }]);
  }
  await startGameUnlocked(CODE, makeIo());
  const roster = getRoomRoster(CODE).map((p) => ({ seatId: p.id, userId: p.userId, username: p.username }));
  expect(await persistLiveRoomSessionNow(getRoom(CODE), roster)).toBe(true);
  restart();
  expect(h.liveSessions.get(CODE)).toMatchObject({ scheduled_tournament_match_id: MATCH_A });
  return structuredClone(h.liveSessions.get(CODE)!);
}

/** Match A's room already in memory (restored by some other path). */
function matchARoomInMemory() {
  const room = createReservedRoom(CODE, { winningScore: 30 });
  room.scheduledTournamentMatchId = MATCH_A;
  room.scheduledTournamentId = T;
  return room;
}

const foreignAlerts = () =>
  vi.mocked(Sentry.captureMessage).mock.calls.filter(([m]) => m === '[tournament] tournament_foreign_live_session').length;

beforeEach(() => {
  h.liveSessions.clear();
  h.matchLogs = [];
  h.matches.clear();
  h.tournaments.clear();
  h.regs = [];
  h.receipts.arm();
  h.receipts.release(); // ungated unless a test re-arms it
  vi.mocked(Sentry.captureMessage).mockClear();
  resetAlertThrottleForTests();
  restart();
});
afterEach(() => {
  h.receipts.release();
  restart();
});

describe('a foreign live session is refused before publication', () => {
  it('concurrent lookups never see the foreign room while restore runs; restore refuses it and recovery proceeds', async () => {
    const stored = await storeMatchASession();
    h.receipts.arm(); // hold hydration at its first await after the room would exist

    const restore = restoreOrCreateTournamentRoom(CODE, MATCH_B, { winningScore: 30 }).then(
      () => 'restored',
      (err: Error) => err.message,
    );
    // Interleave with every step of the restore (no timers): the room map must
    // never hold CODE, for peekRoom or getRoom (what attach and runtime use).
    const observations: Array<boolean> = [];
    let settled = false;
    void restore.then(() => { settled = true; });
    for (let step = 0; step < 200 && !settled; step += 1) {
      observations.push(peekRoom(CODE) !== undefined);
      expect(() => getRoom(CODE)).toThrow();
      await Promise.race([Promise.resolve(), h.receipts.requested]);
    }
    // Whether the restore finished or got as far as the old publication point,
    // nothing was visible, and nothing is now.
    observations.push(peekRoom(CODE) !== undefined);
    h.receipts.release();

    expect(await restore).toBe('tournament_room_session_mismatch');
    expect(observations.every((visible) => !visible)).toBe(true);
    expect(h.receipts.calls).toBe(0); // refused before the room-creating step
    expect(peekRoom(CODE)).toBeUndefined();
    expect(h.liveSessions.get(CODE)).toEqual(stored); // never overwritten
    expect(foreignAlerts()).toBe(1);
  });

  it('the restore of the session\'s own match still publishes it', async () => {
    await storeMatchASession();

    const room = await restoreOrCreateTournamentRoom(CODE, MATCH_A, { winningScore: 30 });

    expect(room.scheduledTournamentMatchId).toBe(MATCH_A);
    expect(peekRoom(CODE)).toBe(room);
    expect(foreignAlerts()).toBe(0);
  });

  it('recovery then continues: no archive → at the cap, the missing-session path (foreign row untouched)', async () => {
    seedTournament();
    const stored = await storeMatchASession();
    h.matches.set(MATCH_B, matchRow(MATCH_B, { started_at: new Date(Date.now() - TOURNAMENT_MATCH_CAP_MS_DEFAULT - 60_000).toISOString() }));
    h.matches.set('sf1', matchRow('sf1', { round: 2, room_code: '', status: 'waiting', player1_id: null, player2_id: null, started_at: null }));

    await reconcileExpiredReadyMatches(makeIo(), new Date(), undefined, [structuredClone(h.tournaments.get(T)!) as any]);

    expect(h.matches.get(MATCH_B)).toMatchObject({ status: 'completed', status_reason: 'match_cap_missing_session_higher_seed' });
    expect(peekRoom(CODE)).toBeUndefined();
    expect(h.liveSessions.get(CODE)).toEqual(stored);
  });

  it('the tournament attach for match B never attaches into match A\'s session or room', async () => {
    seedTournament();
    await storeMatchASession();
    h.matches.set(MATCH_B, matchRow(MATCH_B));

    const { socket, handlers } = makeSocket(U1);
    registerRoomSessionHandlers(makeIo([socket]), socket);
    const ack = vi.fn();
    await handlers.get('tournament:attach_assigned_match')?.({ matchId: MATCH_B }, ack);

    expect(ack.mock.calls[0][0]).toMatchObject({ ok: false, error: 'tournament_room_session_mismatch' });
    expect(peekRoom(CODE)).toBeUndefined();

    // Same with A's room already in memory: refused, and A's room is not touched.
    const roomA = matchARoomInMemory();
    const ack2 = vi.fn();
    await handlers.get('tournament:attach_assigned_match')?.({ matchId: MATCH_B }, ack2);
    expect(ack2.mock.calls[0][0]).toMatchObject({ ok: false, error: 'tournament_room_session_mismatch' });
    expect(peekRoom(CODE)).toBe(roomA);
    expect(roomA.scheduledTournamentMatchId).toBe(MATCH_A);
    expect(getRoomRoster(CODE)).toEqual([]);
  });

  it('dispatch for match B never takes over match A\'s room in memory', async () => {
    seedTournament();
    h.matches.set(MATCH_B, matchRow(MATCH_B, { status: 'ready' }));
    const roomA = matchARoomInMemory();

    await expect(dispatchTournamentMatch(makeIo(), MATCH_B, { reason: 'repair' })).rejects.toThrow('tournament_room_session_mismatch');

    expect(roomA.scheduledTournamentMatchId).toBe(MATCH_A);
    expect(roomA.scheduledTournamentStarterUserId).toBeUndefined();
    expect(foreignAlerts()).toBe(1);
  });

  it('the engine never records or closes match A\'s in-memory room as match B\'s', async () => {
    seedTournament();
    h.matches.set(MATCH_B, matchRow(MATCH_B, { started_at: new Date(Date.now() - TOURNAMENT_MATCH_CAP_MS_DEFAULT - 60_000).toISOString() }));
    h.matches.set('sf1', matchRow('sf1', { round: 2, room_code: '', status: 'waiting', player1_id: null, player2_id: null, started_at: null }));
    const roomA = matchARoomInMemory();
    for (const [seat, user] of [['seat-a1', U1], ['seat-a2', U2]] as const) {
      joinRoom(CODE, seat);
      setRoomRoster(CODE, [...getRoomRoster(CODE), { id: seat, socketId: '', username: seat, userId: user }]);
    }
    await startGameUnlocked(CODE, makeIo());
    roomA.state = { ...roomA.state!, gameOver: true, handOver: true, winnerId: 'seat-a1' };

    await reconcileExpiredReadyMatches(makeIo(), new Date(), undefined, [structuredClone(h.tournaments.get(T)!) as any]);

    // B is not given A's result; with no copy of its own game it takes the missing-session path.
    expect(h.matches.get(MATCH_B)).toMatchObject({ status: 'completed', status_reason: 'match_cap_missing_session_higher_seed' });
    expect(roomA.abandonedAt).toBeUndefined();
    expect(roomA.gameOverPersistStatus ?? 'idle').toBe('idle');
  });
});

describe('terminal-join archive selection', () => {
  const archive = (partial: Row): Row => ({
    match_id: `room-${Math.random()}`, room_code: CODE, status: 'completed', event_log_version: 1, last_event_sequence: 1,
    event_count: 1, started_at: null, archived_at: new Date().toISOString(), participant_user_ids: [U1, U2],
    participants: [{ id: 'seat-1', username: 'a', userId: U1, seatIndex: 0 }, { id: 'seat-2', username: 'b', userId: U2, seatIndex: 1 }],
    summary: {}, state_snapshot: { gameOver: true }, events: [], ...partial,
  });
  const deps = (match: Row | null) => ({
    fetchMatchById: vi.fn(async () => match as any),
    fetchMatchByRoomCode: vi.fn(async () => match as any),
  });
  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

  it('a newer foreign archive with an explicit other match id does not hide the exact one', async () => {
    h.matchLogs = [
      archive({ match_id: 'exact-room', archived_at: minutesAgo(10), summary: { scheduledTournamentMatchId: MATCH_B } }),
      archive({ match_id: 'foreign-room', archived_at: minutesAgo(1), summary: { scheduledTournamentMatchId: MATCH_A } }),
    ];
    const terminal = await resolveArchivedTerminalJoin(CODE, { tournamentMatchId: MATCH_B }, deps(matchRow(MATCH_B, { started_at: minutesAgo(30) })));
    expect(terminal?.terminal.matchId).toBe('exact-room');
  });

  it('only a foreign explicit archive: nothing is reported', async () => {
    h.matchLogs = [archive({ match_id: 'foreign-room', summary: { scheduledTournamentMatchId: MATCH_A } })];
    expect(await resolveArchivedTerminalJoin(CODE, { tournamentMatchId: MATCH_B }, deps(matchRow(MATCH_B)))).toBeNull();
    // Also when the match is resolved from the code (a room:join).
    expect(await resolveArchivedTerminalJoin(CODE, {}, deps(matchRow(MATCH_B)))).toBeNull();
  });

  it('an exact new-format archive is reported', async () => {
    const code = 'T3D00000000BR1M1';
    h.matchLogs = [archive({ match_id: 'exact-room', room_code: code, status: 'abandoned', summary: { scheduledTournamentMatchId: MATCH_B } })];
    const terminal = await resolveArchivedTerminalJoin(code, { tournamentMatchId: MATCH_B }, deps(matchRow(MATCH_B, { room_code: code })));
    expect(terminal?.terminal).toEqual({ status: 'abandoned', matchId: 'exact-room', recoverable: true });
  });

  it('a legacy archive (no match id) is reported only under the compatibility identity', async () => {
    const match = matchRow(MATCH_B, { started_at: minutesAgo(30) });
    h.matchLogs = [archive({ match_id: 'legacy-room', archived_at: minutesAgo(5) })];
    expect((await resolveArchivedTerminalJoin(CODE, { tournamentMatchId: MATCH_B }, deps(match)))?.terminal.matchId).toBe('legacy-room');

    h.matchLogs = [archive({ match_id: 'other-players', participants: [{ id: 's1', username: 'a', userId: U1, seatIndex: 0 }, { id: 's3', username: 'c', userId: U3, seatIndex: 1 }] })];
    expect(await resolveArchivedTerminalJoin(CODE, { tournamentMatchId: MATCH_B }, deps(match))).toBeNull();

    h.matchLogs = [archive({ match_id: 'before-start', archived_at: minutesAgo(45) })];
    expect(await resolveArchivedTerminalJoin(CODE, { tournamentMatchId: MATCH_B }, deps(match))).toBeNull();
  });

  it('ordinary rooms are unchanged: the newest archive, and no tournament lookup', async () => {
    h.matchLogs = [
      archive({ match_id: 'older', room_code: 'PRIV01', archived_at: minutesAgo(10) }),
      archive({ match_id: 'newest', room_code: 'PRIV01', archived_at: minutesAgo(1), status: 'abandoned' }),
    ];
    const d = deps(null);
    const terminal = await resolveArchivedTerminalJoin('PRIV01', {}, d);
    expect(terminal?.terminal).toEqual({ status: 'abandoned', matchId: 'newest', recoverable: true });
    expect(d.fetchMatchById).not.toHaveBeenCalled();
    expect(d.fetchMatchByRoomCode).not.toHaveBeenCalled();
  });
});
