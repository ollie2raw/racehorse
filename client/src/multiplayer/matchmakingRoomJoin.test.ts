// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  canAttemptMatchmakingRoomJoin,
  emitMatchmakingRoomJoin,
  handleMatchmakingRoomJoinAck,
} from './matchmakingRoomJoin';
import type { RoomJoinIdentity } from './roomTransport';

const identity: RoomJoinIdentity = {
  username: 'Player',
  userId: 'user-1',
  authToken: 'token-1',
};

describe('canAttemptMatchmakingRoomJoin', () => {
  it('does not attempt join when socket is not connected', () => {
    expect(
      canAttemptMatchmakingRoomJoin({
        socket: { connected: false, emit: vi.fn() },
        roomCode: 'ROOM1',
        currentJoinedRoom: null,
      }),
    ).toBe(false);
  });

  it('does not attempt join when already in the target room', () => {
    expect(
      canAttemptMatchmakingRoomJoin({
        socket: { connected: true, emit: vi.fn() },
        roomCode: 'room1',
        currentJoinedRoom: 'ROOM1',
      }),
    ).toBe(false);
  });
});

describe('emitMatchmakingRoomJoin', () => {
  it('resolves with the room:join ack response', async () => {
    const emit = vi.fn((...args: unknown[]) => {
      const ack = args[3] as ((resp: unknown) => void) | undefined;
      ack?.({ ok: true, roomCode: 'ROOM1' });
    });

    await expect(
      emitMatchmakingRoomJoin({
        socket: { connected: true, emit },
        roomCode: ' room1 ',
        identity,
      }),
    ).resolves.toEqual({ ok: true, roomCode: 'ROOM1' });

    expect(emit).toHaveBeenCalledWith('room:join', 'ROOM1', identity, expect.any(Function));
  });
});

describe('handleMatchmakingRoomJoinAck', () => {
  it('applies joined-room response on successful ack', () => {
    const applyJoinedRoomResponse = vi.fn();
    const showToast = vi.fn();

    handleMatchmakingRoomJoinAck(
      { ok: true, roomCode: 'ROOM1' },
      { applyJoinedRoomResponse, showToast },
    );

    expect(applyJoinedRoomResponse).toHaveBeenCalledWith({ ok: true, roomCode: 'ROOM1' });
    expect(showToast).not.toHaveBeenCalled();
  });

  it('shows toast and skips apply on failed ack', () => {
    const applyJoinedRoomResponse = vi.fn();
    const showToast = vi.fn();

    handleMatchmakingRoomJoinAck(
      { ok: false, error: 'Room full' },
      { applyJoinedRoomResponse, showToast },
    );

    expect(showToast).toHaveBeenCalledWith('Room full', 2500);
    expect(applyJoinedRoomResponse).not.toHaveBeenCalled();
  });
});