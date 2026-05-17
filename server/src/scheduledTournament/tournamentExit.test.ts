import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isTerminalTournamentMatch,
  markTerminalTournamentMatch,
  markTournamentTerminal,
  readTournamentTerminalCompletedAt,
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

describe('tournament exit persistence', () => {
  beforeEach(() => {
    installSessionStorageMock();
  });

  it('marks final matches and tournaments as non-recoverable in session storage', () => {
    const matchId = '11111111-1111-4111-8111-111111111111';
    const tournamentId = '22222222-2222-4222-8222-222222222222';
    markTerminalTournamentMatch({ matchId, tournamentId, roomCode: 'TFINAL1' });
    markTournamentTerminal({ tournamentId });

    expect(isTerminalTournamentMatch(matchId)).toBe(true);
    expect(readTournamentTerminalCompletedAt(tournamentId)).toBeTypeOf('number');
  });
});
