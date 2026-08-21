import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'socket.io';
import { resetRoomRuntimeForTests, getRoom } from '../rooms';
import * as telemetry from '../multiplayer/mpAuthorityTelemetry';
import { handleMatched } from './index';
import type { QueuedPlayer } from './types';

vi.mock('./persistence', () => ({
  recordMatchStart: vi.fn(async () => ({
    id: 'mm-match-1',
    roomCode: 'MMTEST',
    playerAId: 'user-a',
    playerBId: 'user-b',
    playerARating: 800,
    playerBRating: 810,
    status: 'in_progress',
    winnerId: null,
    playerARatingChange: null,
    playerBRatingChange: null,
    isSim: false,
    startedAt: '2026-08-20T00:00:00.000Z',
    endedAt: null,
  })),
}));

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

describe('quick-match lobby funnel', () => {
  beforeEach(() => {
    resetRoomRuntimeForTests();
  });

  it('emits private_lobby_created with sourceType quick after matchmaking records the match', async () => {
    const emit = vi.spyOn(telemetry, 'emitMpAuthorityFunnel');
    const io = {
      to: vi.fn(() => ({ emit: vi.fn() })),
    } as unknown as Server;

    await handleMatched(
      io,
      player({ socketId: 'sock-a', userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
      player({ socketId: 'sock-b', userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', username: 'B', rating: 810 }),
    );

    expect(emit).toHaveBeenCalledWith('private_lobby_created', expect.objectContaining({
      sourceType: 'quick',
      extra: { matchmakingMatchId: 'mm-match-1' },
    }));
    const roomCode = emit.mock.calls.find((call) => call[0] === 'private_lobby_created')?.[1]?.roomCode;
    expect(roomCode).toBeTruthy();
    expect(getRoom(String(roomCode)).matchmakingMatchId).toBe('mm-match-1');
  });
});
