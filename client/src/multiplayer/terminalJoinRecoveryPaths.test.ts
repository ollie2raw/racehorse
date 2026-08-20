import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleTerminalJoinFailure } from './handleTerminalJoinFailure';
import * as terminalRoomArchiveRecovery from './terminalRoomArchiveRecovery';
import type { RecoveryEvent } from './recoveryMachine';

describe('terminal join recovery paths', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const archiveNotice = {
    context: 'multiplayer' as const,
    title: 'Match completed',
    detail: 'Your saved room ROOM7 finished while you were away. Final score: You 60 - Opponent 40.',
  };

  it('recovery-room-join path handles match_terminal after archived cleanup', async () => {
    vi.spyOn(terminalRoomArchiveRecovery, 'recoverTerminalMatchArchive').mockResolvedValue({
      status: 'found',
      notice: archiveNotice,
    });
    const setRecoveredTerminalMatchNotice = vi.fn();
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
      setRecoveredTerminalMatchNotice,
      onNavigateMultiplayer: vi.fn(),
      dispatchRecovery,
    });

    expect(handled).toBe('handled');
    expect(setRecoveredTerminalMatchNotice).toHaveBeenCalledWith(archiveNotice);
    expect(dispatchRecovery).toHaveBeenCalledWith({
      type: 'ROOM_JOIN_TERMINAL',
      error: 'match_terminal',
    });
  });

  it('saved-room auto-join path handles legacy match_completed the same way', async () => {
    vi.spyOn(terminalRoomArchiveRecovery, 'recoverTerminalMatchArchive').mockResolvedValue({
      status: 'found',
      notice: archiveNotice,
    });
    const setRecoveredTerminalMatchNotice = vi.fn();
    const dispatchRecovery = vi.fn((event: RecoveryEvent) => event);

    const handled = await handleTerminalJoinFailure({
      resp: { ok: false, error: 'match_completed' },
      roomCode: 'ROOM7',
      serverUrl: 'http://localhost:3001',
      authToken: 'token',
      lastRoomStorageKey: 'racehorse_last_room_code',
      clearSavedRoomOnAttempt: true,
      setRecoveredTerminalMatchNotice,
      dispatchRecovery,
    });

    expect(handled).toBe('handled');
    expect(setRecoveredTerminalMatchNotice).toHaveBeenCalledWith(archiveNotice);
    expect(dispatchRecovery).toHaveBeenCalledWith({
      type: 'ROOM_JOIN_TERMINAL',
      error: 'match_completed',
    });
  });
});
