/**
 * Tournament turn clock (multiplayer/tournamentTurnClock.ts): timeouts play
 * the turn through the real room path, consecutive misses forfeit at
 * TOURNAMENT_MAX_MISSED_TURNS through applyActiveMatchForfeit, stale timers
 * are no-ops, a restored room re-arms, and only tournament rooms are timed.
 *
 * Real: rooms, act(), broadcastStateUpdate, the forfeit path, applyMatchResult
 * and restore. Faked: `supabaseFetch` (an in-memory `room_live_sessions`
 * table), tournament rows in `./persistence` (completion through the
 * in-memory port of `complete_tournament_match`), Sentry. Fake timers only.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
vi.mock('../multiplayer/gameOverPersistPolicy', async () => {
  const actual = await vi.importActual<typeof import('../multiplayer/gameOverPersistPolicy')>(
    '../multiplayer/gameOverPersistPolicy',
  );
  return { ...actual, GAME_OVER_PERSIST_RETRY_DELAYS_MS: [0, 0, 0, 0] };
});
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
  const { inMemoryMatchRpcForArrayStore } = await vi.importActual<
    typeof import('./inMemoryMatchRpc.testkit')
  >('./inMemoryMatchRpc.testkit');
  const rpc = () =>
    inMemoryMatchRpcForArrayStore({
      get tournament() {
        return [...db.tournaments.values()][0] as any;
      },
      get matches() {
        return [...db.matches.values()] as any;
      },
      get regs() {
        return db.regs as any;
      },
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
    completeTournamentMatch: (params: Parameters<typeof actual.completeTournamentMatch>[0]) =>
      rpc().completeTournamentMatch(params),
    promoteTournamentMatch: (...args: Parameters<typeof actual.promoteTournamentMatch>) =>
      rpc().promoteTournamentMatch(...args),
  };
});

import {
  act,
  createReservedRoom,
  getRoom,
  getRoomCanDraw,
  getRoomLegalMoves,
  joinRoom,
  peekRoom,
  readyForNextHand,
  resetLiveRoomPersistHookForTests,
  resetRoomRuntimeForTests,
  startGameUnlocked,
  type ActionPayload,
} from '../rooms';
import {
  broadcastStateUpdate,
  clearRoomMetadata,
  getRoomRoster,
  initRoomSession,
  resetRoomSessionStoresForTests,
  setRoomRoster,
} from '../multiplayer/roomSession';
import { persistLiveRoomSessionNow, resetLiveRoomPersistenceForTests } from '../multiplayer/roomLivePersistence';
import { onActivePlayerSocketDisconnect } from '../multiplayer/disconnectGrace';
import {
  getArmedTournamentTurn,
  getTournamentClockState,
  getTournamentMissedTurns,
  resetTournamentTurnClockForTests,
  setTournamentAutomaticActionForTests,
  syncTournamentTurnClock,
} from '../multiplayer/tournamentTurnClock';
import { SERVER_NOW_ISO } from './serverNow.testkit';
import { restoreOrCreateTournamentRoom } from './tournamentRoomRestore';
import * as mockedPersistence from './persistence';
import { defaultEnginePersistence } from './persistenceInterface';
import { TOURNAMENT_TURN_TIMEOUT_MS_DEFAULT } from './tournamentTimeouts';

const T = '4e000000-0000-4000-8000-000000000001';
const U1 = '4e000000-0000-4000-8000-0000000000a1';
const U2 = '4e000000-0000-4000-8000-0000000000a2';
const BOT = `bot:fritz:${T}:8`;
const TIMEOUT = TOURNAMENT_TURN_TIMEOUT_MS_DEFAULT;

/** Every room-scoped emit (io.to(room).emit), across the file. */
const roomEmit = vi.fn();
function makeIo() {
  return {
    sockets: { sockets: new Map(), adapter: { rooms: new Map() } },
    to: (room: string) => ({ emit: (event: string, payload: unknown) => roomEmit(room, event, payload) }),
    emit: vi.fn(),
  } as any;
}
const io = makeIo();

