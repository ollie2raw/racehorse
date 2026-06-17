import { randomUUID } from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameState } from '../game/types';
import {
  createReservedRoom,
  peekRoom,
  resetLiveRoomPersistHookForTests,
  resetRoomRuntimeForTests,
} from '../rooms';
import { applyLiveSessionRow } from './applyLiveSessionRoom';
import * as livePersistence from './roomLivePersistence';
import {
  buildLiveSessionRow,
  resetLiveRoomPersistenceForTests,
  type LiveRosterEntry,
} from './roomLivePersistence';
import { getRoomRoster, resetRoomSessionStoresForTests, setRoomRoster } from './roomSession';

const t = (low: number, high: number) => ({ low: Math.min(low, high), high: Math.max(low, high) });

function mkGameState(): GameState {
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
  };
}

const roster: LiveRosterEntry[] = [
  { seatId: 'seat-a', userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', username: 'Alice' },
  { seatId: 'seat-b', userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', username: 'Bob' },
];

describe('room live session restart hydration', () => {
  beforeEach(() => {
    resetRoomRuntimeForTests();
    resetRoomSessionStoresForTests();
    resetLiveRoomPersistenceForTests();
    resetLiveRoomPersistHookForTests();
    vi.restoreAllMocks();
  });

  it('restores boneyard order and roster after simulated process restart', async () => {
    const room = createReservedRoom('RST001', { winningScore: 60 });
    room.matchId = randomUUID();
    room.players = ['seat-a', 'seat-b'];
    room.state = mkGameState();
    setRoomRoster('RST001', [
      { id: 'seat-a', socketId: 'sock-a', username: 'Alice', userId: roster[0]!.userId },
      { id: 'seat-b', socketId: 'sock-b', username: 'Bob', userId: roster[1]!.userId },
    ]);

    const row = buildLiveSessionRow(room, roster);
    expect(row.game_state?.boneyard).toEqual([
      { low: 6, high: 6 },
      { low: 4, high: 5 },
      { low: 0, high: 1 },
    ]);

    resetRoomRuntimeForTests();
    resetRoomSessionStoresForTests();
    expect(peekRoom('RST001')).toBeUndefined();

    const applied = applyLiveSessionRow(row);
    expect(applied).not.toBeNull();
    expect(applied!.room.state?.boneyard).toEqual(row.game_state?.boneyard);
    expect(applied!.room.state?.sequence).toBe(14);
    expect(applied!.restoredRoster).toEqual(roster);

    setRoomRoster(
      'RST001',
      applied!.restoredRoster.map((entry) => ({
        id: entry.seatId,
        socketId: '',
        username: entry.username,
        userId: entry.userId,
      })),
    );

    const restoredRoster = getRoomRoster('RST001');
    expect(restoredRoster).toHaveLength(2);
    expect(restoredRoster[0]).toMatchObject({
      id: 'seat-a',
      username: 'Alice',
      userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });
    expect(restoredRoster[1]).toMatchObject({
      id: 'seat-b',
      username: 'Bob',
      userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    });
  });

  it('ensureRoomHydrated returns memory hit without loading persistence', async () => {
    const room = createReservedRoom('RST003', { winningScore: 60 });
    room.players = ['seat-a'];
    room.state = mkGameState();

    const hydrated = await livePersistence.ensureRoomHydrated('RST003');
    expect(hydrated?.source).toBe('memory');
    expect(hydrated?.room).toBe(room);
    expect(hydrated?.restoredRoster).toEqual([]);
  });
});
