import { describe, expect, it } from 'vitest';
import type { GameState } from '../game/types';
import type { Room } from '../rooms';
import {
  assertUnmaskedGameStateForPersistence,
  buildLiveSessionRow,
  inferLiveSessionSourceType,
} from './roomLivePersistence';

const t = (low: number, high: number) => ({ low: Math.min(low, high), high: Math.max(low, high) });

function mkGameState(overrides: Partial<GameState> = {}): GameState {
  return {
    config: {
      maxPips: 6,
      tilesPerPlayer: 7,
      deadTileCount: 2,
      scoringMultiple: 5,
      blockedHandRule: 'lowestPips',
      endHandBonus: 'sumOpponentPenalties',
      winningScore: 60,
    },
    playerIds: ['seat-a', 'seat-b'],
    players: {
      'seat-a': { id: 'seat-a', hand: [t(6, 5), t(3, 1)], score: 12 },
      'seat-b': { id: 'seat-b', hand: [t(4, 4), t(2, 0)], score: 8 },
    },
    board: null,
    boneyard: [t(6, 6), t(5, 4), t(1, 0)],
    deadTiles: [t(0, 0), t(1, 1)],
    currentPlayerIndex: 0,
    handNumber: 2,
    handOpen: true,
    handOver: false,
    gameOver: false,
    winnerId: null,
    consecutivePasses: 0,
    sequence: 14,
    ...overrides,
  };
}

function mkRoom(overrides: Partial<Room> = {}): Room {
  return {
    code: 'ABCD12',
    players: ['seat-a', 'seat-b'],
    state: mkGameState(),
    config: { winningScore: 60 },
    asyncStateVersion: 3,
    nextHandReady: new Set(),
    rematchReady: new Set(),
    matchStartReady: new Set(['seat-a']),
    lastHandEndedNotifiedHand: null,
    lastHandEndedAtMs: null,
    lastBroadcastScores: { 'seat-a': 12, 'seat-b': 8 },
    ghostMoveLogs: {},
    ghostTurnIndex: 0,
    matchId: '11111111-1111-4111-8111-111111111111',
    matchLogged: false,
    leadTracker: null,
    eventLogVersion: 1,
    eventSequence: 2,
    events: [],
    matchmakingMatchId: '22222222-2222-4222-8222-222222222222',
    ...overrides,
  };
}

describe('roomLivePersistence', () => {
  it('persists full unmasked boneyard order in game_state', () => {
    const room = mkRoom();
    const row = buildLiveSessionRow(room, [
      { seatId: 'seat-a', userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', username: 'A' },
      { seatId: 'seat-b', userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', username: 'B' },
    ]);

    expect(row.game_state?.boneyard).toEqual([
      { low: 6, high: 6 },
      { low: 4, high: 5 },
      { low: 0, high: 1 },
    ]);
    expect(row.game_state?.deadTiles).toEqual([
      { low: 0, high: 0 },
      { low: 1, high: 1 },
    ]);
    expect(row.game_state?.players['seat-b']?.hand).toEqual([
      { low: 4, high: 4 },
      { low: 0, high: 2 },
    ]);
    expect(row.game_state_sequence).toBe(14);
  });

  it('rejects masked opponent hands before persist', () => {
    const masked = mkGameState({
      players: {
        'seat-a': { id: 'seat-a', hand: [t(6, 5)], score: 12 },
        'seat-b': { id: 'seat-b', hand: [], score: 8 },
      },
    });
    expect(() => assertUnmaskedGameStateForPersistence(masked)).not.toThrow();

    const state = mkGameState();
    delete (state.players['seat-b'] as { hand?: unknown }).hand;
    expect(() => assertUnmaskedGameStateForPersistence(state)).toThrow(/hand must be an array/);
  });

  it('buildLiveSessionRow payload is JSON-serializable for lobby rooms', () => {
    const room = mkRoom({
      state: null,
      matchmakingMatchId: undefined,
      scheduledTournamentMatchId: undefined,
    });
    const row = buildLiveSessionRow(room, [
      { seatId: 'seat-a', userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', username: 'Host' },
      { seatId: 'seat-b', userId: null, username: 'Guest' },
    ]);
    expect(() => JSON.stringify(row)).not.toThrow();
  });

  it('infers source_type for all three room kinds', () => {
    expect(inferLiveSessionSourceType(mkRoom())).toBe('matchmaking');
    expect(
      inferLiveSessionSourceType(
        mkRoom({
          matchmakingMatchId: undefined,
          scheduledTournamentMatchId: '33333333-3333-4333-8333-333333333333',
          scheduledTournamentId: '44444444-4444-4444-8444-444444444444',
        }),
      ),
    ).toBe('tournament');
    expect(
      inferLiveSessionSourceType(
        mkRoom({ matchmakingMatchId: undefined, scheduledTournamentMatchId: undefined }),
      ),
    ).toBe('private');
  });
});
