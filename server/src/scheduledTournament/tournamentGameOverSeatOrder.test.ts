/**
 * Tournament game over through the real persist path
 * (createGameOverPersistScheduler → persistGameOverOnce →
 * applyTournamentGameOverFromRoom → applyMatchResult → in-memory
 * complete_tournament_match), with the room built the way production builds
 * it: dispatch seats Fritz first (`seatSyntheticBotInRoom`, `userId: null`),
 * the human attaches later (`joinRoom`), so room seat order is join order and
 * need not match the match row's player1/player2 order.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CapturedLog } from './assertBracketConsistent.testkit';

const capturedLogs = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const writeTournamentActivity = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@sentry/node', () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock('../logger', () => ({
  childLogger: (context: string) => {
    const capture = (obj: unknown, msg?: string) => {
      capturedLogs.push({ context, msg, ...(typeof obj === 'object' && obj ? obj : {}) });
    };
    return { info: capture, debug: capture, warn: capture, error: capture };
  },
}));
vi.mock('../social/activityWriter', () => ({
  writeTournamentActivity,
  writeMatchActivity: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../stats/matchLog', () => ({ appendMatch: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../stats/recordPublicMatch', () => ({ recordPublicOnlineMatch: vi.fn() }));
vi.mock('../multiplayer/mpAuthorityTelemetry', () => ({ emitMpAuthorityFunnel: vi.fn() }));
vi.mock('../multiplayer/mpAuthorityEventStore', () => ({
  countRecentMoveLogVerificationFailuresForUser: vi.fn(async () => 0),
}));
vi.mock('../operationalTelemetry', () => ({ recordOperationalFailure: vi.fn() }));
// Nothing in this file may reach a real database.
vi.mock('../supabaseUtils', () => ({
  supabaseFetch: vi.fn(async () => {
    throw new Error('unexpected supabase call in test');
  }),
  isSupabaseTimeoutError: () => false,
}));
// The sleeps between persist retries; a failing attempt gives up immediately.
vi.mock('../multiplayer/gameOverPersistPolicy', async () => {
  const actual = await vi.importActual<typeof import('../multiplayer/gameOverPersistPolicy')>(
    '../multiplayer/gameOverPersistPolicy',
  );
  return { ...actual, GAME_OVER_PERSIST_RETRY_DELAYS_MS: [0, 0, 0, 0] };
});

type Store = {
  tournament: { id: string; win_target: number; status: string; winner_id: string | null; max_players?: number };
  matches: import('./types').MatchRow[];
  regs: import('./types').RegistrationRow[];
};
const store = vi.hoisted(() => ({ current: null as null | Store }));

// The game-over path's tournament call runs the real engine against the
// in-memory port of the match RPCs instead of Supabase.
vi.mock('./index', async () => {
  const engine = await vi.importActual<typeof import('./engine')>('./engine');
  const { inMemoryMatchRpcForArrayStore } = await vi.importActual<
    typeof import('./inMemoryMatchRpc.testkit')
  >('./inMemoryMatchRpc.testkit');
  const persistence = () => {
    const s = store.current!;
    return {
      fetchTournamentById: async (id: string) =>
        id === s.tournament.id ? { ...s.tournament, scheduled_start: new Date(0).toISOString() } : null,
      fetchMatches: async () => s.matches,
      fetchMatchById: async (id: string) => s.matches.find((m) => m.id === id) ?? null,
      updateMatch: async (id: string, patch: Partial<import('./types').MatchRow>) => {
        const row = s.matches.find((m) => m.id === id);
        if (row) Object.assign(row, patch);
      },
      ...inMemoryMatchRpcForArrayStore(s),
      updateTournamentStatus: async () => {},
      fetchRegistrations: async () => s.regs,
      fetchRegistrationsWithProfile: async () => [],
      getRoom: () => {
        throw new Error('not expected');
      },
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
import { createReservedRoom, getRoom, joinRoom } from '../rooms';
import { seatSyntheticBotInRoom } from '../multiplayer/botSeating';
import { getRoomRoster, setRoomRoster } from '../multiplayer/roomSession';
import type { GameOverPersistInput } from '../multiplayer/roomSession';
import { createGameOverPersistScheduler } from '../realtime/gameOverPersistence';
import { assertBracketConsistentForStore } from './assertBracketConsistent.testkit';
import type { MatchRow, RegistrationRow } from './types';

const T = 'tour-seat-order';
const HUMAN = '22222222-2222-4222-8222-222222222222';
const HUMAN_B = '33333333-3333-4333-8333-333333333333';
const bot = (n: number) => `bot:fritz:${T}:${n}`;
const now = new Date().toISOString();

function row(partial: Partial<MatchRow> & Pick<MatchRow, 'id' | 'round' | 'match_number'>): MatchRow {
  return {
    tournament_id: T,
    player1_id: null,
    player2_id: null,
    winner_id: null,
    room_code: '',
    status: 'waiting',
    ready_at: null,
    ready_deadline_at: null,
    started_at: null,
    completed_at: null,
    player1_joined_at: null,
    player2_joined_at: null,
    winner_source: null,
    status_reason: null,
    forfeit_user_id: null,
    no_show_user_id: null,
    bot_tier: null,
    player1_score: null,
    player2_score: null,
    ...partial,
  };
}

function live(id: string, round: 1 | 2 | 3, matchNumber: number, p1: string, p2: string): MatchRow {
  return row({
    id, round, match_number: matchNumber, player1_id: p1, player2_id: p2, status: 'in_progress',
    ready_at: now, ready_deadline_at: now, started_at: now,
  });
}

function done(id: string, round: 1 | 2 | 3, matchNumber: number, p1: string, p2: string, winner: string): MatchRow {
  return row({
    id, round, match_number: matchNumber, player1_id: p1, player2_id: p2, status: 'completed',
    winner_id: winner, winner_source: 'game_over', completed_at: now,
    player1_score: winner === p1 ? 30 : 10, player2_score: winner === p2 ? 30 : 10,
  });
}

function reg(userId: string, seed: number, status: RegistrationRow['status'] = 'active'): RegistrationRow {
  return { id: `reg-${userId}`, tournament_id: T, user_id: userId, registered_at: now, seed, placement: null, status };
}

/** A 7-row bracket whose only live match is QF1 (p1 vs p2); the rest are bot pairs still waiting. */
function quarterfinalStore(p1: string, p2: string, regs: RegistrationRow[]): Store {
  return {
    tournament: { id: T, win_target: 30, status: 'in_progress', winner_id: null, max_players: 8 },
    matches: [
      live('qf1', 1, 1, p1, p2),
      row({ id: 'qf2', round: 1, match_number: 2, player1_id: bot(4), player2_id: bot(5), bot_tier: 'standard' }),
      row({ id: 'qf3', round: 1, match_number: 3, player1_id: bot(3), player2_id: bot(6), bot_tier: 'standard' }),
      row({ id: 'qf4', round: 1, match_number: 4, player1_id: bot(2), player2_id: bot(7), bot_tier: 'standard' }),
      row({ id: 'sf1', round: 2, match_number: 1 }),
      row({ id: 'sf2', round: 2, match_number: 2 }),
      row({ id: 'f1', round: 3, match_number: 1 }),
    ],
    regs,
  };
}

