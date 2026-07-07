import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameState } from '../game/types';
import type { Room } from '../rooms';
import { supabaseFetch } from '../supabaseUtils';
import {
  flushAllPendingLiveSessions,
  flushScheduledLiveRoomPersistence,
  persistLiveRoomSessionNow,
  resetLiveRoomPersistenceForTests,
  schedulePersistLiveRoomSession,
} from './roomLivePersistence';

const t = (low: number, high: number) => ({ low: Math.min(low, high), high: Math.max(low, high) });

const persistenceStore = vi.hoisted(() => ({
  liveSessions: new Map<string, Record<string, unknown>>(),
  persistCalls: 0,
}));

vi.mock('../supabaseUtils', () => ({
  supabaseFetch: vi.fn(async (path: string, init?: RequestInit) => {
    if (path.includes('/room_live_sessions') && init?.method === 'POST') {
      persistenceStore.persistCalls += 1;
      const rows = JSON.parse(String(init.body)) as Array<Record<string, unknown>>;
      for (const row of rows) {
        persistenceStore.liveSessions.set(String(row.room_code), row);
      }
      return undefined;
    }
    throw new Error(`unexpected supabaseFetch call: ${init?.method ?? 'GET'} ${path}`);
  }),
}));

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

function mkRoom(overrides: Partial<Room> = {}): Room {
  return {
    code: 'FLUSH1',
    players: ['seat-a', 'seat-b'],
    state: mkGameState(),
    config: { winningScore: 60 },
    asyncStateVersion: 3,
    nextHandReady: new Set(),
    rematchReady: new Set(),
    matchStartReady: new Set(),
    lastHandEndedNotifiedHand: null,
    lastHandEndedAtMs: null,
    lastBroadcastScores: {},
    ghostMoveLogs: {},
    ghostTurnIndex: 0,
    matchId: '11111111-1111-4111-8111-111111111111',
    matchLogged: false,
    leadTracker: null,
    eventLogVersion: 1,
    eventSequence: 0,
    events: [],
    ...overrides,
  };
}

const roster = [
  { seatId: 'seat-a', userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', username: 'A' },
  { seatId: 'seat-b', userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', username: 'B' },
];

describe('roomLivePersistence flush', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetLiveRoomPersistenceForTests();
    persistenceStore.liveSessions.clear();
    persistenceStore.persistCalls = 0;
    vi.mocked(supabaseFetch).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('flushScheduledLiveRoomPersistence completes a queued debounce write', async () => {
    const room = mkRoom();
    schedulePersistLiveRoomSession(room, roster);
    expect(persistenceStore.persistCalls).toBe(0);

    const flushPromise = flushScheduledLiveRoomPersistence();
    await flushPromise;

    expect(persistenceStore.persistCalls).toBe(1);
    expect(persistenceStore.liveSessions.get('FLUSH1')?.game_state_sequence).toBe(14);
  });

  it('flushAllPendingLiveSessions flushes dirty pending rooms', async () => {
    const room = mkRoom({ code: 'DIRTY1' });
    schedulePersistLiveRoomSession(room, roster);

    const result = await flushAllPendingLiveSessions({ timeoutMs: 1_000 });

    expect(result.timedOut).toBe(false);
    expect(result.flushedRoomCodes).toEqual(['DIRTY1']);
    expect(persistenceStore.persistCalls).toBe(1);
    expect(persistenceStore.liveSessions.get('DIRTY1')).toBeTruthy();
  });

  it('flushAllPendingLiveSessions continues after persistence timeout', async () => {
    let releasePersist!: () => void;
    const persistGate = new Promise<void>((resolve) => {
      releasePersist = resolve;
    });

    vi.mocked(supabaseFetch).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.includes('/room_live_sessions') && init?.method === 'POST') {
        persistenceStore.persistCalls += 1;
        await persistGate;
        return undefined;
      }
      throw new Error(`unexpected supabaseFetch call: ${init?.method ?? 'GET'} ${path}`);
    });

    const room = mkRoom({ code: 'HANG1' });
    schedulePersistLiveRoomSession(room, roster);

    const flushPromise = flushAllPendingLiveSessions({ timeoutMs: 50 });
    await vi.advanceTimersByTimeAsync(50);
    const result = await flushPromise;

    expect(result.timedOut).toBe(true);
    expect(result.flushedRoomCodes).toEqual([]);
    releasePersist();
  });

  it('coalesces duplicate in-flight writes for the same room', async () => {
    const room = mkRoom({ code: 'DEDUP1' });
    await Promise.all([
      persistLiveRoomSessionNow(room, roster),
      persistLiveRoomSessionNow(room, roster),
    ]);

    expect(persistenceStore.persistCalls).toBe(1);
  });
});