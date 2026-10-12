/**
 * Tournament between-hands deadline (Phase 1.1 §5): when a hand is over and a
 * human has not readied for the next one, the turn clock readies them through
 * `readyForNextHand` (as Fritz is readied) after the turn timeout. It is not a
 * missed turn. Players readying themselves, a stale hand, and non-tournament
 * rooms are left alone.
 *
 * Real: rooms, act(), readyForNextHand, broadcastStateUpdate. Faked as in
 * tournamentTurnClock.test.ts. Fake timers; a seeded Math.random for the deals.
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
  initRoomSession,
  resetRoomSessionStoresForTests,
  setRoomRoster,
} from '../multiplayer/roomSession';
import { resetLiveRoomPersistenceForTests } from '../multiplayer/roomLivePersistence';
import {
  getArmedTournamentTurn,
  getTournamentMissedTurns,
  resetTournamentTurnClockForTests,
  settleTournamentTurnClockForTests,
  syncTournamentTurnClock,
} from '../multiplayer/tournamentTurnClock';
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
async function seedGame(opts: { p2?: string; tournament?: boolean; round?: 1 | 3; winningScore?: number } = {}): Promise<{ roomCode: string; matchId: string }> {
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

  const room = createReservedRoom(roomCode, { winningScore: opts.winningScore ?? 30 });
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

function seedRandom(seed: number) {
  let a = seed;
  vi.spyOn(Math, 'random').mockImplementation(() => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  });
}
beforeEach(() => seedRandom(0x5eed));
afterEach(() => { vi.mocked(Math.random).mockRestore?.(); });

/** The players (or Fritz, on its own timer) play legally until the hand is over. */
async function playUntilHandOver(roomCode: string): Promise<void> {
  for (let i = 0; i < 400; i += 1) {
    const s = state(roomCode);
    if (s.handOver || s.gameOver) return;
    const seat = currentSeat(roomCode);
    if (seat.startsWith('bot:fritz:')) {
      await vi.advanceTimersByTimeAsync(2_000);
      continue;
    }
    await playerActs(roomCode, seat);
  }
  throw new Error('hand never ended');
}

const handNumber = (roomCode: string) => state(roomCode).handNumber;
/** Past the deadline, plus time for the next hand's start delay. */
const pastDeadline = () => vi.advanceTimersByTimeAsync(TIMEOUT + 10_000);

describe('tournament between-hands deadline (§5)', () => {
  it('two humans who never ready are readied at the deadline; the next hand starts; no missed turn', async () => {
    const { roomCode } = await seedGame({ winningScore: 500 });
    await playUntilHandOver(roomCode);
    const hand = handNumber(roomCode);
    expect(getArmedTournamentTurn(roomCode)).toMatchObject({ kind: 'next_hand' });

    await vi.advanceTimersByTimeAsync(TIMEOUT - 1_000);
    expect(state(roomCode).handOver).toBe(true);

    await vi.advanceTimersByTimeAsync(11_000);
    await settleTournamentTurnClockForTests();

    expect(handNumber(roomCode)).toBe(hand + 1);
    expect(state(roomCode).handOver).toBe(false);
    for (const seat of [seatOf(U1), seatOf(U2)]) expect(getTournamentMissedTurns(roomCode, seat)).toBe(0);
    // The new hand's first turn is timed as usual.
    expect(getArmedTournamentTurn(roomCode)).toMatchObject({ kind: 'turn', seatId: currentSeat(roomCode) });
  });

  it('a human vs Fritz: Fritz readies itself, the absent human is readied at the deadline', async () => {
    const { roomCode } = await seedGame({ p2: BOT, winningScore: 500 });
    await playUntilHandOver(roomCode);
    const hand = handNumber(roomCode);
    await vi.advanceTimersByTimeAsync(2_000); // Fritz's own auto-ready
    expect(getRoom(roomCode).nextHandReady.has(BOT)).toBe(true);
    expect(handNumber(roomCode)).toBe(hand);

    await pastDeadline();
    await settleTournamentTurnClockForTests();

    expect(handNumber(roomCode)).toBe(hand + 1);
    expect(getTournamentMissedTurns(roomCode, seatOf(U1))).toBe(0);
  });

  it('players who ready themselves start the hand and the old deadline does nothing', async () => {
    const { roomCode } = await seedGame({ winningScore: 500 });
    await playUntilHandOver(roomCode);
    const hand = handNumber(roomCode);
    await vi.advanceTimersByTimeAsync(5_000);
    const readies = [seatOf(U1), seatOf(U2)].map((seat) => readyForNextHand(roomCode, seat, io, hand));
    await vi.advanceTimersByTimeAsync(10_000);
    await Promise.all(readies);
    broadcastStateUpdate(roomCode);
    expect(handNumber(roomCode)).toBe(hand + 1);
    const seqAtStart = state(roomCode).sequence;
    const armed = getArmedTournamentTurn(roomCode);
    expect(armed).toMatchObject({ kind: 'turn' });

    // The old next-hand deadline passes; the new turn's own deadline has not.
    await vi.advanceTimersByTimeAsync(TIMEOUT - 15_000 + 1);
    await settleTournamentTurnClockForTests();

    expect(handNumber(roomCode)).toBe(hand + 1);
    expect(state(roomCode).sequence).toBe(seqAtStart);
    expect(getArmedTournamentTurn(roomCode)).toEqual(armed);
  });

  it('one human readies; only the other is readied at the deadline', async () => {
    const { roomCode } = await seedGame({ winningScore: 500 });
    await playUntilHandOver(roomCode);
    const hand = handNumber(roomCode);
    await readyForNextHand(roomCode, seatOf(U1), io, hand);
    broadcastStateUpdate(roomCode);
    expect(getArmedTournamentTurn(roomCode)).toMatchObject({ kind: 'next_hand' });

    await pastDeadline();
    await settleTournamentTurnClockForTests();

    expect(handNumber(roomCode)).toBe(hand + 1);
  });

  it('a deadline for a match that ended meanwhile does nothing', async () => {
    const { roomCode } = await seedGame({ winningScore: 500 });
    await playUntilHandOver(roomCode);
    const hand = handNumber(roomCode);
    getRoom(roomCode).abandonedAt = new Date().toISOString();

    await pastDeadline();
    await settleTournamentTurnClockForTests();

    expect(handNumber(roomCode)).toBe(hand);
    expect(getRoom(roomCode).nextHandReady.size).toBe(0);
  });

  it('non-tournament rooms are not readied automatically', async () => {
    const { roomCode } = await seedGame({ tournament: false, winningScore: 500 });
    await playUntilHandOver(roomCode);
    const hand = handNumber(roomCode);
    expect(getArmedTournamentTurn(roomCode)).toBeNull();

    await vi.advanceTimersByTimeAsync(TIMEOUT * 3);
    await settleTournamentTurnClockForTests();

    expect(handNumber(roomCode)).toBe(hand);
    expect(state(roomCode).handOver).toBe(true);
    expect(getRoom(roomCode).nextHandReady.size).toBe(0);
  });
});
