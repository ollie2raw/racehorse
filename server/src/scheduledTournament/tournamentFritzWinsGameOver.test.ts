/**
 * Reproduction (audit Phase 1b, item 4): a human-vs-Fritz tournament match
 * that Fritz wins, driven through the real game-over persist path
 * (createGameOverPersistScheduler → persistGameOverOnce →
 * applyTournamentGameOverFromRoom → applyMatchResult → in-memory
 * complete_tournament_match).
 *
 * The roster is built exactly as production builds it: the bot seat comes from
 * the real `seatSyntheticBotInRoom` (which records `userId: null`), and the
 * game-over input's `a` / `b` come from `getRoomRoster`, as
 * `broadcastStateUpdate` does.
 *
 * Asserts the CORRECT behavior (match completed with the bot as winner, the
 * human eliminated, the bot advanced to SF1). Expected to FAIL today.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/node', () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
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
vi.mock('../operationalTelemetry', () => ({ recordOperationalFailure: vi.fn() }));
// Nothing in this test may reach a real database.
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
}));

// Route the game-over path's tournament call through the real engine, with the
// in-memory port of the completion RPC instead of Supabase.
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
import { createReservedRoom, getRoom } from '../rooms';
import { seatSyntheticBotInRoom } from '../multiplayer/botSeating';
import { getRoomRoster, setRoomRoster } from '../multiplayer/roomSession';
import type { GameOverPersistInput } from '../multiplayer/roomSession';
import { createGameOverPersistScheduler } from '../realtime/gameOverPersistence';
import type { MatchRow, RegistrationRow } from './types';

const TOURNAMENT_ID = 'tour-fritz-win';
const HUMAN_ID = '11111111-1111-4111-8111-111111111111';
const BOT_ID = `bot:fritz:${TOURNAMENT_ID}:8`;
const ROOM_CODE = 'TFRITZWR1M1';

function match(partial: Partial<MatchRow> & Pick<MatchRow, 'id' | 'round' | 'match_number'>): MatchRow {
  return {
    tournament_id: TOURNAMENT_ID,
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

describe('tournament game over: Fritz beats a human', () => {
  it('completes the match with Fritz as winner and advances Fritz to the semifinal', async () => {
    const now = new Date().toISOString();
    store.current = {
      tournament: { id: TOURNAMENT_ID, win_target: 30, status: 'in_progress', winner_id: null, max_players: 8 },
      matches: [
        match({
          id: 'qf1',
          round: 1,
          match_number: 1,
          player1_id: HUMAN_ID,
          player2_id: BOT_ID,
          room_code: ROOM_CODE,
          status: 'in_progress',
          bot_tier: 'standard',
          ready_at: now,
          ready_deadline_at: now,
          started_at: now,
          player1_joined_at: now,
        }),
        match({ id: 'sf1', round: 2, match_number: 1 }),
        match({ id: 'sf2', round: 2, match_number: 2 }),
        match({ id: 'f1', round: 3, match_number: 1 }),
      ],
      regs: [
        {
          id: 'reg-1',
          tournament_id: TOURNAMENT_ID,
          user_id: HUMAN_ID,
          registered_at: now,
          seed: 1,
          placement: null,
          status: 'active',
        } satisfies RegistrationRow,
      ],
    };

    // Room + roster as dispatchTournamentMatch and the attach handler build them.
    const room = createReservedRoom(ROOM_CODE, { winningScore: 30 });
    room.scheduledTournamentMatchId = 'qf1';
    room.scheduledTournamentId = TOURNAMENT_ID;
    room.scheduledTournamentBotTier = 'standard';
    seatSyntheticBotInRoom(ROOM_CODE, BOT_ID, 'Fritz');
    setRoomRoster(ROOM_CODE, [
      { id: HUMAN_ID, socketId: 'sock-human', username: 'Human', userId: HUMAN_ID },
      ...getRoomRoster(ROOM_CODE),
    ]);

    // The game-over input as broadcastStateUpdate builds it from the roster.
    const roster = getRoomRoster(ROOM_CODE);
    const byId = new Map(roster.map((p) => [p.id, p]));
    const a = byId.get(HUMAN_ID)!;
    const b = byId.get(BOT_ID)!;
    const input: GameOverPersistInput = {
      room: getRoom(ROOM_CODE),
      sourceMatchId: 'source-match-1',
      cfg: {},
      aId: HUMAN_ID,
      bId: BOT_ID,
      a,
      b,
      scoreA: 12,
      scoreB: 31,
      winnerSeatId: BOT_ID,
    };

    const io = {
      emit: vi.fn(),
      to: vi.fn(() => ({ emit: vi.fn() })),
      sockets: { sockets: new Map() },
    } as unknown as Server;

    const outcome = await createGameOverPersistScheduler(io)(input)();

    const qf1 = store.current.matches.find((m) => m.id === 'qf1')!;
    const sf1 = store.current.matches.find((m) => m.id === 'sf1')!;
    const humanReg = store.current.regs[0];
    expect({
      outcome,
      qf1: { status: qf1.status, winner_id: qf1.winner_id },
      sf1Player1: sf1.player1_id,
      humanRegistration: humanReg.status,
    }).toEqual({
      outcome: 'succeeded',
      qf1: { status: 'completed', winner_id: BOT_ID },
      sf1Player1: BOT_ID,
      humanRegistration: 'eliminated',
    });
  }, 20_000);
});