// The engine's default persistence can capture the real row functions before
// this file's mock of ./persistence applies (import cycle); point it at the
// mocked ones so every path (forfeit included) sees the same rows.
Object.assign(defaultEnginePersistence, {
  fetchMatchById: mockedPersistence.fetchMatchById,
  fetchMatchByRoomCode: mockedPersistence.fetchMatchByRoomCode,
  fetchMatches: mockedPersistence.fetchMatches,
  fetchTournamentById: mockedPersistence.fetchTournamentById,
  fetchTournamentsByStatus: mockedPersistence.fetchTournamentsByStatus,
  fetchRegistrations: mockedPersistence.fetchRegistrations,
  fetchRegistrationsWithProfile: mockedPersistence.fetchRegistrationsWithProfile,
  updateMatch: mockedPersistence.updateMatch,
  completeTournamentMatch: mockedPersistence.completeTournamentMatch,
  promoteTournamentMatch: mockedPersistence.promoteTournamentMatch,
});

function initSession() {
  initRoomSession(io, {
    resolveSocketIdentity: async () => ({ username: 'Player', userId: null }),
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

/** Everything a process restart loses. */
function restart() {
  resetTournamentTurnClockForTests();
  resetLiveRoomPersistenceForTests();
  resetLiveRoomPersistHookForTests();
  resetRoomRuntimeForTests();
  resetRoomSessionStoresForTests();
  initSession();
}

function matchRow(id: string, round: number, matchNumber: number, roomCode: string, p1: string | null, p2: string | null, partial: Row = {}): Row {
  return {
    id, tournament_id: T, round, match_number: matchNumber, player1_id: p1, player2_id: p2,
    winner_id: null, room_code: roomCode, status: 'waiting', ready_at: null, ready_deadline_at: null,
    started_at: null, completed_at: null, player1_joined_at: null, player2_joined_at: null,
    winner_source: null, status_reason: null, forfeit_user_id: null, no_show_user_id: null,
    bot_tier: null, player1_score: null, player2_score: null, ...partial,
  };
}

let seq = 0;
const seatOf = (userId: string) => `seat-${userId.slice(-2)}`;

/**
 * A tournament (or, with `tournament: false`, a private) room with a game
 * started and its clock synced the way production does it (a broadcast).
 * `p2` may be Fritz. `round` 3 builds a bracket whose final is this match.
 */
async function seedGame(opts: { p2?: string; tournament?: boolean; round?: 1 | 3 } = {}): Promise<{ roomCode: string; matchId: string }> {
  seq += 1;
  const p2 = opts.p2 ?? U2;
  const round = opts.round ?? 1;
  const roomCode = `T4E00${(0x10 + seq).toString(16).toUpperCase()}R${round}M1`;
  const matchId = `match-${seq}`;
  const now = new Date().toISOString();
  db.tournaments.set(T, {
    id: T, scheduled_start: now, registration_open_at: now, registration_close_at: now,
    status: 'in_progress', format: '7-tile', win_target: 30, max_players: 8, winner_id: null, created_at: now,
  });
  db.regs = [
    { id: 'r1', tournament_id: T, user_id: U1, registered_at: now, seed: 1, placement: null, status: 'active' },
    { id: 'r2', tournament_id: T, user_id: U2, registered_at: now, seed: 2, placement: null, status: 'active' },
  ];
  if (round === 3) {
    db.matches.set('qf1', matchRow('qf1', 1, 1, '', U1, BOT, { status: 'completed', winner_id: U1, completed_at: now }));
    db.matches.set('qf2', matchRow('qf2', 1, 2, '', `bot:fritz:${T}:4`, `bot:fritz:${T}:5`, { status: 'completed', winner_id: `bot:fritz:${T}:4`, completed_at: now }));
    db.matches.set('qf3', matchRow('qf3', 1, 3, '', U2, `bot:fritz:${T}:6`, { status: 'completed', winner_id: U2, completed_at: now }));
    db.matches.set('qf4', matchRow('qf4', 1, 4, '', `bot:fritz:${T}:2`, `bot:fritz:${T}:7`, { status: 'completed', winner_id: `bot:fritz:${T}:2`, completed_at: now }));
    db.matches.set('sf1', matchRow('sf1', 2, 1, '', U1, `bot:fritz:${T}:4`, { status: 'completed', winner_id: U1, completed_at: now }));
    db.matches.set('sf2', matchRow('sf2', 2, 2, '', U2, `bot:fritz:${T}:2`, { status: 'completed', winner_id: U2, completed_at: now }));
  }
  db.matches.set(matchId, matchRow(matchId, round, 1, roomCode, U1, p2, {
    status: 'in_progress', started_at: now, ready_at: now, player1_joined_at: now,
    player2_joined_at: p2 === BOT ? null : now,
  }));

  const room = createReservedRoom(roomCode, { winningScore: 30 });
  if (opts.tournament !== false) {
    room.scheduledTournamentMatchId = matchId;
    room.scheduledTournamentId = T;
  }
  const roster = [];
  for (const player of [U1, p2]) {
    const seatId = player === BOT ? BOT : seatOf(player);
    joinRoom(roomCode, seatId);
    roster.push({ id: seatId, socketId: '', username: player.slice(-2), userId: player === BOT ? null : player });
  }
  setRoomRoster(roomCode, roster);
  await startGameUnlocked(roomCode, io);
  broadcastStateUpdate(roomCode);
  return { roomCode, matchId };
}

const state = (roomCode: string) => getRoom(roomCode).state!;
const currentSeat = (roomCode: string) => state(roomCode).playerIds[state(roomCode).currentPlayerIndex];

function legalAction(roomCode: string, seatId: string): ActionPayload {
  if (getRoomCanDraw(roomCode, seatId)) return { type: 'DRAW' };
  const play = getRoomLegalMoves(roomCode, seatId).find((m) => m.type === 'play');
  if (play && play.type === 'play') return { type: 'MOVE', move: { tile: play.tile, position: play.position } };
  return { type: 'PASS' };
}

/** A player's own action, as the gameplay handler applies it. */
async function playerActs(roomCode: string, seatId: string): Promise<void> {
  await act(roomCode, seatId, legalAction(roomCode, seatId), io, (code) => broadcastStateUpdate(code));
  broadcastStateUpdate(roomCode);
}

/** Let `other` play (and both ready the next hand) until it is `seatId`'s turn again. */
async function untilTurnOf(roomCode: string, seatId: string, other: string): Promise<void> {
  for (let i = 0; i < 40; i += 1) {
    const s = state(roomCode);
    if (s.gameOver) throw new Error('game ended during the test');
    if (s.handOver) {
      await readyForNextHand(roomCode, seatId, io);
      await readyForNextHand(roomCode, other, io);
      broadcastStateUpdate(roomCode);
      continue;
    }
    if (currentSeat(roomCode) === seatId) return;
    await playerActs(roomCode, other);
  }
  throw new Error('turn never came back');
}

/** Advance to just past the current turn's timeout. */
const timeOut = () => vi.advanceTimersByTimeAsync(TIMEOUT + 1);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  db.liveSessions.clear();
  db.matches.clear();
  db.tournaments.clear();
  db.regs = [];
  roomEmit.mockClear();
  restart();
});
afterEach(() => {
  restart();
  vi.useRealTimers();
});

describe('tournament turn clock', () => {
  it('times the human whose turn it is', async () => {
    const { roomCode } = await seedGame();

    expect(getArmedTournamentTurn(roomCode)?.seatId).toBe(currentSeat(roomCode));
  });

  it('a timeout plays the turn through the room path and counts one missed turn', async () => {
    const { roomCode } = await seedGame();
    const seat = currentSeat(roomCode);
    const before = state(roomCode).sequence;

    await timeOut();

    expect(state(roomCode).sequence).toBeGreaterThan(before);
    expect(currentSeat(roomCode) === seat && !state(roomCode).handOver).toBe(false);
    expect(getTournamentMissedTurns(roomCode, seat)).toBe(1);
  });

  it("the player's own action cancels the timer, and the old timer does nothing", async () => {
    const { roomCode } = await seedGame();
    const seat = currentSeat(roomCode);
    await vi.advanceTimersByTimeAsync(10_000);
    await playerActs(roomCode, seat);
    const afterOwnMove = state(roomCode).sequence;

    // The old deadline passes; the opponent's new clock has 10 s left.
    await vi.advanceTimersByTimeAsync(TIMEOUT - 10_000 + 1);

    expect(state(roomCode).sequence).toBe(afterOwnMove);
    expect(getTournamentMissedTurns(roomCode, seat)).toBe(0);
  });

  it('a player acting themselves resets their missed-turn streak', async () => {
    const { roomCode } = await seedGame();
    const seat = currentSeat(roomCode);
    const other = seat === seatOf(U1) ? seatOf(U2) : seatOf(U1);
    await timeOut();
    expect(getTournamentMissedTurns(roomCode, seat)).toBe(1);

    await untilTurnOf(roomCode, seat, other);
    await playerActs(roomCode, seat);

    expect(getTournamentMissedTurns(roomCode, seat)).toBe(0);
  });

  it('forfeits at exactly the 3rd consecutive missed turn, not at the 2nd', async () => {
    const { roomCode, matchId } = await seedGame();
    const seat = currentSeat(roomCode);
    const other = seat === seatOf(U1) ? seatOf(U2) : seatOf(U1);
    const absentUser = seat === seatOf(U1) ? U1 : U2;
    const presentUser = absentUser === U1 ? U2 : U1;

    for (let missed = 1; missed <= 2; missed += 1) {
      await timeOut();
      expect(getTournamentMissedTurns(roomCode, seat)).toBe(missed);
      expect(db.matches.get(matchId)!.status).toBe('in_progress');
      await untilTurnOf(roomCode, seat, other);
    }
    await timeOut();
    // The forfeit path loads roomForfeit lazily (as the disconnect forfeit does).
    await vi.waitFor(() => expect(db.matches.get(matchId)!.status).toBe('completed'));

    expect(db.matches.get(matchId)).toMatchObject({
      status: 'completed',
      winner_id: presentUser,
      winner_source: 'forfeit',
      status_reason: 'missed_turns',
      forfeit_user_id: absentUser,
    });
    expect(getRoom(roomCode).abandonedAt).toBeTruthy();
    expect(getArmedTournamentTurn(roomCode)).toBeNull();
  });

  it('a disconnected player is timed by the same clock; the disconnect grace does not act', async () => {
    const { roomCode } = await seedGame();
    const seat = currentSeat(roomCode);
    const before = state(roomCode).sequence;
    onActivePlayerSocketDisconnect(roomCode, seat, io, (code) => broadcastStateUpdate(code));

    await vi.advanceTimersByTimeAsync(TIMEOUT - 1_000);
    expect(state(roomCode).sequence).toBe(before);

    await vi.advanceTimersByTimeAsync(1_001);
    expect(state(roomCode).sequence).toBeGreaterThan(before);
    expect(getTournamentMissedTurns(roomCode, seat)).toBe(1);
  });

  it('a timer left over after the match ended does nothing', async () => {
    const { roomCode } = await seedGame();
    const seat = currentSeat(roomCode);
    const before = state(roomCode).sequence;
    getRoom(roomCode).abandonedAt = new Date().toISOString();

    await timeOut();

    expect(state(roomCode).sequence).toBe(before);
    expect(getTournamentMissedTurns(roomCode, seat)).toBe(0);
  });

  it('a timer left over after the room was removed does nothing', async () => {
    const { roomCode } = await seedGame();
    clearRoomMetadata(roomCode);

    expect(getArmedTournamentTurn(roomCode)).toBeNull();
    await timeOut();
  });

  it('many callers syncing the same turn arm one timer; one timeout resolves the turn once', async () => {
    const { roomCode } = await seedGame();
    const seat = currentSeat(roomCode);
    const armed = getArmedTournamentTurn(roomCode);
    for (let i = 0; i < 5; i += 1) {
      syncTournamentTurnClock(roomCode);
      broadcastStateUpdate(roomCode);
    }
    expect(getArmedTournamentTurn(roomCode)).toEqual(armed);

    await timeOut();

    expect(getTournamentMissedTurns(roomCode, seat)).toBe(1);
  });

  it('does not time Fritz turns', async () => {
    const { roomCode } = await seedGame({ p2: BOT });
    if (currentSeat(roomCode) !== BOT) {
      await playerActs(roomCode, seatOf(U1));
    }
    if (currentSeat(roomCode) === BOT && !state(roomCode).handOver) {
      expect(getArmedTournamentTurn(roomCode)).toBeNull();
    }
  });

  it('a restored room re-arms the clock for the turn in progress (fresh timeout)', async () => {
    const { roomCode, matchId } = await seedGame();
    const seat = currentSeat(roomCode);
    const roster = getRoomRoster(roomCode).map((p) => ({ seatId: p.id, userId: p.userId, username: p.username }));
    expect(await persistLiveRoomSessionNow(getRoom(roomCode), roster)).toBe(true);
    const before = state(roomCode).sequence;
    restart();
    expect(getArmedTournamentTurn(roomCode)).toBeNull();

    await restoreOrCreateTournamentRoom(roomCode, matchId, { winningScore: 30 });
    await restoreOrCreateTournamentRoom(roomCode, matchId, { winningScore: 30 });

    expect(getArmedTournamentTurn(roomCode)?.seatId).toBe(seat);
    await timeOut();
    expect(state(roomCode).sequence).toBeGreaterThan(before);
    expect(getTournamentMissedTurns(roomCode, seat)).toBe(1);
  });

  it('non-tournament rooms are not timed at all', async () => {
    const { roomCode } = await seedGame({ tournament: false });
    const before = state(roomCode).sequence;

    expect(getArmedTournamentTurn(roomCode)).toBeNull();
    await vi.advanceTimersByTimeAsync(TIMEOUT * 3);
    expect(state(roomCode).sequence).toBe(before);
  });

  it('a missed-turn forfeit in the final completes the tournament with placements', async () => {
    const { roomCode, matchId } = await seedGame({ round: 3 });
    const seat = currentSeat(roomCode);
    const other = seat === seatOf(U1) ? seatOf(U2) : seatOf(U1);
    const absentUser = seat === seatOf(U1) ? U1 : U2;
    const presentUser = absentUser === U1 ? U2 : U1;

    for (let i = 0; i < 2; i += 1) {
      await timeOut();
      await untilTurnOf(roomCode, seat, other);
    }
    await timeOut();
    await vi.waitFor(() => expect(db.matches.get(matchId)!.status).toBe('completed'));

    expect(db.matches.get(matchId)).toMatchObject({ status: 'completed', winner_id: presentUser, status_reason: 'missed_turns' });
    expect(db.tournaments.get(T)).toMatchObject({ status: 'completed', winner_id: presentUser });
    const placementOf = (u: string) => db.regs.find((r) => r.user_id === u)?.placement;
    expect(placementOf(presentUser)).toBe(1);
    expect(placementOf(absentUser)).toBe(2);
  });
});

/**
 * The clock clients see (Phase 3B.2): every tournament `state:update` carries
 * `tournamentClock` (the decision the server is timing and when its timer
 * fires) and `serverNow`. Display only — the server timer is authoritative.
 */
describe('tournament clock contract', () => {
  /** A socket in the room that records what it is sent (as a reconnecting client's would be). */
  function observe(roomCode: string) {
    const sock = { id: `obs-${roomCode}`, data: {}, rooms: new Set([roomCode]), emit: vi.fn(), join: vi.fn() };
    io.sockets.sockets.set(sock.id, sock);
    io.sockets.adapter.rooms.set(roomCode, new Set([sock.id]));
    const updates = () => sock.emit.mock.calls.filter(([e]) => e === 'state:update').map(([, p]) => p as Row);
    return { last: () => updates().at(-1)!, count: () => updates().length };
  }

  it('the first human turn: a deadline 45 s out, with serverNow, in state:update', async () => {
    const { roomCode } = await seedGame();
    const obs = observe(roomCode);
    broadcastStateUpdate(roomCode);
    const now = Date.now();
    expect(obs.last().serverNow).toMatch(SERVER_NOW_ISO);
    expect(obs.last().tournamentClock).toEqual({
      kind: 'turn', seatId: currentSeat(roomCode), deadlineAt: new Date(now + TIMEOUT).toISOString(), missedTurns: 0, maxMissedTurns: 3,
    });
    expect(getTournamentClockState(roomCode)).toEqual(obs.last().tournamentClock);
  });

  it('a player action: the next decision gets its own fresh deadline in the same broadcast', async () => {
    const { roomCode } = await seedGame();
    const obs = observe(roomCode);
    const first = currentSeat(roomCode);
    await vi.advanceTimersByTimeAsync(10_000);
    await playerActs(roomCode, first);
    const clock = obs.last().tournamentClock;
    if (state(roomCode).handOver) {
      expect(clock.kind).toBe('next_hand');
    } else {
      expect(clock).toMatchObject({ kind: 'turn', seatId: currentSeat(roomCode), deadlineAt: new Date(Date.now() + TIMEOUT).toISOString() });
    }
  });

  it('a missed turn: counted on the clock the next time that seat is timed, with a fresh deadline', async () => {
    const { roomCode } = await seedGame();
    const obs = observe(roomCode);
    const seat = currentSeat(roomCode);
    const other = seat === seatOf(U1) ? seatOf(U2) : seatOf(U1);
    await timeOut();
    await untilTurnOf(roomCode, seat, other);
    broadcastStateUpdate(roomCode);
    expect(obs.last().tournamentClock).toMatchObject({
      kind: 'turn', seatId: seat, missedTurns: 1, maxMissedTurns: 3, deadlineAt: getTournamentClockState(roomCode)!.deadlineAt,
    });
    expect(Date.parse(obs.last().tournamentClock.deadlineAt)).toBeGreaterThan(Date.now());
  });

  it('the third miss forfeits through the existing path and clears the clock', async () => {
    const { roomCode, matchId } = await seedGame();
    const seat = currentSeat(roomCode);
    const other = seat === seatOf(U1) ? seatOf(U2) : seatOf(U1);
    for (let missed = 1; missed <= 2; missed += 1) {
      await timeOut();
      await untilTurnOf(roomCode, seat, other);
    }
    expect(getTournamentClockState(roomCode)).toMatchObject({ seatId: seat, missedTurns: 2 });
    await timeOut();
    await vi.waitFor(() => expect(db.matches.get(matchId)!.status_reason).toBe('missed_turns'));
    expect(getTournamentClockState(roomCode)).toBeNull();
  });

  it('between hands: kind next_hand (no seat, the humans still to ready); its expiry is not a missed turn', async () => {
    const { roomCode } = await seedGame();
    const obs = observe(roomCode);
    for (let i = 0; i < 400 && !state(roomCode).handOver; i += 1) await playerActs(roomCode, currentSeat(roomCode));
    expect(state(roomCode).handOver).toBe(true);
    if (state(roomCode).gameOver) return; // a 30-point hand ends the game: nothing to wait for
    broadcastStateUpdate(roomCode);
    expect(obs.last().tournamentClock).toEqual({
      kind: 'next_hand', seatId: null, waitingSeatIds: expect.arrayContaining([seatOf(U1), seatOf(U2)]), deadlineAt: new Date(Date.now() + TIMEOUT).toISOString(),
    });
    const handNumber = state(roomCode).handNumber;
    await timeOut();
    await vi.waitFor(() => expect(state(roomCode).handNumber).toBe(handNumber + 1));
    expect(getTournamentMissedTurns(roomCode, seatOf(U1))).toBe(0);
    expect(getTournamentMissedTurns(roomCode, seatOf(U2))).toBe(0);
  });

  it('an administrative close (the room latched) clears the clock', async () => {
    const { roomCode } = await seedGame();
    expect(getTournamentClockState(roomCode)).not.toBeNull();
    // Loaded on use: a static import of the engine here cycles with this file's ./persistence mock.
    const { closeTournamentRoom } = await import('./engine');
    closeTournamentRoom(getRoom(roomCode), new Date());
    expect(getTournamentClockState(roomCode)).toBeNull();
  });

  it('a restored room gets a fresh deadline from the restore, not the old remaining time', async () => {
    const { roomCode, matchId } = await seedGame();
    const before = getTournamentClockState(roomCode)!;
    const roster = getRoomRoster(roomCode).map((p) => ({ seatId: p.id, userId: p.userId, username: p.username }));
    expect(await persistLiveRoomSessionNow(getRoom(roomCode), roster)).toBe(true);
    restart();
    await vi.advanceTimersByTimeAsync(20_000);
    await restoreOrCreateTournamentRoom(roomCode, matchId, { winningScore: 30 });
    const after = getTournamentClockState(roomCode)!;
    expect(after).toMatchObject({ kind: 'turn', seatId: before.seatId });
    expect(after.deadlineAt).toBe(new Date(Date.now() + TIMEOUT).toISOString());
    expect(Date.parse(after.deadlineAt)).toBeGreaterThan(Date.parse(before.deadlineAt));
  });

  it('a re-arm without a state broadcast (the automatic move failed) is announced to the room', async () => {
    const { roomCode } = await seedGame();
    const seat = currentSeat(roomCode);
    // The room refuses every automatic action (as tournamentMissAccounting's rejectEverything).
    setTournamentAutomaticActionForTests(async (code, _seatId, decide) => {
      const room = peekRoom(code)!;
      if (!(decide as (r: typeof room) => ActionPayload | null)(room)) return null;
      throw new Error('rejected by the room');
    });
    try {
      await timeOut();
      await vi.waitFor(() => expect(roomEmit).toHaveBeenCalledWith(roomCode, 'tournament:clock', expect.objectContaining({
        roomCode,
        serverNow: expect.stringMatching(SERVER_NOW_ISO),
        tournamentClock: expect.objectContaining({ kind: 'turn', seatId: seat }),
      })));
    } finally {
      setTournamentAutomaticActionForTests(null);
    }
  });

  it('disconnect: a tournament room announces the turn-clock policy, never a grace; a normal room keeps its grace', async () => {
    const t = await seedGame();
    const seat = currentSeat(t.roomCode);
    onActivePlayerSocketDisconnect(t.roomCode, seat, io, (code) => broadcastStateUpdate(code));
    expect(roomEmit).toHaveBeenCalledWith(t.roomCode, 'player:disconnected', { playerId: seat, graceMs: null, policy: 'turn_clock' });

    const p = await seedGame({ tournament: false });
    const pSeat = currentSeat(p.roomCode);
    onActivePlayerSocketDisconnect(p.roomCode, pSeat, io, (code) => broadcastStateUpdate(code));
    const normal = roomEmit.mock.calls.find(([room, event]) => room === p.roomCode && event === 'player:disconnected')![2] as Row;
    expect(normal).toEqual({ playerId: pSeat, graceMs: expect.any(Number) });
    expect(normal.graceMs).toBeGreaterThan(0);
    expect(normal).not.toHaveProperty('policy');
  });

  it('a normal (non-tournament) room has no clock fields at all', async () => {
    const { roomCode } = await seedGame({ tournament: false });
    const obs = observe(roomCode);
    broadcastStateUpdate(roomCode);
    expect(obs.last()).not.toHaveProperty('tournamentClock');
    expect(obs.last()).not.toHaveProperty('serverNow');
    expect(getTournamentClockState(roomCode)).toBeNull();
  });
});
