/**
 * Phase 2C.1: a game that ends after its tournament was cancelled (or under a
 * tournament that is already completed) is refused by complete_tournament_match
 * (2026-10-09_tournament_completion_guard.sql). Driven through the real
 * game-over persist path (createGameOverPersistScheduler → persistGameOverOnce
 * → applyTournamentGameOverFromRoom → applyMatchResult) onto the in-memory
 * port of the RPC, which mirrors the guard.
 *
 * The refusal is terminal: one RPC call (no retry loop), one alert, nothing
 * written, the tournament not revived, and the room's game-over persist
 * settled so the room can be cleaned up normally.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sentry = vi.hoisted(() => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock('@sentry/node', () => sentry);
vi.mock('../social/activityWriter', () => ({
  writeTournamentActivity: vi.fn().mockResolvedValue(undefined),
  writeMatchActivity: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../stats/matchLog', () => ({ appendMatch: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../stats/recordPublicMatch', () => ({ recordPublicOnlineMatch: vi.fn() }));
vi.mock('../multiplayer/mpAuthorityTelemetry', () => ({ emitMpAuthorityFunnel: vi.fn() }));
vi.mock('../multiplayer/mpAuthorityEventStore', () => ({
  countRecentMoveLogVerificationFailuresForUser: vi.fn(async () => 0),
}));
const ops = vi.hoisted(() => ({ recordOperationalFailure: vi.fn() }));
vi.mock('../operationalTelemetry', () => ops);
vi.mock('../supabaseUtils', () => ({
  supabaseFetch: vi.fn(async () => {
    throw new Error('unexpected supabase call in test');
  }),
  isSupabaseTimeoutError: () => false,
}));

const store = vi.hoisted(() => ({
  current: null as null | {
    tournament: { id: string; win_target: number; status: string; winner_id: string | null; max_players?: number };
    matches: import('./types').MatchRow[];
    regs: import('./types').RegistrationRow[];
  },
  completeCalls: 0,
}));

vi.mock('./index', async () => {
  const engine = await vi.importActual<typeof import('./engine')>('./engine');
  const { inMemoryMatchRpcForArrayStore } = await vi.importActual<
    typeof import('./inMemoryMatchRpc.testkit')
  >('./inMemoryMatchRpc.testkit');
  const persistence = () => {
    const s = store.current!;
    const rpc = inMemoryMatchRpcForArrayStore(s);
    return {
      fetchTournamentById: async (id: string) =>
        id === s.tournament.id ? { ...s.tournament, scheduled_start: new Date(0).toISOString() } : null,
      fetchMatches: async () => s.matches,
      fetchMatchById: async (id: string) => s.matches.find((m) => m.id === id) ?? null,
      updateMatch: async () => { throw new Error('no direct match writes expected'); },
      ...rpc,
      completeTournamentMatch: async (params: Parameters<typeof rpc.completeTournamentMatch>[0]) => {
        store.completeCalls += 1;
        return rpc.completeTournamentMatch(params);
      },
      fetchRegistrations: async () => s.regs,
      fetchRegistrationsWithProfile: async () => [],
    } as unknown as import('./persistenceInterface').EnginePersistence;
  };
  return {
    applyTournamentGameOverFromRoom: (
      io: Parameters<typeof engine.applyTournamentGameOverFromRoom>[0],
      room: Parameters<typeof engine.applyTournamentGameOverFromRoom>[1],
      params: Parameters<typeof engine.applyTournamentGameOverFromRoom>[2],
    ) => engine.applyTournamentGameOverFromRoom(io, room, params, persistence(), async () => null),
    findTournamentMatchByRoom: async () => null,
  };
});

import type { Server } from 'socket.io';
import { createReservedRoom, getRoom } from '../rooms';
import { getRoomRoster, setRoomRoster } from '../multiplayer/roomSession';
import type { GameOverPersistInput } from '../multiplayer/roomSession';
import { createGameOverPersistScheduler } from '../realtime/gameOverPersistence';
import { resetAlertThrottleForTests } from './tournamentAlerts';
import type { MatchRow, RegistrationRow } from './types';

const TOURNAMENT_ID = 'tour-late-result';
const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
let roomSeq = 0;

function match(partial: Partial<MatchRow> & Pick<MatchRow, 'id' | 'round' | 'match_number'>): MatchRow {
  return {
    tournament_id: TOURNAMENT_ID, player1_id: null, player2_id: null, winner_id: null, room_code: '',
    status: 'waiting', ready_at: null, ready_deadline_at: null, started_at: null, completed_at: null,
    player1_joined_at: null, player2_joined_at: null, winner_source: null, status_reason: null,
    forfeit_user_id: null, no_show_user_id: null, bot_tier: null, player1_score: null, player2_score: null,
    ...partial,
  };
}

function reg(userId: string, seed: number): RegistrationRow {
  return { id: `reg-${seed}`, tournament_id: TOURNAMENT_ID, user_id: userId, registered_at: new Date(0).toISOString(), seed, placement: null, status: 'active' };
}

/** A bracket whose QF1 game is live in a room; the tournament has the given status. */
function setup(tournamentStatus: string, roundOfLiveMatch: 1 | 3 = 1) {
  const now = new Date().toISOString();
  roomSeq += 1;
  const roomCode = `TLATE${roomSeq}R1M1`;
  const live = roundOfLiveMatch === 1 ? 'qf1' : 'f1';
  store.completeCalls = 0;
  store.current = {
    tournament: { id: TOURNAMENT_ID, win_target: 30, status: tournamentStatus, winner_id: null, max_players: 8 },
    matches: [
      match({ id: 'qf1', round: 1, match_number: 1, ...(live === 'qf1' ? { player1_id: P1, player2_id: P2, room_code: roomCode, status: 'in_progress', started_at: now, player1_joined_at: now, player2_joined_at: now } : {}) }),
      match({ id: 'sf1', round: 2, match_number: 1 }),
      match({ id: 'sf2', round: 2, match_number: 2 }),
      match({ id: 'f1', round: 3, match_number: 1, ...(live === 'f1' ? { player1_id: P1, player2_id: P2, room_code: roomCode, status: 'in_progress', started_at: now, player1_joined_at: now, player2_joined_at: now } : {}) }),
    ],
    regs: [reg(P1, 1), reg(P2, 2)],
  };
  const room = createReservedRoom(roomCode, { winningScore: 30 });
  room.scheduledTournamentMatchId = live;
  room.scheduledTournamentId = TOURNAMENT_ID;
  setRoomRoster(roomCode, [
    { id: P1, socketId: 's1', username: 'One', userId: P1 },
    { id: P2, socketId: 's2', username: 'Two', userId: P2 },
  ]);
  const roster = getRoomRoster(roomCode);
  const input: GameOverPersistInput = {
    room: getRoom(roomCode),
    sourceMatchId: `source-${roomSeq}`,
    cfg: {},
    aId: P1,
    bId: P2,
    a: roster.find((p) => p.id === P1)!,
    b: roster.find((p) => p.id === P2)!,
    scoreA: 31,
    scoreB: 12,
    winnerSeatId: P1,
  };
  const roomEmits: Array<{ event: string }> = [];
  const io = {
    emit: vi.fn(),
    to: vi.fn(() => ({ emit: (event: string) => { roomEmits.push({ event }); } })),
    sockets: { sockets: new Map() },
  } as unknown as Server;
  return { input, io, roomEmits, before: structuredClone({ t: store.current.tournament, m: store.current.matches, r: store.current.regs }) };
}

