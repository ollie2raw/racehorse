import { describe, expect, it } from 'vitest';
import { deriveTournamentHubViewModel } from '../../../client/src/tournament/hubState';
import type { Registration, ScheduledTournament } from '../../../client/src/tournament/types';

function makeTournament(overrides: Partial<ScheduledTournament> = {}): ScheduledTournament {
  return {
    id: 'tour-1',
    scheduled_start: new Date(Date.now() + 60 * 60_000).toISOString(),
    registration_open_at: new Date(Date.now() + 30 * 60_000).toISOString(),
    registration_close_at: new Date(Date.now() + 55 * 60_000).toISOString(),
    status: 'upcoming',
    format: '7-tile',
    win_target: 30,
    max_players: 8,
    winner_id: null,
    created_at: new Date().toISOString(),
    registered_count: 2,
    ...overrides,
  };
}

describe('deriveTournamentHubViewModel', () => {
  it('returns cancelled copy for cancelled tournaments', () => {
    const vm = deriveTournamentHubViewModel({
      upcoming: [makeTournament()],
      registrations: [] as Registration[],
      recoveryMatch: null,
      activeBracketStatus: 'cancelled',
      isLoading: false,
      hasLoaded: true,
      error: null,
      nowMs: Date.now(),
    });
    expect(vm.state).toBe('cancelled');
    expect(vm.title).toContain('cancelled');
  });

  it('returns retryable api_error copy', () => {
    const vm = deriveTournamentHubViewModel({
      upcoming: [],
      registrations: [] as Registration[],
      recoveryMatch: null,
      activeBracketStatus: null,
      isLoading: false,
      hasLoaded: false,
      error: 'boom',
      nowMs: Date.now(),
    });
    expect(vm.state).toBe('api_error');
    expect(vm.canRetry).toBe(true);
    expect(vm.detail).toBe('boom');
  });

  it('returns eliminated state instead of retry join when registration is eliminated and no active match exists', () => {
    const vm = deriveTournamentHubViewModel({
      upcoming: [makeTournament()],
      registrations: [
        {
          id: 'reg-1',
          tournament_id: 'tour-1',
          user_id: 'u1',
          registered_at: new Date().toISOString(),
          seed: 1,
          placement: null,
          status: 'eliminated',
        },
      ] as Registration[],
      recoveryMatch: null,
      activeBracketStatus: 'in_progress',
      isLoading: false,
      hasLoaded: true,
      error: null,
      nowMs: Date.now(),
    });
    expect(vm.state).toBe('eliminated');
    expect(vm.title).toBe('Eliminated');
  });
});
