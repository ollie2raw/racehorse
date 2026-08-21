/**
 * M1 + M2 — handleMatched failure must tear down partial rooms and requeue;
 * recordMatchStart failures share the same abort path (not swallowed).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'socket.io';
import * as rooms from '../rooms';
import { getRoomRuntimeStats, peekRoom, resetRoomRuntimeForTests } from '../rooms';
import {
  ensureMatchmakingServiceForTests,
  getMatchmakingQueueServiceForTests,
  handleMatched,
  resetMatchmakingRuntimeForTests,
} from './index';
import * as persistence from './persistence';
import type { QueuedPlayer } from './types';

vi.mock('./persistence', async () => {
  const actual = await vi.importActual<typeof import('./persistence')>('./persistence');
  return {
    ...actual,
    recordMatchStart: vi.fn(),
  };
});

function player(overrides: Partial<QueuedPlayer>): QueuedPlayer {
  return {
    socketId: 'sock-a',
    userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    username: 'A',
    rating: 800,
    joinedAtMs: Date.now(),
    isSim: false,
    ...overrides,
  };
}

function makeIo(): Server {
  return {
    to: vi.fn(() => ({ emit: vi.fn() })),
    emit: vi.fn(),
    sockets: { sockets: { size: 0 } },
  } as unknown as Server;
}

describe('M1/M2 handleMatched abort + requeue', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetRoomRuntimeForTests();
    resetMatchmakingRuntimeForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetMatchmakingRuntimeForTests();
    resetRoomRuntimeForTests();
  });

  it('1) throws before room fully created → both requeued, no orphaned room', async () => {
    const io = makeIo();
    ensureMatchmakingServiceForTests(io);
    const a = player({ socketId: 'sock-a', userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    const b = player({
      socketId: 'sock-b',
      userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      username: 'B',
      rating: 810,
    });

    vi.spyOn(rooms, 'createReservedRoom').mockImplementation(() => {
      throw new Error('create_reserved_failed');
    });

    await handleMatched(io, a, b);

    expect(rooms.createReservedRoom).toHaveBeenCalled();
    expect(persistence.recordMatchStart).not.toHaveBeenCalled();
    expect(getRoomRuntimeStats().roomCount).toBe(0);
    const queuedIds = getMatchmakingQueueServiceForTests()!
      .list()
      .map((p) => p.userId)
      .sort();
    expect(queuedIds).toEqual([a.userId, b.userId].sort());
    expect(io.to).not.toHaveBeenCalled();
  });

  it('2) throws after partial room creation → room torn down, both requeued', async () => {
    const io = makeIo();
    ensureMatchmakingServiceForTests(io);
    const a = player({ socketId: 'sock-a', userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    const b = player({
      socketId: 'sock-b',
      userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      username: 'B',
      rating: 810,
    });

    vi.mocked(persistence.recordMatchStart).mockRejectedValue(
      new persistence.MatchStartPersistError('matchmaking_match_start_persist_failed'),
    );

    await handleMatched(io, a, b);

    const roomCode = vi.mocked(persistence.recordMatchStart).mock.calls[0]?.[0]?.roomCode;
    expect(roomCode).toMatch(/^MM/);
    expect(peekRoom(String(roomCode))).toBeUndefined();
    expect(getRoomRuntimeStats().roomCount).toBe(0);
    expect(
      getMatchmakingQueueServiceForTests()!
        .list()
        .map((p) => p.userId)
        .sort(),
    ).toEqual([a.userId, b.userId].sort());
    expect(io.to).not.toHaveBeenCalled();
  });

  it('3) recordMatchStart fails → surfaced via abort (no queue:matched, requeued)', async () => {
    const io = makeIo();
    ensureMatchmakingServiceForTests(io);
    const a = player({ socketId: 'sock-a' });
    const b = player({
      socketId: 'sock-b',
      userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      username: 'B',
    });

    vi.mocked(persistence.recordMatchStart).mockRejectedValue(
      new persistence.MatchStartPersistError('matchmaking_match_start_persist_failed'),
    );

    await handleMatched(io, a, b);

    expect(persistence.recordMatchStart).toHaveBeenCalled();
    expect(io.to).not.toHaveBeenCalled();
    expect(
      getMatchmakingQueueServiceForTests()!
        .list()
        .map((p) => p.userId)
        .sort(),
    ).toEqual([a.userId, b.userId].sort());
  });

  it('4) happy path → match recorded, queue:matched emitted, players not requeued', async () => {
    const io = makeIo();
    const emit = vi.fn();
    (io.to as ReturnType<typeof vi.fn>).mockReturnValue({ emit });
    ensureMatchmakingServiceForTests(io);
    const a = player({ socketId: 'sock-a' });
    const b = player({
      socketId: 'sock-b',
      userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      username: 'B',
      rating: 810,
    });

    vi.mocked(persistence.recordMatchStart).mockResolvedValue({
      id: 'mm-match-happy',
      roomCode: 'MMHAPY',
      playerAId: a.userId,
      playerBId: b.userId,
      playerARating: 800,
      playerBRating: 810,
      status: 'in_progress',
      winnerId: null,
      playerARatingChange: null,
      playerBRatingChange: null,
      isSim: false,
      startedAt: '2026-08-20T00:00:00.000Z',
      endedAt: null,
    });

    await handleMatched(io, a, b);

    expect(persistence.recordMatchStart).toHaveBeenCalled();
    expect(io.to).toHaveBeenCalledWith('sock-a');
    expect(io.to).toHaveBeenCalledWith('sock-b');
    expect(emit).toHaveBeenCalledWith(
      'queue:matched',
      expect.objectContaining({ roomCode: expect.any(String) }),
    );
    expect(getMatchmakingQueueServiceForTests()!.list()).toHaveLength(0);
    const matchedRoomCode = (emit.mock.calls[0]?.[1] as { roomCode: string }).roomCode;
    expect(peekRoom(matchedRoomCode)?.matchmakingMatchId).toBe('mm-match-happy');
  });
});