const alerts = (tag: string) =>
  sentry.captureMessage.mock.calls.filter(([, ctx]) => (ctx as { tags?: { tournament_alert?: string } })?.tags?.tournament_alert === tag);

beforeEach(() => {
  vi.clearAllMocks();
  resetAlertThrottleForTests();
});

describe('a game that ends after its tournament was cancelled', () => {
  it('is refused once, never retried, alerted once as a warning, and changes nothing', async () => {
    const { input, io, roomEmits, before } = setup('cancelled');

    const outcome = await createGameOverPersistScheduler(io)(input)();

    expect(store.completeCalls).toBe(1);
    expect({ t: store.current!.tournament, m: store.current!.matches, r: store.current!.regs }).toEqual(before);
    expect(store.current!.tournament.status).toBe('cancelled');
    const warned = alerts('result_after_cancellation');
    expect(warned).toHaveLength(1);
    expect(warned[0][1]).toMatchObject({ level: 'warning' });
    // Settled, not failed: no give-up alert, no "result could not be saved" to the players.
    expect(outcome).toBe('succeeded');
    expect(ops.recordOperationalFailure).not.toHaveBeenCalled();
    expect(roomEmits.map((e) => e.event)).not.toContain('match:result_persist_failed');
    expect(input.room.gameOverPersistStatus).not.toBe('pending');
  });

  it('a second delivery of the same game (recovery, restart) does not alert again', async () => {
    const first = setup('cancelled');
    await createGameOverPersistScheduler(first.io)(first.input)();
    await createGameOverPersistScheduler(first.io)({ ...first.input, sourceMatchId: 'redelivered' })();
    expect(store.completeCalls).toBe(2);
    expect(alerts('result_after_cancellation')).toHaveLength(1);
    expect({ t: store.current!.tournament, m: store.current!.matches, r: store.current!.regs }).toEqual(first.before);
  });

  it('a late final records no champion and no placements', async () => {
    const { input, io, before } = setup('cancelled', 3);
    expect(await createGameOverPersistScheduler(io)(input)()).toBe('succeeded');
    expect(store.completeCalls).toBe(1);
    expect({ t: store.current!.tournament, m: store.current!.matches, r: store.current!.regs }).toEqual(before);
    expect(store.current!.tournament.winner_id).toBeNull();
  });
});

describe('a game that ends under an already-completed tournament (corrupt state)', () => {
  it('is refused once as an invariant violation; history is not mutated', async () => {
    const { input, io, before } = setup('completed');
    const outcome = await createGameOverPersistScheduler(io)(input)();
    expect(outcome).toBe('succeeded');
    expect(store.completeCalls).toBe(1);
    expect({ t: store.current!.tournament, m: store.current!.matches, r: store.current!.regs }).toEqual(before);
    const violations = sentry.captureMessage.mock.calls.filter(([msg]) => String(msg).includes('tournament_not_in_progress'));
    expect(violations).toHaveLength(1);
    expect(violations[0][1]).toMatchObject({ level: 'error' });
    expect(alerts('result_after_cancellation')).toHaveLength(0);
  });
});

describe('control', () => {
  it('the same game under an in_progress tournament completes and advances', async () => {
    const { input, io } = setup('in_progress');
    expect(await createGameOverPersistScheduler(io)(input)()).toBe('succeeded');
    const qf1 = store.current!.matches.find((m) => m.id === 'qf1')!;
    expect([qf1.status, qf1.winner_id, store.current!.matches.find((m) => m.id === 'sf1')!.player1_id]).toEqual(['completed', P1, P1]);
    expect(store.current!.regs.find((r) => r.user_id === P2)!.status).toBe('eliminated');
  });
});
