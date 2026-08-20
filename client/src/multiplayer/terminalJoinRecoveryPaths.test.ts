import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleTerminalJoinFailure } from './handleTerminalJoinFailure';
import * as terminalRoomArchiveRecovery from './terminalRoomArchiveRecovery';
import type { RecoveryEvent } from './recoveryMachine';
import type { RecoveredPrivateMatchUi } from './terminalRoomArchiveRecovery';

describe('terminal join recovery paths', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const recovered: RecoveredPrivateMatchUi = {
    kind: 'result',
    result: {
      matchId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      roomCode: 'ROOM7',
      terminalStatus: 'completed',
      archivedAt: '2026-08-19T00:10:00.000Z',
      you: { seatId: 'seat-a', userId: 'a', username: 'You' },
      opponent: { seatId: 'seat-b', userId: 'b', username: 'Opponent' },
      outcome: 'win',
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

  it('recovery-room-join path handles match_terminal after archived cleanup', async () => {
    vi.spyOn(terminalRoomArchiveRecovery, 'recoverPrivateMatchResult').mockResolvedValue(recovered);
    const setRecoveredPrivateMatch = vi.fn();
    const dispatchRecovery = vi.fn((event: RecoveryEvent) => event);

    const handled = await handleTerminalJoinFailure({
      resp: {
        ok: false,
        error: 'match_terminal',
        terminal: {
          status: 'completed',
          matchId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
          recoverable: true,
        },
      },
      roomCode: 'ROOM7',
      serverUrl: 'http://localhost:3001',
      authToken: 'token',
      setRecoveredPrivateMatch,
      onNavigateMultiplayer: vi.fn(),
      dispatchRecovery,
    });

    expect(handled).toBe('handled');
    expect(setRecoveredPrivateMatch).toHaveBeenCalledWith(recovered);
    expect(dispatchRecovery).toHaveBeenCalledWith({
      type: 'ROOM_JOIN_TERMINAL',
      error: 'match_terminal',
    });
  });

  it('saved-room auto-join path handles legacy match_completed the same way', async () => {
    vi.spyOn(terminalRoomArchiveRecovery, 'recoverPrivateMatchResult').mockResolvedValue(recovered);
    const setRecoveredPrivateMatch = vi.fn();
    const dispatchRecovery = vi.fn((event: RecoveryEvent) => event);

    const handled = await handleTerminalJoinFailure({
      resp: { ok: false, error: 'match_completed' },
      roomCode: 'ROOM7',
      serverUrl: 'http://localhost:3001',
      authToken: 'token',
      lastRoomStorageKey: 'racehorse_last_room_code',
      clearSavedRoomOnAttempt: true,
      setRecoveredPrivateMatch,
      dispatchRecovery,
    });

    expect(handled).toBe('handled');
    expect(setRecoveredPrivateMatch).toHaveBeenCalledWith(recovered);
    expect(dispatchRecovery).toHaveBeenCalledWith({
      type: 'ROOM_JOIN_TERMINAL',
      error: 'match_completed',
    });
  });
});
