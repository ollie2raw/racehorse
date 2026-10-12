/**
 * Per-match isolation in boot recovery and the no-show reconciler, retry of a
 * failed restore, and duplicate seat identity at game over.
 *
 * Faked: `supabaseFetch` as an in-memory `room_live_sessions` table that can
 * be made unreachable for chosen room codes, the tournament rows (passed in as
 * an EnginePersistence; completion through the in-memory port of
 * `complete_tournament_match`), and Sentry. Rooms, live-session persistence,
 * restore-or-create, dispatch, recovery and the reconciler are real.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => { vi.stubEnv('TOURNAMENTS_ENABLED', 'true'); });
afterAll(() => { vi.unstubAllEnvs(); });

type Row = Record<string, any>;
const db = vi.hoisted(() => ({
  liveSessions: new Map<string, Record<string, unknown>>(),
  downCodes: new Set<string>(),
  matches: new Map<string, Record<string, any>>(),
  tournaments: new Map<string, Record<string, any>>(),
  regs: [] as Array<Record<string, any>>,
}));
const sentryCaptureMessage = vi.hoisted(() => vi.fn());

vi.mock('@sentry/node', () => ({ captureMessage: sentryCaptureMessage, captureException: vi.fn() }));
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
      if (db.downCodes.has(code)) throw new Error('fetch failed: connect ECONNREFUSED');
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

import {
  createReservedRoom,
  getRoom,
  joinRoom,
  peekRoom,
  resetLiveRoomPersistHookForTests,
  resetRoomRuntimeForTests,
  startGameUnlocked,
} from '../rooms';
import {
  getRoomRoster,
  initRoomSession,
  resetRoomSessionStoresForTests,
  setRoomRoster,
} from '../multiplayer/roomSession';
import {
  persistLiveRoomSessionNow,
  resetLiveRoomPersistenceForTests,
} from '../multiplayer/roomLivePersistence';
import { inMemoryMatchRpcForArrayStore } from './inMemoryMatchRpc.testkit';
import type { EnginePersistence } from './persistenceInterface';
import { recoverTournamentMatches } from './recovery';
import { applyTournamentGameOverFromRoom, reconcileExpiredReadyMatches } from './engine';
import { dispatchTournamentMatch } from './matchDispatch';
import { restoreOrCreateTournamentRoom } from './tournamentRoomRestore';

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
const completeTournamentMatch = vi.fn((params: Parameters<EnginePersistence['completeTournamentMatch']>[0]) =>
  rpc().completeTournamentMatch(params));

/**
 * Tournament rows from the fake stores; rooms and restore-or-create are the
 * real production ones (`defaultEnginePersistence` wires the same three).
 */
const persistence = {
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
  completeTournamentMatch,
  promoteTournamentMatch: (...args: Parameters<EnginePersistence['promoteTournamentMatch']>) =>
    rpc().promoteTournamentMatch(...args),
  generateTournamentBracket: async () => { throw new Error('not expected'); },
  updateRegistrationPlacement: async () => {},
  updateTournamentStatus: async () => {},
  createReservedRoom,
  getRoom,
  restoreOrCreateRoom: restoreOrCreateTournamentRoom,
} as unknown as EnginePersistence;

const T = '6c000000-0000-4000-8000-000000000001';
const U1 = '6c000000-0000-4000-8000-0000000000a1';
const U2 = '6c000000-0000-4000-8000-0000000000a2';
const U3 = '6c000000-0000-4000-8000-0000000000a3';
const U4 = '6c000000-0000-4000-8000-0000000000a4';

function makeIo() {
  return {
    sockets: { sockets: new Map(), adapter: { rooms: new Map() } },
    to: () => ({ emit: vi.fn() }),
    emit: vi.fn(),
  } as any;
}

