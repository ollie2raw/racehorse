import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameState } from '../game/types';
import type { Room } from '../rooms';
import {
  createInitialRoomDurabilityState,
  markRoomDurabilityPending,
  markRoomDurabilityPersistSuccess,
} from './roomDurability';
import {
  flushScheduledLiveRoomPersistence,
  getLiveRoomDurabilityState,
  isLiveRoomDurablyRecoverable,
  persistLiveRoomSessionNow,
  resetLiveRoomPersistenceForTests,
  schedulePersistLiveRoomSession,
  type LiveRosterEntry,
} from './roomLivePersistence';
import * as telemetry from './mpAuthorityTelemetry';

const t = (low: number, high: number) => ({ low: Math.min(low, high), high: Math.max(low, high) });

const persistPlan = vi.hoisted(() => ({
  outcomes: [] as Array<'ok' | 'error' | 'missing_table'>,
}));

vi.mock('../supabaseUtils', () => ({
  supabaseFetch: vi.fn(async (path: string) => {
    if (String(path).includes('mp_authority_events')) return undefined;
    const next = persistPlan.outcomes.shift() ?? 'ok';
    if (next === 'ok') {
      return undefined;
    }
    if (next === 'missing_table') {
      throw new Error('relation "room_live_sessions" does not exist');
    }
    throw new Error('db_down');
  }),
}));

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
  const roomBase = {
    code: 'DURA1',
    players: ['seat-a', 'seat-b'],
    state: mkGameState(),
    config: { winningScore: 60 },
    asyncStateVersion: 3,
    nextHandReady: new Set<string>(),
    rematchReady: new Set<string>(),
    matchStartReady: new Set<string>(),
    lastHandEndedNotifiedHand: null,
    lastHandEndedAtMs: null,
    lastBroadcastScores: {},
    ghostMoveLogs: {},
    ghostTurnIndex: 0,
    matchId: '11111111-1111-4111-8111-111111111111',
    matchLogged: false,
    leadTracker: null,
    eventLogVersion: 1 as const,
    eventSequence: 2,
    events: [],
  };

  const room = {
    ...roomBase,
    ...overrides,
  } as Room;
  room.durability =
    overrides.durability ??
    createInitialRoomDurabilityState({
      asyncStateVersion: room.asyncStateVersion,
      state: room.state,
      eventSequence: room.eventSequence,
    });
  return room;
}

const roster: LiveRosterEntry[] = [
  { seatId: 'seat-a', userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', username: 'A' },
  { seatId: 'seat-b', userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', username: 'B' },
];

describe('room durability contract', () => {
  beforeEach(() => {
    resetLiveRoomPersistenceForTests();
    persistPlan.outcomes = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('marks a successfully persisted snapshot as healthy', async () => {
    const room = mkRoom();

    await expect(persistLiveRoomSessionNow(room, roster)).resolves.toBe(true);

    expect(getLiveRoomDurabilityState(room)).toMatchObject({
      status: 'healthy',
      consecutiveFailures: 0,
      lastError: null,
    });
    expect(isLiveRoomDurablyRecoverable(room)).toBe(true);
  });

  it('marks a failed snapshot write as degraded', async () => {
    persistPlan.outcomes.push('error');
    const room = mkRoom();
    const emit = vi.spyOn(telemetry, 'emitMpAuthorityFunnel');

    await expect(persistLiveRoomSessionNow(room, roster)).resolves.toBe(false);

    expect(getLiveRoomDurabilityState(room)).toMatchObject({
      status: 'degraded',
      consecutiveFailures: 1,
      lastError: 'db_down',
    });
    expect(emit).toHaveBeenCalledWith('private_durability_degraded', expect.objectContaining({
      roomCode: room.code,
      failureCode: 'room_degraded',
    }));
    expect(isLiveRoomDurablyRecoverable(room)).toBe(false);
  });

  it('marks table-unavailable persistence as failed', async () => {
    persistPlan.outcomes.push('missing_table');
    const room = mkRoom();
    const emit = vi.spyOn(telemetry, 'emitMpAuthorityFunnel');

    await expect(persistLiveRoomSessionNow(room, roster)).resolves.toBe(false);

    expect(getLiveRoomDurabilityState(room)).toMatchObject({
      status: 'failed',
      consecutiveFailures: 1,
    });
    expect(emit).toHaveBeenCalledWith('private_durability_failed', expect.objectContaining({
      roomCode: room.code,
      failureCode: 'room_failed',
    }));
    expect(isLiveRoomDurablyRecoverable(room)).toBe(false);
  });

  it('keeps repeated failures consistent and monotonic', async () => {
    persistPlan.outcomes.push('error', 'error');
    const room = mkRoom();

    await persistLiveRoomSessionNow(room, roster);
    await persistLiveRoomSessionNow(room, roster);

    expect(getLiveRoomDurabilityState(room)).toMatchObject({
      status: 'degraded',
      consecutiveFailures: 2,
      lastError: 'db_down',
    });
  });

  it('restores healthy durability after a later successful snapshot', async () => {
    persistPlan.outcomes.push('error', 'ok');
    const room = mkRoom();

    await persistLiveRoomSessionNow(room, roster);
    await persistLiveRoomSessionNow(room, roster);

    expect(getLiveRoomDurabilityState(room)).toMatchObject({
      status: 'healthy',
      consecutiveFailures: 0,
      lastError: null,
    });
    expect(isLiveRoomDurablyRecoverable(room)).toBe(true);
  });

  it('tracks pending durability across ordinary gameplay mutations until the new snapshot persists', async () => {
    const room = mkRoom();
    await persistLiveRoomSessionNow(room, roster);
    expect(getLiveRoomDurabilityState(room).status).toBe('healthy');

    room.state = mkGameState({ sequence: 15 });
    room.eventSequence = 3;
    schedulePersistLiveRoomSession(room, roster);

    expect(getLiveRoomDurabilityState(room)).toMatchObject({
      status: 'pending',
      targetVersion: {
        asyncStateVersion: 3,
        stateSequence: 15,
        eventSequence: 3,
      },
    });
    expect(isLiveRoomDurablyRecoverable(room)).toBe(false);

    await flushScheduledLiveRoomPersistence();

    expect(getLiveRoomDurabilityState(room)).toMatchObject({
      status: 'healthy',
      persistedVersion: {
        asyncStateVersion: 3,
        stateSequence: 15,
        eventSequence: 3,
      },
    });
    expect(isLiveRoomDurablyRecoverable(room)).toBe(true);
  });

  it('ignores stale persistence completions for an older fence after a newer mutation', async () => {
    const room = mkRoom();
    await persistLiveRoomSessionNow(room, roster);
    const staleFence = room.durability.persistedFence;
    expect(staleFence).toBeTruthy();

    room.state = mkGameState({ sequence: 15 });
    room.eventSequence = 3;
    markRoomDurabilityPending(room);
    expect(room.durability.status).toBe('pending');

    const applied = markRoomDurabilityPersistSuccess(room, staleFence!);
    expect(applied).toBe(false);
    expect(getLiveRoomDurabilityState(room)).toMatchObject({
      status: 'pending',
      targetVersion: {
        asyncStateVersion: room.asyncStateVersion,
        stateSequence: 15,
        eventSequence: 3,
      },
      persistedVersion: {
        asyncStateVersion: room.asyncStateVersion,
        stateSequence: 14,
        eventSequence: 2,
      },
    });
    expect(isLiveRoomDurablyRecoverable(room)).toBe(false);
  });
});
