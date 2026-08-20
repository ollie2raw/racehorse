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

  it('fetches the result endpoint and surfaces recovered private match UI', async () => {
    const recovered = {
      kind: 'result' as const,
      result: {
        matchId: '11111111-1111-4111-8111-111111111111',
        roomCode: 'ROOM7',
        terminalStatus: 'completed' as const,
        archivedAt: '2026-08-19T00:10:00.000Z',
        you: { seatId: 'seat-a', userId: 'a', username: 'You' },
        opponent: { seatId: 'seat-b', userId: 'b', username: 'Opp' },
        outcome: 'win' as const,
        yourScore: 60,
        opponentScore: 40,
        ranking: {
          eligible: true,
          applied: true,
          skipReason: null,
          message: null,
          ratingBefore: 1500,
          ratingAfter: 1512,
          ratingDelta: 12,
        },
      },
    };
    vi.spyOn(terminalRoomArchiveRecovery, 'recoverPrivateMatchResult').mockResolvedValue(recovered);

    const setRecoveredPrivateMatch = vi.fn();
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
      setRecoveredPrivateMatch,
      dispatchRecovery,
    });

    expect(result).toBe('handled');
    expect(terminalRoomArchiveRecovery.recoverPrivateMatchResult).toHaveBeenCalledWith(
      expect.objectContaining({
        roomCode: 'ROOM7',
        matchId: '11111111-1111-4111-8111-111111111111',
      }),
    );
    expect(setRecoveredPrivateMatch).toHaveBeenCalledWith(recovered);
    expect(dispatchRecovery).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ROOM_JOIN_TERMINAL' }),
    );
  });

  it('returns not_terminal for transient join failures', async () => {
    const fetchSpy = vi.spyOn(terminalRoomArchiveRecovery, 'recoverPrivateMatchResult');

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
