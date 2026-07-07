import { afterEach, describe, expect, it, vi } from 'vitest';
import { shouldPersistJoinedRoom } from './joinedRoomPersistPolicy';
import * as terminalMatches from '../../tournament/terminalMatches';

describe('shouldPersistJoinedRoom', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('persists when joined room is active and no gate signals block', () => {
    vi.spyOn(terminalMatches, 'isTerminalTournamentMatch').mockReturnValue(false);

    expect(
      shouldPersistJoinedRoom({
        joinedRoom: 'ROOM1',
        preventAutoRejoin: false,
        liveGameOver: false,
        tournamentMatchId: 'match-1',
      }),
    ).toBe(true);
  });

  it('does not persist when the live game is over', () => {
    vi.spyOn(terminalMatches, 'isTerminalTournamentMatch').mockReturnValue(false);

    expect(
      shouldPersistJoinedRoom({
        joinedRoom: 'ROOM1',
        preventAutoRejoin: false,
        liveGameOver: true,
        tournamentMatchId: null,
      }),
    ).toBe(false);
  });

  it('does not persist when the tournament match is terminal', () => {
    vi.spyOn(terminalMatches, 'isTerminalTournamentMatch').mockReturnValue(true);

    expect(
      shouldPersistJoinedRoom({
        joinedRoom: 'ROOM1',
        preventAutoRejoin: false,
        liveGameOver: false,
        tournamentMatchId: 'terminal-match',
      }),
    ).toBe(false);
  });

  it('does not persist when auto-rejoin is prevented', () => {
    vi.spyOn(terminalMatches, 'isTerminalTournamentMatch').mockReturnValue(false);

    expect(
      shouldPersistJoinedRoom({
        joinedRoom: 'ROOM1',
        preventAutoRejoin: true,
        liveGameOver: false,
        tournamentMatchId: null,
      }),
    ).toBe(false);
  });
});