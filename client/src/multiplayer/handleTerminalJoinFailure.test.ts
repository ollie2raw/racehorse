import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoomAckResponse } from './roomTransport';
import { handleTerminalJoinFailure, isRecoverableTerminalJoinResponse } from './handleTerminalJoinFailure';
import * as terminalRoomArchiveRecovery from './terminalRoomArchiveRecovery';

describe('handleTerminalJoinFailure', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('recognizes structured match_terminal responses', () => {
    const resp: RoomAckResponse = {
      ok: false,
      error: 'match_terminal',
      terminal: {
        status: 'completed',
        matchId: '11111111-1111-4111-8111-111111111111',
        recoverable: true,
      },
    };
    expect(isRecoverableTerminalJoinResponse(resp)).toBe(true);
  });

  it('fetches archive and surfaces abandonedMatchNotice for match_terminal', async () => {
    vi.spyOn(terminalRoomArchiveRecovery, 'recoverTerminalMatchArchive').mockResolvedValue({
      status: 'found',
      notice: {
        context: 'multiplayer',
        title: 'Match completed',
        detail: 'Final score available.',
      },
    });

    const setRecoveredTerminalMatchNotice = vi.fn();
    const dispatchRecovery = vi.fn();

    const result = await handleTerminalJoinFailure({
      resp: {
        ok: false,
        error: 'match_terminal',
        terminal: {
          status: 'completed',
          matchId: '11111111-1111-4111-8111-111111111111',
          recoverable: true,
        },
      },
      roomCode: 'ROOM7',
      serverUrl: 'http://localhost:3001',
      authToken: 'token',
      setRecoveredTerminalMatchNotice,
      dispatchRecovery,
    });

    expect(result).toBe('handled');
    expect(setRecoveredTerminalMatchNotice).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Match completed' }),
    );
    expect(dispatchRecovery).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ROOM_JOIN_TERMINAL' }),
    );
  });

  it('returns not_terminal for transient join failures', async () => {
    const fetchSpy = vi.spyOn(terminalRoomArchiveRecovery, 'recoverTerminalMatchArchive');

    const result = await handleTerminalJoinFailure({
      resp: { ok: false, error: 'room_degraded' },
      roomCode: 'ROOM7',
      serverUrl: 'http://localhost:3001',
      authToken: 'token',
    });

    expect(result).toBe('not_terminal');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
