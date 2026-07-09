import { describe, expect, it, vi } from 'vitest';
import type { SessionSnapshot } from './session/sessionTypes';
import type { RoomAckResponse } from './roomTransport';

// Simulate the exact logic of trySchedulePlayerReady from client/src/App.tsx
function simulateTrySchedulePlayerReady(params: {
  session: SessionSnapshot;
  appMode: string;
  joinedRoomResponse: RoomAckResponse | null;
  roomPlayersLength: number;
  schedulePlayerReady: () => void;
  selectCanSendReady: (session: SessionSnapshot) => boolean;
}) {
  if (!params.selectCanSendReady(params.session)) {
    return;
  }

  const isQuickMatch =
    params.appMode === 'multiplayer' &&
    Boolean(params.joinedRoomResponse?.matchmakingMatchId);

  if (isQuickMatch) {
    if (params.roomPlayersLength < 2) {
      return;
    }
  }

  params.schedulePlayerReady();
}

describe('trySchedulePlayerReady logic', () => {
  const mockSelectCanSendReady = (session: SessionSnapshot) => session.phase === 'in_lobby';

  const defaultSession: SessionSnapshot = {
    phase: 'in_lobby',
    context: {
      roomCode: 'ROOM123',
      youId: 'seat-a',
      seated: true,
      playerReadyEmitted: false,
      intentionalDisconnect: false,
    },
  };

  it('bypasses quick match deferral for private matches (no matchmakingMatchId) even if players length is 1', () => {
    const schedulePlayerReady = vi.fn();
    simulateTrySchedulePlayerReady({
      session: defaultSession,
      appMode: 'multiplayer',
      joinedRoomResponse: {
        ok: true,
        roomCode: 'ROOM123',
        you: 'seat-a',
        players: [],
        matchmakingMatchId: null, // Private room
      },
      roomPlayersLength: 1,
      schedulePlayerReady,
      selectCanSendReady: mockSelectCanSendReady,
    });

    expect(schedulePlayerReady).toHaveBeenCalledTimes(1);
  });

  it('enforces quick match deferral for matchmaking matches (matchmakingMatchId present) when players length is 1', () => {
    const schedulePlayerReady = vi.fn();
    simulateTrySchedulePlayerReady({
      session: defaultSession,
      appMode: 'multiplayer',
      joinedRoomResponse: {
        ok: true,
        roomCode: 'ROOM123',
        you: 'seat-a',
        players: [],
        matchmakingMatchId: 'matchmaking-match-id', // Matchmaking room
      },
      roomPlayersLength: 1,
      schedulePlayerReady,
      selectCanSendReady: mockSelectCanSendReady,
    });

    expect(schedulePlayerReady).not.toHaveBeenCalled();
  });

  it('allows ready for matchmaking matches when players length is 2', () => {
    const schedulePlayerReady = vi.fn();
    simulateTrySchedulePlayerReady({
      session: defaultSession,
      appMode: 'multiplayer',
      joinedRoomResponse: {
        ok: true,
        roomCode: 'ROOM123',
        you: 'seat-a',
        players: [],
        matchmakingMatchId: 'matchmaking-match-id', // Matchmaking room
      },
      roomPlayersLength: 2,
      schedulePlayerReady,
      selectCanSendReady: mockSelectCanSendReady,
    });

    expect(schedulePlayerReady).toHaveBeenCalledTimes(1);
  });
});
