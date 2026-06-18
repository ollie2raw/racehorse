import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deriveBracketTerminalState,
  isTournamentBracketTerminal,
  msUntilBracketAutoKick,
  TOURNAMENT_BRACKET_AUTO_KICK_MS,
} from '../../../client/src/tournament/bracketTerminal';

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

function makeBracket(overrides: {
  tournament?: Partial<import('../../../client/src/tournament/types').ScheduledTournament>;
  matches?: Partial<import('../../../client/src/tournament/types').TournamentMatch>[];
} = {}) {
  const tournamentId = '22222222-2222-4222-8222-222222222222';
  const userId = '11111111-1111-4111-8111-111111111111';
  return {
    tournament: {
      id: tournamentId,
      scheduled_start: new Date(Date.now() - 60_000).toISOString(),
      registration_open_at: new Date(Date.now() - 120_000).toISOString(),
      registration_close_at: new Date(Date.now() - 90_000).toISOString(),
      status: 'in_progress' as const,
      format: 'single_elimination',
      win_target: 30,
      max_players: 8,
      winner_id: null,
      created_at: new Date().toISOString(),
      ...overrides.tournament,
    },
    registrations: [
      {
        id: 'reg-1',
        tournament_id: tournamentId,
        user_id: userId,
        registered_at: new Date().toISOString(),
        seed: 1,
        placement: null,
        status: 'active' as const,
        username: 'You',
      },
    ],
    matches: (overrides.matches ?? []).map((match, index) => ({
      id: match.id ?? `match-${index}`,
      tournament_id: tournamentId,
      round: match.round ?? 3,
      match_number: match.match_number ?? 1,
      player1_id: match.player1_id ?? userId,
      player2_id: match.player2_id ?? 'u2',
      winner_id: match.winner_id ?? null,
      room_code: match.room_code ?? 'TFINAL1',
      status: match.status ?? 'in_progress',
      started_at: match.started_at ?? new Date().toISOString(),
      completed_at: match.completed_at ?? null,
      player1_score: match.player1_score ?? 40,
      player2_score: match.player2_score ?? 0,
      bot_tier: null,
    })),
  };
}

describe('deriveBracketTerminalState', () => {
  beforeEach(() => {
    installSessionStorageMock();
  });

  it('suppresses join on a completed final', () => {
    const bracket = makeBracket({
      matches: [
        {
          id: 'final-1',
          round: 3,
          status: 'completed',
          winner_id: '11111111-1111-4111-8111-111111111111',
          completed_at: new Date().toISOString(),
        },
      ],
    });
    const state = deriveBracketTerminalState({
      bracket,
      userId: '11111111-1111-4111-8111-111111111111',
      tournamentPhase: 'in_match',
      assignedMatch: {
        matchId: 'final-1',
        tournamentId: bracket.tournament.id,
        round: 3,
        matchNumber: 1,
        opponentId: 'u2',
        opponentUsername: 'Opponent',
        roomCode: 'TFINAL1',
        matchStatus: 'in_progress',
        scheduledStart: bracket.tournament.scheduled_start,
        matchStartsAt: null,
        readyDeadlineAt: null,
      },
    });

    expect(state.suppressJoin).toBe(true);
    expect(isTournamentBracketTerminal(state)).toBe(true);
    expect(state.showFinalResult).toBe(true);
    expect(state.championName).toBeTruthy();
  });

  it('marks expired in-progress tournaments as terminal', () => {
    const bracket = makeBracket({
      tournament: {
        scheduled_start: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
        status: 'in_progress',
      },
      matches: [],
    });
    const state = deriveBracketTerminalState({
      bracket,
      userId: '11111111-1111-4111-8111-111111111111',
      tournamentPhase: 'match_ready',
      assignedMatch: null,
    });

    expect(state.kind).toBe('tournament_expired');
    expect(state.suppressJoin).toBe(true);
    expect(state.shouldAutoKickToHub).toBe(true);
  });

  it('schedules auto-kick after the bracket grace window', () => {
    const now = Date.now();
    const completedAt = now - 60_000;
    const wait = msUntilBracketAutoKick(completedAt, now);
    expect(wait).toBe(TOURNAMENT_BRACKET_AUTO_KICK_MS - 60_000);
  });
});
