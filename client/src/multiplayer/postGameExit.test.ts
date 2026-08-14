// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import * as roomTransport from './roomTransport';
import {
  canAttemptMatchAbandon,
  emitMatchAbandonTransport,
  handleMatchAbandonFailure,
  performMatchAbandonSuccessCleanup,
  performPostGameHomeTeardown,
} from './postGameExit';

describe('performPostGameHomeTeardown', () => {
  it('resets multiplayer room state then disconnects', () => {
    const resetMultiplayerRoomState = vi.fn();
    const disconnect = vi.fn();

    performPostGameHomeTeardown({ resetMultiplayerRoomState, disconnect });

    expect(resetMultiplayerRoomState).toHaveBeenCalledWith({ keepPlayers: false, clearRoomCode: true });
    expect(disconnect).toHaveBeenCalledWith('post-game to home');
    expect(resetMultiplayerRoomState.mock.invocationCallOrder[0]).toBeLessThan(
      disconnect.mock.invocationCallOrder[0],
    );
  });
});

describe('canAttemptMatchAbandon', () => {
  it('returns false when socket is not connected', () => {
    expect(
      canAttemptMatchAbandon({
        socket: { connected: false },
        activeRoomCode: 'ROOM1',
      }),
    ).toBe(false);
  });

  it('returns false when room code is empty', () => {
    expect(
      canAttemptMatchAbandon({
        socket: { connected: true },
        activeRoomCode: '',
      }),
    ).toBe(false);
  });

  it('returns true when socket is connected and room code is present', () => {
    expect(
      canAttemptMatchAbandon({
        socket: { connected: true },
        activeRoomCode: 'ROOM1',
      }),
    ).toBe(true);
  });
});

describe('emitMatchAbandonTransport', () => {
  it('delegates to emitRoomAbandonMatch with the same payload', async () => {
    const spy = vi.spyOn(roomTransport, 'emitRoomAbandonMatch').mockResolvedValue({ ok: true });
    const socket = { emit: vi.fn() };

    await expect(
      emitMatchAbandonTransport(socket, {
        roomCode: 'ROOM1',
        tournamentMatchId: 'match-1',
      }),
    ).resolves.toEqual({ ok: true });

    expect(spy).toHaveBeenCalledWith(socket, {
      roomCode: 'ROOM1',
      tournamentMatchId: 'match-1',
    });

    spy.mockRestore();
  });
});

describe('handleMatchAbandonFailure', () => {
  it('sets shell error and shows toast', () => {
    const shellSetActionError = vi.fn();
    const showToast = vi.fn();

    handleMatchAbandonFailure('Room full', { shellSetActionError, showToast });

    expect(shellSetActionError).toHaveBeenCalledWith('Room full');
    expect(showToast).toHaveBeenCalledWith('Room full', 2200);
  });
});

describe('performMatchAbandonSuccessCleanup', () => {
  it('clears recoverable state, resets room, then clears shell error in order', () => {
    const clearRecoverableRoomState = vi.fn();
    const resetMultiplayerRoomState = vi.fn();
    const shellSetActionError = vi.fn();

    performMatchAbandonSuccessCleanup({
      clearRecoverableRoomState,
      resetMultiplayerRoomState,
      shellSetActionError,
    });

    expect(clearRecoverableRoomState).toHaveBeenCalledTimes(1);
    expect(resetMultiplayerRoomState).toHaveBeenCalledWith({ keepPlayers: true });
    expect(shellSetActionError).toHaveBeenCalledWith('');
    expect(clearRecoverableRoomState.mock.invocationCallOrder[0]).toBeLessThan(
      resetMultiplayerRoomState.mock.invocationCallOrder[0],
    );
    expect(resetMultiplayerRoomState.mock.invocationCallOrder[0]).toBeLessThan(
      shellSetActionError.mock.invocationCallOrder[0],
    );
  });
});