/**
 * M6 — the abort used when a matchmaking match must not be dealt, and its
 * composition with the M1/M2 abort path and the M3 start lock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'socket.io';
import * as rooms from '../rooms';
import { initRoomSession, resetRoomSessionStoresForTests } from '../multiplayer/roomSession';
import {
  abortMatchmakingMatchAndRequeue,
  ensureMatchmakingServiceForTests,
  getMatchmakingQueueServiceForTests,
  handleMatched,
  resetMatchmakingRuntimeForTests,
} from './index';
import {
  getTrackedMatchedPairRoomCodesForTests,
  resetMatchedPairsForTests,
} from './matchedPairRegistry';
import {
  getTrackedMatchmakingReservationsForTests,
  resetMatchmakingReservationsForTests,
} from './reservedRoomCleanup';
import * as persistence from './persistence';
import type { QueuedPlayer } from './types';

vi.mock('./persistence', async (importOriginal) => {
  const actual = await importOriginal<typeof persistence>();
  return { ...actual, recordMatchStart: vi.fn(), recordMatchEnd: vi.fn(async () => undefined) };
});

const T0 = 1_000_000;

function makeIo(): Server {
  return {
    sockets: { sockets: new Map() },
    to: vi.fn(() => ({ emit: vi.fn() })),
    emit: vi.fn(),
  } as unknown as Server;
}

function player(suffix: string, rating: number): QueuedPlayer {
  return {
    socketId: `sock-${suffix}`,
    userId: `user-${suffix}`,
    username: `Player${suffix}`,
    rating,
    isSim: false,
    joinedAt: T0,
  } as QueuedPlayer;
}

/** handleMatched happy path -> returns the room code it reserved. */
async function createMatchedRoom(io: Server): Promise<string> {
  vi.mocked(persistence.recordMatchStart).mockImplementation(async ({ roomCode }) => ({
    id: 'mm-match-abort',
    roomCode,
    playerAId: 'user-a',
    playerBId: 'user-b',
    playerARating: 1200,
    playerBRating: 1150,
    status: 'in_progress',
    winnerId: null,
    playerARatingChange: null,
    playerBRatingChange: null,
    isSim: false,
    startedAt: new Date(T0).toISOString(),
    endedAt: null,
  }));
  await handleMatched(io, player('a', 1200), player('b', 1150));
  const codes = getTrackedMatchedPairRoomCodesForTests();
  expect(codes).toHaveLength(1);
  return codes[0]!;
}

describe('abortMatchmakingMatchAndRequeue (M6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rooms.resetRoomRuntimeForTests();
    resetRoomSessionStoresForTests();
    resetMatchmakingReservationsForTests();
    resetMatchedPairsForTests();
    resetMatchmakingRuntimeForTests();
    initRoomSession(makeIo(), {
      resolveSocketIdentity: async () => ({ username: 'Guest', userId: null }),
      normalizeUsername: (v: unknown) => String(v ?? 'Guest'),
      normalizeUserId: (v: unknown) => (typeof v === 'string' ? v : null),
      tryHydrateMatchmakingRoomShell: async () => 'skipped' as const,
      waitUntilMatchmakingRoomSocketsReady: async () => 'ready' as const,
      onAfterMatchStarted: async () => undefined,
      notifyRoomPlayersInGame: () => undefined,
      persistRoomMatchLog: async () => undefined,
      onGameOver: () => null,
    } as any);
    ensureMatchmakingServiceForTests(makeIo());
  });

  afterEach(() => {
    resetMatchmakingRuntimeForTests();
    resetMatchmakingReservationsForTests();
    resetMatchedPairsForTests();
    vi.restoreAllMocks();
  });

  it('tears the room down and requeues both players at their real ratings', async () => {
    const io = makeIo();
    const code = await createMatchedRoom(io);
    expect(rooms.peekRoom(code)).toBeDefined();

    const outcome = abortMatchmakingMatchAndRequeue(code, 'match_sync_failed');

    expect(outcome).toBe('requeued');
    // No orphan room, no leaked M5 reservation, no leaked pair entry.
    expect(rooms.peekRoom(code)).toBeUndefined();
    expect(getTrackedMatchmakingReservationsForTests()).toEqual([]);
    expect(getTrackedMatchedPairRoomCodesForTests()).toEqual([]);

    const service = getMatchmakingQueueServiceForTests()!;
    expect(service.size()).toBe(2);
    expect(service.getStatus('sock-a')).toBeTruthy();
    expect(service.getStatus('sock-b')).toBeTruthy();
  });

  it('refuses to requeue a match the M3 start lock already dealt', async () => {
    const io = makeIo();
    const code = await createMatchedRoom(io);
    rooms.peekRoom(code)!.state = { gameOver: false } as any;

    const outcome = abortMatchmakingMatchAndRequeue(code, 'match_sync_failed');

    expect(outcome).toBe('already_started');
    // Two players in a live game are not pulled back into the queue.
    expect(rooms.peekRoom(code)).toBeDefined();
    expect(getMatchmakingQueueServiceForTests()!.size()).toBe(0);
  });

  it('leaves a room with no recorded pair (hydrated shell) to the normal lifecycle', () => {
    rooms.createReservedRoom('MMSHELLX', { winningScore: 60 });

    const outcome = abortMatchmakingMatchAndRequeue('MMSHELLX', 'match_sync_failed');

    expect(outcome).toBe('no_pair_recorded');
    expect(rooms.peekRoom('MMSHELLX')).toBeDefined();
    expect(getMatchmakingQueueServiceForTests()!.size()).toBe(0);
  });

  it('is idempotent — a second abort finds nothing left to tear down', async () => {
    const io = makeIo();
    const code = await createMatchedRoom(io);
    const deleteSpy = vi.spyOn(rooms, 'deleteRoom');

    expect(abortMatchmakingMatchAndRequeue(code, 'match_sync_failed')).toBe('requeued');
    expect(abortMatchmakingMatchAndRequeue(code, 'match_sync_failed')).toBe('no_pair_recorded');
    expect(deleteSpy).toHaveBeenCalledTimes(1);
  });
});
