/**
 * M5 — empty reserved matchmaking rooms must not leak, and the sweep must not
 * collide with the M1 abort/requeue teardown.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'socket.io';
import * as rooms from '../rooms';
import { initRoomSession, resetRoomSessionStoresForTests } from '../multiplayer/roomSession';
import {
  MATCHMAKING_RESERVATION_GRACE_MS,
  clearMatchmakingReservation,
  getTrackedMatchmakingReservationsForTests,
  markMatchmakingReservation,
  resetMatchmakingReservationsForTests,
  sweepMatchmakingReservations,
} from './reservedRoomCleanup';
import { handleMatched, resetMatchmakingRuntimeForTests } from './index';
import * as persistence from './persistence';
import type { QueuedPlayer } from './types';

vi.mock('./persistence', async (importOriginal) => {
  const actual = await importOriginal<typeof persistence>();
  return {
    ...actual,
    recordMatchStart: vi.fn(),
    recordMatchEnd: vi.fn(async () => undefined),
  };
});

const T0 = 1_000_000;

function makeIo(): Server {
  return {
    sockets: { sockets: new Map() },
    to: vi.fn(() => ({ emit: vi.fn() })),
    emit: vi.fn(),
  } as unknown as Server;
}

function player(suffix: string): QueuedPlayer {
  return {
    socketId: `sock-${suffix}`,
    userId: `user-${suffix}`,
    username: `Player${suffix}`,
    rating: 800,
    isSim: false,
    joinedAt: T0,
  } as QueuedPlayer;
}

describe('matchmaking reserved-room cleanup (M5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rooms.resetRoomRuntimeForTests();
    resetRoomSessionStoresForTests();
    resetMatchmakingReservationsForTests();
    resetMatchmakingRuntimeForTests();
    initRoomSession(makeIo(), {
      resolveSocketIdentity: async () => ({ username: 'Guest', userId: null }),
      normalizeUsername: (v: unknown) => String(v ?? 'Guest'),
      normalizeUserId: (v: unknown) => (typeof v === 'string' ? v : null),
      tryHydrateMatchmakingRoomShell: async () => 'skipped' as const,
      waitUntilMatchmakingRoomSocketsReady: async () => undefined,
      onAfterMatchStarted: async () => undefined,
      notifyRoomPlayersInGame: () => undefined,
      persistRoomMatchLog: async () => undefined,
      onGameOver: () => null,
    } as any);
  });

  afterEach(() => {
    resetMatchmakingReservationsForTests();
    resetMatchmakingRuntimeForTests();
    vi.restoreAllMocks();
  });

  it('tears down a reserved room that is still empty after the grace period', async () => {
    const room = rooms.createReservedRoom('MMLEAK', { winningScore: 60 });
    room.matchmakingMatchId = 'mm-match-leak';
    markMatchmakingReservation('MMLEAK', T0);

    const reaped = sweepMatchmakingReservations(T0 + MATCHMAKING_RESERVATION_GRACE_MS);

    expect(reaped).toEqual(['MMLEAK']);
    expect(rooms.peekRoom('MMLEAK')).toBeUndefined();
    expect(getTrackedMatchmakingReservationsForTests()).toEqual([]);
    // The in_progress row is closed too, or the next join would hydrate a
    // shell for a match nobody is playing.
    expect(vi.mocked(persistence.recordMatchEnd)).toHaveBeenCalledWith(
      expect.objectContaining({ matchId: 'mm-match-leak', status: 'abandoned' }),
    );
  });

  it('leaves a reserved room alone before the grace period expires', () => {
    rooms.createReservedRoom('MMYOUNG', { winningScore: 60 });
    markMatchmakingReservation('MMYOUNG', T0);

    const reaped = sweepMatchmakingReservations(T0 + MATCHMAKING_RESERVATION_GRACE_MS - 1);

    expect(reaped).toEqual([]);
    expect(rooms.peekRoom('MMYOUNG')).toBeDefined();
    expect(getTrackedMatchmakingReservationsForTests()).toEqual(['MMYOUNG']);
  });

  it('hands a recovered room back to the normal lifecycle instead of reaping it', () => {
    rooms.createReservedRoom('MMBACK', { winningScore: 60 });
    markMatchmakingReservation('MMBACK', T0);

    // A player seats within the grace window.
    rooms.joinRoom('MMBACK', 'p1');

    const reaped = sweepMatchmakingReservations(T0 + MATCHMAKING_RESERVATION_GRACE_MS * 10);

    expect(reaped).toEqual([]);
    expect(rooms.peekRoom('MMBACK')).toBeDefined();
    // Tracking is dropped: evaluateRoomLifecycle/scheduleRoomCleanup owns it now.
    expect(getTrackedMatchmakingReservationsForTests()).toEqual([]);
  });

  it('does not double-tear-down a room the M1 abort path already removed', async () => {
    vi.mocked(persistence.recordMatchStart).mockRejectedValue(
      new persistence.MatchStartPersistError('matchmaking_match_start_persist_failed'),
    );
    const io = makeIo();
    const deleteSpy = vi.spyOn(rooms, 'deleteRoom');

    await handleMatched(io, player('a'), player('b'));

    // M1 abort deleted the reservation room and dropped its tracking entry...
    const codesAfterAbort = getTrackedMatchmakingReservationsForTests();
    expect(codesAfterAbort).toEqual([]);
    const deletesFromAbort = deleteSpy.mock.calls.length;
    expect(deletesFromAbort).toBe(1);

    // ...so a later sweep finds nothing to do — no second deleteRoom, no
    // recordMatchEnd for a match that never started.
    expect(sweepMatchmakingReservations(T0 + MATCHMAKING_RESERVATION_GRACE_MS * 10)).toEqual([]);
    expect(deleteSpy.mock.calls.length).toBe(deletesFromAbort);
    expect(vi.mocked(persistence.recordMatchEnd)).not.toHaveBeenCalled();
  });

  it('never reaps a room whose reservation entry was already cleared', () => {
    rooms.createReservedRoom('MMCLR', { winningScore: 60 });
    markMatchmakingReservation('MMCLR', T0);
    clearMatchmakingReservation('MMCLR');

    expect(sweepMatchmakingReservations(T0 + MATCHMAKING_RESERVATION_GRACE_MS * 10)).toEqual([]);
    expect(rooms.peekRoom('MMCLR')).toBeDefined();
  });

  it('tracks the room handleMatched reserves on the happy path', async () => {
    vi.mocked(persistence.recordMatchStart).mockImplementation(async ({ roomCode }) => ({
      id: 'mm-match-ok',
      roomCode,
      playerAId: 'user-a',
      playerBId: 'user-b',
      playerARating: 800,
      playerBRating: 800,
      status: 'in_progress',
      winnerId: null,
      playerARatingChange: null,
      playerBRatingChange: null,
      isSim: false,
      startedAt: new Date(T0).toISOString(),
      endedAt: null,
    }));

    await handleMatched(makeIo(), player('a'), player('b'));

    const tracked = getTrackedMatchmakingReservationsForTests();
    expect(tracked).toHaveLength(1);
    const room = rooms.peekRoom(tracked[0]!)!;
    expect(room.matchmakingMatchId).toBe('mm-match-ok');
    expect(room.matchmakingParticipantUserIds).toEqual(['user-a', 'user-b']);
  });
});
