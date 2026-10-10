/**
 * Phase 3C: the Hub shows every tournament state on its own card, so being
 * registered (or in the bracket lobby, or having a match ready) never pulls the
 * player off the Hub into the bracket, and the Hub never fetches a bracket the
 * player is not looking at. On the bracket view the missing bracket still loads.
 */
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useTournamentBracketTerminal } from './useTournamentBracketTerminal';

function setup(subView: 'hub' | 'bracket', phase: string) {
  const setTournamentSubView = vi.fn();
  const openBracket = vi.fn(async () => undefined);
  renderHook(() => useTournamentBracketTerminal({
    appMode: 'tournament',
    authUserId: 'u1',
    tournament: {
      activeTournamentId: 'live-1', tournamentPhase: phase, activeBracket: null, assignedMatch: null, openBracket,
    } as never,
    sessionState: {
      tournamentSubView: subView, activeTournamentId: 'live-1', setActiveTournamentId: vi.fn(),
      setTournamentSubView, dismissedTournamentIdsRef: { current: new Set<string>() },
    } as never,
    navigation: { exitToTournamentHub: vi.fn() } as never,
  }));
  return { setTournamentSubView, openBracket };
}

describe('bracket routing from the Hub', () => {
  it.each(['registered', 'bracket_lobby', 'match_ready', 'in_match'])('%s: stays on the Hub, no bracket fetch', (phase) => {
    const { setTournamentSubView, openBracket } = setup('hub', phase);
    expect(setTournamentSubView).not.toHaveBeenCalledWith('bracket');
    expect(openBracket).not.toHaveBeenCalled();
  });

  it('on the bracket view, a missing bracket loads once', () => {
    const { openBracket } = setup('bracket', 'registered');
    expect(openBracket).toHaveBeenCalledTimes(1);
    expect(openBracket).toHaveBeenCalledWith('live-1');
  });
});