function initSession() {
  initRoomSession(makeIo(), {
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
  resetLiveRoomPersistenceForTests();
  resetLiveRoomPersistHookForTests();
  resetRoomRuntimeForTests();
  resetRoomSessionStoresForTests();
  initSession();
}

function matchRow(id: string, matchNumber: number, roomCode: string, p1: string, p2: string, partial: Row = {}): Row {
  return {
    id, tournament_id: T, round: 1, match_number: matchNumber, player1_id: p1, player2_id: p2,
    winner_id: null, room_code: roomCode, status: 'in_progress', ready_at: null, ready_deadline_at: null,
    started_at: null, completed_at: null, player1_joined_at: null, player2_joined_at: null,
    winner_source: null, status_reason: null, forfeit_user_id: null, no_show_user_id: null,
    bot_tier: null, player1_score: null, player2_score: null, ...partial,
  };
}

function seedTournament() {
  const nowMs = Date.now();
  db.tournaments.set(T, {
    id: T,
    scheduled_start: new Date(nowMs - 10 * 60_000).toISOString(),
    registration_open_at: new Date(nowMs - 40 * 60_000).toISOString(),
    registration_close_at: new Date(nowMs - 12 * 60_000).toISOString(),
    status: 'in_progress', format: '7-tile', win_target: 30, max_players: 8, winner_id: null,
    created_at: new Date(nowMs - 86_400_000).toISOString(),
  });
  db.matches.set('sf1', matchRow('sf1', 1, '', null as any, null as any, { round: 2, status: 'waiting' }));
  db.regs = [U1, U2, U3, U4].map((u, i) => ({
    id: `r${i}`, tournament_id: T, user_id: u, registered_at: new Date().toISOString(), seed: i + 1, placement: null, status: 'active',
  }));
}

/** A match whose game (20-10, hand 3) is stored in its live session; the room is then lost to a "restart". */
async function seedPlayedMatch(id: string, matchNumber: number, p1: string, p2: string): Promise<{ roomCode: string }> {
  const roomCode = `T6C000${matchNumber}R1M${matchNumber}`;
  const startedAt = new Date(Date.now() - 8 * 60_000).toISOString();
  db.matches.set(id, matchRow(id, matchNumber, roomCode, p1, p2, {
    ready_at: startedAt, started_at: startedAt, player1_joined_at: startedAt, player2_joined_at: startedAt,
  }));
  const room = createReservedRoom(roomCode, { winningScore: 30 });
  room.scheduledTournamentMatchId = id;
  room.scheduledTournamentId = T;
  joinRoom(roomCode, `seat-${p1.slice(-2)}`);
  joinRoom(roomCode, `seat-${p2.slice(-2)}`);
  setRoomRoster(roomCode, [p1, p2].map((u) => ({ id: `seat-${u.slice(-2)}`, socketId: '', username: u.slice(-2), userId: u })));
  await startGameUnlocked(roomCode, makeIo());
  const live = getRoom(roomCode);
  live.state = { ...live.state!, handNumber: 3 };
  expect(await persistLiveRoomSessionNow(
    live,
    getRoomRoster(roomCode).map((p) => ({ seatId: p.id, userId: p.userId, username: p.username })),
  )).toBe(true);
  return { roomCode };
}

const stepAlerts = (step: string) =>
  sentryCaptureMessage.mock.calls.filter(([, ctx]) => ctx?.tags?.tournament_alert === `${step}_failed`);

describe('per-match isolation and retry', () => {
  beforeEach(() => {
    db.liveSessions.clear();
    db.downCodes.clear();
    db.matches.clear();
    db.tournaments.clear();
    db.regs = [];
    sentryCaptureMessage.mockClear();
    completeTournamentMatch.mockClear();
    restart();
    seedTournament();
  });
  afterEach(() => {
    restart();
  });

  it('boot recovery: one match failing to restore does not stop the others, and is reported to Sentry', async () => {
    const a = await seedPlayedMatch('qf1', 1, U1, U2);
    const b = await seedPlayedMatch('qf2', 2, U3, U4);
    restart();
    db.downCodes.add(a.roomCode);

    const result = await recoverTournamentMatches(makeIo(), persistence);

    expect(peekRoom(a.roomCode)).toBeUndefined();
    expect(peekRoom(b.roomCode)?.state?.handNumber).toBe(3);
    expect(result.inProgressRecovered).toBe(1);
    const alerts = stepAlerts('recovery');
    expect(alerts).toHaveLength(1);
    expect(alerts[0][1]).toMatchObject({
      level: 'error',
      tags: { match_id: 'qf1', tournament_id: T, error_code: 'room_persistence_unavailable' },
      extra: { matchId: 'qf1', roomCode: a.roomCode, error: 'room_persistence_unavailable' },
    });
  });

  it('a failed restore can be retried once the cause is fixed (single-flight entry is cleared)', async () => {
    const a = await seedPlayedMatch('qf1', 1, U1, U2);
    restart();
    db.downCodes.add(a.roomCode);

    await expect(restoreOrCreateTournamentRoom(a.roomCode, 'qf1', { winningScore: 30 }))
      .rejects.toThrow('room_persistence_unavailable');
    await expect(dispatchTournamentMatch(makeIo(), 'qf1', { reason: 'recovery' }, persistence))
      .rejects.toThrow('room_persistence_unavailable');
    expect(peekRoom(a.roomCode)).toBeUndefined();

    db.downCodes.delete(a.roomCode);
    await dispatchTournamentMatch(makeIo(), 'qf1', { reason: 'recovery' }, persistence);

    expect(peekRoom(a.roomCode)?.state?.handNumber).toBe(3);
  });

  it('no-show reconciler: one match throwing does not skip the rest of the tick, and is reported to Sentry', async () => {
    const expired = new Date(Date.now() - 60_000).toISOString();
    const joinedAt = new Date(Date.now() - 5 * 60_000).toISOString();
    // First: room lost and its restore fails.
    db.matches.set('qf1', matchRow('qf1', 1, 'T6C0001R1M1', U1, U2, {
      status: 'ready', ready_at: joinedAt, ready_deadline_at: expired,
      player1_joined_at: joinedAt, player2_joined_at: joinedAt,
    }));
    db.downCodes.add('T6C0001R1M1');
    // Second: only player1 showed up; its room is in memory → resolved as a no-show.
    db.matches.set('qf2', matchRow('qf2', 2, 'T6C0002R1M2', U3, U4, {
      status: 'ready', ready_at: joinedAt, ready_deadline_at: expired, player1_joined_at: joinedAt,
    }));
    createReservedRoom('T6C0002R1M2', { winningScore: 30 });

    const resolved = await reconcileExpiredReadyMatches(makeIo(), new Date(), persistence, [structuredClone(db.tournaments.get(T)!) as any]);

    expect(resolved).toBe(1);
    expect(db.matches.get('qf2')).toMatchObject({ status: 'completed', winner_id: U3, no_show_user_id: U4 });
    expect(db.matches.get('qf1')).toMatchObject({ status: 'ready', winner_id: null });
    const alerts = stepAlerts('reconcile');
    expect(alerts).toHaveLength(1);
    expect(alerts[0][1]).toMatchObject({
      tags: { match_id: 'qf1', error_code: 'room_persistence_unavailable' },
      extra: { roomCode: 'T6C0001R1M1' },
    });
  });
});

describe('game over with duplicate seat identity', () => {
  beforeEach(() => {
    db.matches.clear();
    db.tournaments.clear();
    db.regs = [];
    completeTournamentMatch.mockClear();
    seedTournament();
  });

  it('both seats resolve to the same user: tournament_seat_mismatch, nothing recorded', async () => {
    db.matches.set('qf1', matchRow('qf1', 1, 'T6C0001R1M1', U1, U2, { started_at: new Date().toISOString() }));

    await expect(applyTournamentGameOverFromRoom(makeIo(), { code: 'T6C0001R1M1', scheduledTournamentMatchId: 'qf1' }, {
      winnerUserId: U1,
      player1Score: 31,
      player2Score: 12,
      seatScores: [{ playerId: U1, score: 31 }, { playerId: U1, score: 12 }],
    }, persistence)).rejects.toThrow('tournament_seat_mismatch');

    expect(completeTournamentMatch).not.toHaveBeenCalled();
    expect(db.matches.get('qf1')).toMatchObject({ status: 'in_progress', winner_id: null, player1_score: null });
    expect(db.matches.get('sf1')?.player1_id).toBeNull();
  });

  it('a row naming the same user twice cannot be oriented either: tournament_seat_mismatch, nothing recorded', async () => {
    db.matches.set('qf1', matchRow('qf1', 1, 'T6C0001R1M1', U1, U1, { started_at: new Date().toISOString() }));

    await expect(applyTournamentGameOverFromRoom(makeIo(), { code: 'T6C0001R1M1', scheduledTournamentMatchId: 'qf1' }, {
      winnerUserId: U1,
      player1Score: 31,
      player2Score: 12,
      seatScores: [{ playerId: U1, score: 31 }, { playerId: U1, score: 12 }],
    }, persistence)).rejects.toThrow('tournament_seat_mismatch');

    expect(completeTournamentMatch).not.toHaveBeenCalled();
    expect(db.matches.get('qf1')).toMatchObject({ status: 'in_progress', winner_id: null });
  });
});
