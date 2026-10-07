/**
 * Tournament turn clock races and bounds (Phase 1.1 §1/§2): a timeout that
 * fires while a player action, a match end or a room replacement is in flight
 * re-checks inside the gameplay lock and does nothing; a timed-out turn is one
 * missed turn however many actions it takes (forced draws, extra turns); a
 * handler that stops making progress or exceeds the state-derived action bound
 * fails loudly instead of looping.
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
  deleteRoom,
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
  initRoomSession,
  resetRoomSessionStoresForTests,
  setRoomRoster,
} from '../multiplayer/roomSession';
import { resetLiveRoomPersistenceForTests } from '../multiplayer/roomLivePersistence';
import {
  getArmedTournamentTurn,
  getTournamentMissedTurns,
  resetTournamentTurnClockForTests,
  setTournamentAutomaticActionForTests,
  settleTournamentTurnClockForTests,
  syncTournamentTurnClock,
} from '../multiplayer/tournamentTurnClock';
import { withRoomGameplayLock } from '../multiplayer/roomGameplayLock';
import * as Sentry from '@sentry/node';
import { resetAlertThrottleForTests } from './tournamentAlerts';
import * as mockedPersistence from './persistence';
import { defaultEnginePersistence } from './persistenceInterface';
import { TOURNAMENT_TURN_TIMEOUT_MS_DEFAULT } from './tournamentTimeouts';

const T = '4e000000-0000-4000-8000-000000000001';
const U1 = '4e000000-0000-4000-8000-0000000000a1';
const U2 = '4e000000-0000-4000-8000-0000000000a2';
const BOT = `bot:fritz:${T}:8`;
const TIMEOUT = TOURNAMENT_TURN_TIMEOUT_MS_DEFAULT;

function makeIo() {
  return {
    sockets: { sockets: new Map(), adapter: { rooms: new Map() } },
    to: () => ({ emit: vi.fn() }),
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
  resetAlertThrottleForTests();
  vi.mocked(Sentry.captureMessage).mockClear();
  restart();
});
afterEach(() => {
  restart();
  vi.useRealTimers();
});

const otherSeat = (seat: string) => (seat === seatOf(U1) ? seatOf(U2) : seatOf(U1));

/** Hold the room's gameplay lock (as an in-flight player action would) until released. */
function holdLock(roomCode: string): { release: () => void; done: Promise<unknown> } {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const done = withRoomGameplayLock(roomCode, () => gate);
  return { release, done };
}

const anomalyAlerts = (kind: string) =>
  vi.mocked(Sentry.captureMessage).mock.calls.filter(([message]) => message === `[tournament] ${kind}`);

describe('tournament turn clock: races at the deadline (§1)', () => {
  it('a player action already queued at the deadline wins; the timeout does nothing and counts nothing', async () => {
    const { roomCode } = await seedGame();
    const seat = currentSeat(roomCode);
    const lock = holdLock(roomCode);
    const own = playerActs(roomCode, seat);

    // The timer fires and passes its pre-check, then queues behind the player.
    await timeOut();
    lock.release();
    await own;
    await settleTournamentTurnClockForTests();

    expect(getTournamentMissedTurns(roomCode, seat)).toBe(0);
    const s = state(roomCode);
    const ownTurnStillOpen = currentSeat(roomCode) === seat && !s.handOver && s.consecutivePasses === 0;
    // The player's own action is the only one applied: if it left their turn
    // open (a draw, an extra turn) it is still theirs, freshly timed.
    if (!s.handOver) {
      expect(getArmedTournamentTurn(roomCode)?.seatId).toBe(ownTurnStillOpen ? seat : currentSeat(roomCode));
    }
  });

  it('a match that ends while the timeout waits for the lock is left alone', async () => {
    const { roomCode } = await seedGame();
    const seat = currentSeat(roomCode);
    const before = state(roomCode).sequence;
    const lock = holdLock(roomCode);

    await timeOut();
    getRoom(roomCode).abandonedAt = new Date().toISOString(); // e.g. the match cap resolved it
    lock.release();
    await settleTournamentTurnClockForTests();

    expect(state(roomCode).sequence).toBe(before);
    expect(getTournamentMissedTurns(roomCode, seat)).toBe(0);
  });

  it('a room replaced while the timeout waits (same code, same turn key) is not acted on', async () => {
    const { roomCode } = await seedGame();
    const seat = currentSeat(roomCode);
    const before = state(roomCode).sequence;
    const lock = holdLock(roomCode);

    await timeOut();
    // A restore swaps in a different room object that waits on the very same
    // decision; the stale timer must not act on it.
    const old = getRoom(roomCode);
    deleteRoom(roomCode);
    const replacement = createReservedRoom(roomCode, { winningScore: 30 });
    Object.assign(replacement, { ...old, nextHandReady: new Set(old.nextHandReady) });
    expect(peekRoom(roomCode)).not.toBe(old);
    lock.release();
    await settleTournamentTurnClockForTests();

    expect(state(roomCode).sequence).toBe(before);
    expect(getTournamentMissedTurns(roomCode, seat)).toBe(0);
  });

  it('at the forfeit threshold, a player action queued at the deadline prevents the forfeit', async () => {
    const { roomCode, matchId } = await seedGame();
    const seat = currentSeat(roomCode);
    for (let missed = 1; missed <= 2; missed += 1) {
      await timeOut();
      await untilTurnOf(roomCode, seat, otherSeat(seat));
    }
    expect(getTournamentMissedTurns(roomCode, seat)).toBe(2);
    const lock = holdLock(roomCode);
    const own = playerActs(roomCode, seat);

    await timeOut();
    lock.release();
    await own;
    await settleTournamentTurnClockForTests();

    expect(db.matches.get(matchId)!.status).toBe('in_progress');
    expect(getRoom(roomCode).abandonedAt).toBeFalsy();
    expect(getRoom(roomCode).tournamentForfeitApplyStatus).not.toBe('pending');
    expect(getTournamentMissedTurns(roomCode, seat)).toBe(0);
  });
});