let roomSeq = 0;

/**
 * Seat players as production does (Fritz at dispatch, then humans attach) and
 * return the game-over input exactly as broadcastStateUpdate builds it: seats
 * in room order, a/b from the roster.
 */
function gameOverInput(params: {
  matchId: string;
  joinOrder: string[];
  scoreBy: Record<string, number>;
  winner: string;
}): GameOverPersistInput {
  roomSeq += 1;
  const code = `T${(0xa00000 + roomSeq).toString(16).toUpperCase()}R1M1`;
  const room = createReservedRoom(code, { winningScore: 30 });
  room.scheduledTournamentMatchId = params.matchId;
  room.scheduledTournamentId = T;
  const seatOf = new Map<string, string>();
  for (const player of params.joinOrder) {
    if (player.startsWith('bot:fritz:')) {
      seatSyntheticBotInRoom(code, player, 'Fritz');
      seatOf.set(player, player);
    } else {
      const seatId = `seat-${player.slice(0, 4)}-${roomSeq}`;
      joinRoom(code, seatId);
      setRoomRoster(code, [
        ...getRoomRoster(code),
        { id: seatId, socketId: `sock-${seatId}`, username: 'Human', userId: player },
      ]);
      seatOf.set(player, seatId);
    }
  }
  const r = getRoom(code);
  const byId = new Map(getRoomRoster(code).map((p) => [p.id, p]));
  const [aId, bId] = r.players;
  const playerOfSeat = (seatId: string) => [...seatOf].find(([, s]) => s === seatId)![0];
  return {
    room: r,
    sourceMatchId: `source-${code}`,
    cfg: {},
    aId,
    bId,
    a: byId.get(aId)!,
    b: byId.get(bId)!,
    scoreA: params.scoreBy[playerOfSeat(aId)],
    scoreB: params.scoreBy[playerOfSeat(bId)],
    winnerSeatId: seatOf.get(params.winner)!,
  };
}

