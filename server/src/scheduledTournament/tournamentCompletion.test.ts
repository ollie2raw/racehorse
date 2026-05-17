import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isTerminalTournamentMatch,
  markTerminalTournamentMatch,
  tournamentSubViewAfterMatchComplete,
} from '../../../client/src/tournament/terminalMatches';

function installSessionStorageMock() {
  const store = new Map<string, string>();
  vi.stubGlobal('window', {
    sessionStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    },
  });
}

describe('terminal tournament matches', () => {
  beforeEach(() => {
    installSessionStorageMock();
  });
  it('routes final and completed tournaments to the result screen', () => {
    expect(tournamentSubViewAfterMatchComplete({ round: 3 })).toBe('result');
    expect(tournamentSubViewAfterMatchComplete({ tournamentCompleted: true })).toBe('result');
    expect(tournamentSubViewAfterMatchComplete({ round: 2 })).toBe('bracket');
  });

  it('persists terminal match ids in session storage', () => {
    const matchId = '11111111-1111-4111-8111-111111111111';
    markTerminalTournamentMatch({
      matchId,
      tournamentId: '22222222-2222-4222-8222-222222222222',
      roomCode: 'TFINAL1',
    });
    expect(isTerminalTournamentMatch(matchId)).toBe(true);
    expect(isTerminalTournamentMatch('other-match')).toBe(false);
  });
});