describe('tournament turn clock: one timed-out turn, bounded (§2)', () => {
  it('every timeout is exactly one missed turn and closes that turn, through forced draws and extra turns', async () => {
    vi.stubEnv('TOURNAMENT_MAX_MISSED_TURNS', '20');
    let multiActionTurns = 0;
    for (let game = 0; game < 4; game += 1) {
      // Deterministic deals: a seeded PRNG for the shuffle.
      let seed = 0x9e3779b9 + game;
      vi.spyOn(Math, 'random').mockImplementation(() => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      });
      const { roomCode } = await seedGame();
      for (let i = 0; i < 60; i += 1) {
        const room = getRoom(roomCode);
        if (!room.state || room.state.gameOver || room.abandonedAt) break;
        if (room.state.handOver) {
          // The next hand starts after a short delay (a timer).
          const readies = room.players.map((seat) => readyForNextHand(roomCode, seat, io));
          await vi.advanceTimersByTimeAsync(10_000);
          await Promise.all(readies);
          broadcastStateUpdate(roomCode);
          continue;
        }
        const seat = currentSeat(roomCode);
        const missedBefore = getTournamentMissedTurns(roomCode, seat);
        const seqBefore = state(roomCode).sequence;

        await timeOut();
        await settleTournamentTurnClockForTests();

        const after = getRoom(roomCode);
        // The 20th miss forfeited, or the automatic play won the game (either
        // ends the match and clears its streaks).
        if (after.abandonedAt || after.state!.gameOver) break;
        expect(getTournamentMissedTurns(roomCode, seat)).toBe(missedBefore + 1);
        const s = after.state!;
        // The same turn is never left open: either someone else moves, the hand
        // or game ended, or the seat is up again only because the opponent passed.
        expect(!s.gameOver && !s.handOver && currentSeat(roomCode) === seat && s.consecutivePasses === 0).toBe(false);
        if (s.sequence - seqBefore > 1) multiActionTurns += 1;
      }
      vi.mocked(Math.random).mockRestore();
    }
    expect(anomalyAlerts('turn_clock_no_progress')).toHaveLength(0);
    expect(anomalyAlerts('turn_clock_action_bound_exceeded')).toHaveLength(0);
    // Not a guarantee of the dealt tiles, only a sanity check that the
    // multi-action path ran at all across four games.
    expect(multiActionTurns).toBeGreaterThan(0);
  });

  it('an automatic action that does not advance the state stops the turn and alerts (no loop)', async () => {
    const { roomCode } = await seedGame();
    const seat = currentSeat(roomCode);
    const before = state(roomCode).sequence;
    let calls = 0;
    setTournamentAutomaticActionForTests(async (code, seatId, decide) => {
      calls += 1;
      const room = peekRoom(code)!;
      if (!(decide as (r: typeof room) => ActionPayload | null)(room)) return null;
      const s = room.state!;
      return {
        sequence: s.sequence, handNumber: s.handNumber, currentSeatId: seatId,
        consecutivePasses: 0, handOver: false, gameOver: false,
      };
    });

    await timeOut();
    await settleTournamentTurnClockForTests();

    expect(calls).toBe(1);
    expect(state(roomCode).sequence).toBe(before);
    expect(anomalyAlerts('turn_clock_no_progress')).toHaveLength(1);
    expect(getTournamentMissedTurns(roomCode, seat)).toBe(1);
  });

  it('a turn that never closes stops at the bound derived from the hand and boneyard, and alerts', async () => {
    const { roomCode } = await seedGame();
    const seat = currentSeat(roomCode);
    const s0 = state(roomCode);
    const bound = 2 * (s0.players[seat].hand.length + s0.boneyard.length) + 2;
    let calls = 0;
    setTournamentAutomaticActionForTests(async (code, seatId, decide) => {
      const room = peekRoom(code)!;
      const action = (decide as (r: typeof room) => ActionPayload | null)(room);
      if (!action) return null;
      calls += 1;
      // Pretend every action advanced the state but kept the turn open.
      room.state = { ...room.state!, sequence: room.state!.sequence + 1 };
      return {
        sequence: room.state.sequence, handNumber: room.state.handNumber, currentSeatId: seatId,
        consecutivePasses: 0, handOver: false, gameOver: false,
      };
    });
    // A pass would close the turn; keep the decision a draw or a play.
    const firstAction = getRoomCanDraw(roomCode, seat) || getRoomLegalMoves(roomCode, seat).some((m) => m.type === 'play');
    expect(firstAction).toBe(true);

    await timeOut();
    await settleTournamentTurnClockForTests();

    expect(calls).toBe(bound);
    expect(anomalyAlerts('turn_clock_action_bound_exceeded')).toHaveLength(1);
    expect(getTournamentMissedTurns(roomCode, seat)).toBe(1);
  });

  it('an automatic action the room rejects falls back to the next candidate; if all are rejected it alerts and re-arms', async () => {
    const { performAutomaticSeatAction } = await import('../multiplayer/roomSession');
    const { roomCode } = await seedGame();
    const seat = currentSeat(roomCode);
    const before = state(roomCode).sequence;
    let rejectAll = false;
    let calls = 0;
    setTournamentAutomaticActionForTests(async (code, seatId, decide) => {
      calls += 1;
      if (rejectAll || calls === 1) {
        const room = peekRoom(code)!;
        if (!(decide as (r: typeof room) => ActionPayload | null)(room)) return null;
        throw new Error('rejected by the room');
      }
      return performAutomaticSeatAction(code, seatId, decide);
    });
    const candidates = getRoomCanDraw(roomCode, seat)
      ? 1
      : Math.max(1, getRoomLegalMoves(roomCode, seat).filter((m) => m.type === 'play').length);

    await timeOut();
    await settleTournamentTurnClockForTests();

    if (candidates > 1) {
      // The second candidate was applied: the turn was played, once.
      expect(state(roomCode).sequence).toBeGreaterThan(before);
      expect(getTournamentMissedTurns(roomCode, seat)).toBe(1);
      expect(anomalyAlerts('turn_clock_action_failed')).toHaveLength(0);
    } else {
      expect(anomalyAlerts('turn_clock_action_failed')).toHaveLength(1);
      // The turn is still open on a fresh timer; the retry (calls > 1: the real
      // action now) plays it without counting it again (Phase 1.2 D5).
      await timeOut();
      await settleTournamentTurnClockForTests();
      expect(state(roomCode).sequence).toBeGreaterThan(before);
      expect(getTournamentMissedTurns(roomCode, seat)).toBe(1);
    }

    // Now every candidate is refused on the next timed turn.
    await untilTurnOf(roomCode, seat, otherSeat(seat));
    const missedBefore = getTournamentMissedTurns(roomCode, seat);
    const seqBefore = state(roomCode).sequence;
    resetAlertThrottleForTests(); // Sentry alerts per match are rate-limited
    const alertsBefore = anomalyAlerts('turn_clock_action_failed').length;
    rejectAll = true;
    await timeOut();
    await settleTournamentTurnClockForTests();

    expect(state(roomCode).sequence).toBe(seqBefore);
    expect(getTournamentMissedTurns(roomCode, seat)).toBe(missedBefore + 1);
    expect(anomalyAlerts('turn_clock_action_failed')).toHaveLength(alertsBefore + 1);
    // Not stranded: a fresh timer is running for the same open turn.
    expect(getArmedTournamentTurn(roomCode)?.seatId).toBe(seat);
  });
});