function makeIo() {
  const emit = vi.fn();
  const io = {
    emit,
    to: vi.fn(() => ({ emit: vi.fn() })),
    sockets: { sockets: new Map() },
  } as unknown as Server;
  return { io, emit };
}

const persist = (io: Server, input: GameOverPersistInput) => createGameOverPersistScheduler(io)(input)();
const match = (id: string) => store.current!.matches.find((m) => m.id === id)!;
const regOf = (userId: string) => store.current!.regs.find((r) => r.user_id === userId)!;

describe('tournament game over with production seat order', () => {
  beforeEach(() => {
    capturedLogs.length = 0;
    writeTournamentActivity.mockClear();
  });

  it('Fritz beats a human in a quarterfinal: bot recorded, human eliminated, bot advanced, bracket consistent', async () => {
    store.current = quarterfinalStore(HUMAN, bot(8), [reg(HUMAN, 1)]);
    const { io } = makeIo();
    const input = gameOverInput({
      matchId: 'qf1',
      joinOrder: [bot(8), HUMAN],
      scoreBy: { [HUMAN]: 14, [bot(8)]: 32 },
      winner: bot(8),
    });
    // Production seat order really is Fritz first, the reverse of the row.
    expect(input.aId).toBe(bot(8));

    expect(await persist(io, input)).toBe('succeeded');

    expect(match('qf1')).toMatchObject({
      status: 'completed',
      winner_id: bot(8),
      player1_score: 14,
      player2_score: 32,
    });
    expect(regOf(HUMAN).status).toBe('eliminated');
    expect(match('sf1').player1_id).toBe(bot(8));
    assertBracketConsistentForStore(store.current!, {
      capturedLogs: capturedLogs as CapturedLog[],
      context: 'fritz wins QF',
    });
  });

  it('human beats Fritz in a quarterfinal (regression): human recorded and advanced', async () => {
    store.current = quarterfinalStore(HUMAN, bot(8), [reg(HUMAN, 1)]);
    const { io } = makeIo();
    const input = gameOverInput({
      matchId: 'qf1',
      joinOrder: [bot(8), HUMAN],
      scoreBy: { [HUMAN]: 31, [bot(8)]: 9 },
      winner: HUMAN,
    });

    expect(await persist(io, input)).toBe('succeeded');

    expect(match('qf1')).toMatchObject({
      status: 'completed',
      winner_id: HUMAN,
      player1_score: 31,
      player2_score: 9,
    });
    expect(regOf(HUMAN).status).toBe('active');
    expect(match('sf1').player1_id).toBe(HUMAN);
    assertBracketConsistentForStore(store.current!, { capturedLogs: capturedLogs as CapturedLog[] });
  });

  describe.each([
    { layout: 'bot is player1', p1: bot(8), p2: HUMAN },
    { layout: 'bot is player2', p1: HUMAN, p2: bot(8) },
  ])('$layout', ({ p1, p2 }) => {
    it.each([
      { who: 'Fritz wins', winner: bot(8), loser: HUMAN },
      { who: 'human wins', winner: HUMAN, loser: bot(8) },
    ])('$who: the winner and both scores land on the right row slots', async ({ winner, loser }) => {
      store.current = quarterfinalStore(p1, p2, [reg(HUMAN, 1)]);
      const { io } = makeIo();
      const input = gameOverInput({
        matchId: 'qf1',
        joinOrder: [bot(8), HUMAN],
        scoreBy: { [winner]: 33, [loser]: 11 },
        winner,
      });

      expect(await persist(io, input)).toBe('succeeded');

      const qf1 = match('qf1');
      expect(qf1.status).toBe('completed');
      expect(qf1.winner_id).toBe(winner);
      expect(qf1.player1_score).toBe(p1 === winner ? 33 : 11);
      expect(qf1.player2_score).toBe(p2 === winner ? 33 : 11);
      expect(match('sf1').player1_id).toBe(winner);
      assertBracketConsistentForStore(store.current!, { capturedLogs: capturedLogs as CapturedLog[] });
    });
  });

  it('human vs human joined in the reverse of row order: scores land on the right slots', async () => {
    store.current = quarterfinalStore(HUMAN, HUMAN_B, [reg(HUMAN, 1), reg(HUMAN_B, 8)]);
    const { io } = makeIo();
    const input = gameOverInput({
      matchId: 'qf1',
      joinOrder: [HUMAN_B, HUMAN],
      scoreBy: { [HUMAN]: 30, [HUMAN_B]: 25 },
      winner: HUMAN,
    });

    expect(await persist(io, input)).toBe('succeeded');

    expect(match('qf1')).toMatchObject({ winner_id: HUMAN, player1_score: 30, player2_score: 25 });
    expect(regOf(HUMAN_B).status).toBe('eliminated');
    assertBracketConsistentForStore(store.current!, { capturedLogs: capturedLogs as CapturedLog[] });
  });

  it('Fritz beats a human in the final: tournament completes, human placed 2nd, no feed post for the bot', async () => {
    store.current = {
      tournament: { id: T, win_target: 30, status: 'in_progress', winner_id: null, max_players: 8 },
      matches: [
        done('qf1', 1, 1, HUMAN, bot(8), HUMAN),
        done('qf2', 1, 2, bot(4), bot(5), bot(4)),
        done('qf3', 1, 3, bot(3), bot(6), bot(3)),
        done('qf4', 1, 4, bot(2), bot(7), bot(2)),
        done('sf1', 2, 1, HUMAN, bot(4), HUMAN),
        done('sf2', 2, 2, bot(3), bot(2), bot(2)),
        live('f1', 3, 1, HUMAN, bot(2)),
      ],
      regs: [reg(HUMAN, 1)],
    };
    const { io, emit } = makeIo();
    const input = gameOverInput({
      matchId: 'f1',
      joinOrder: [bot(2), HUMAN],
      scoreBy: { [HUMAN]: 20, [bot(2)]: 34 },
      winner: bot(2),
    });

    expect(await persist(io, input)).toBe('succeeded');

    expect(match('f1')).toMatchObject({ status: 'completed', winner_id: bot(2), player1_score: 20, player2_score: 34 });
    expect(store.current.tournament).toMatchObject({ status: 'completed', winner_id: bot(2) });
    // The bot has no registration row; its 1st place is tournament.winner_id.
    expect(regOf(HUMAN)).toMatchObject({ status: 'eliminated', placement: 2 });
    expect(writeTournamentActivity).toHaveBeenCalledTimes(1);
    expect(writeTournamentActivity).toHaveBeenCalledWith(
      expect.objectContaining({ userId: HUMAN, placement: 'Runner-up', tournamentId: T }),
    );
    expect(emit).toHaveBeenCalledWith('tournament:completed', { tournamentId: T, winnerId: bot(2) });
    assertBracketConsistentForStore(store.current, {
      capturedLogs: capturedLogs as CapturedLog[],
      context: 'fritz wins final',
    });
  });

  it('applying the same game over twice is idempotent: one completion, one advancement', async () => {
    store.current = quarterfinalStore(HUMAN, bot(8), [reg(HUMAN, 1)]);
    const { io, emit } = makeIo();
    const input = gameOverInput({
      matchId: 'qf1',
      joinOrder: [bot(8), HUMAN],
      scoreBy: { [HUMAN]: 12, [bot(8)]: 30 },
      winner: bot(8),
    });

    expect(await persist(io, input)).toBe('succeeded');
    const afterFirst = structuredClone(store.current!.matches);
    expect(await persist(io, input)).toBe('succeeded');

    expect(store.current!.matches).toEqual(afterFirst);
    expect(match('sf1').player1_id).toBe(bot(8));
    expect(emit.mock.calls.filter(([event]) => event === 'tournament:match_updated')).toHaveLength(1);
    assertBracketConsistentForStore(store.current!, {
      capturedLogs: capturedLogs as CapturedLog[],
      expectedConflictLogs: 0,
    });
  });

  it('room seats that are not the row players fail loudly and leave the match untouched', async () => {
    store.current = quarterfinalStore(HUMAN, bot(8), [reg(HUMAN, 1)]);
    const { io } = makeIo();
    const input = gameOverInput({
      matchId: 'qf1',
      joinOrder: [bot(7), HUMAN],
      scoreBy: { [HUMAN]: 12, [bot(7)]: 30 },
      winner: bot(7),
    });

    expect(await persist(io, input)).toBe('failed');

    expect(match('qf1')).toMatchObject({ status: 'in_progress', winner_id: null });
    expect(match('sf1').player1_id).toBeNull();
    expect(capturedLogs.some((l) => l.msg === 'room seats do not match the tournament match players')).toBe(true);
  });
});
