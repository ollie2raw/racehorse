// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildDailyFritzHubGameCards, buildDailyFritzHubViewModel } from './dailyFritzHubViewModel';
import type { DailyFritzSetResult, DailyFritzTodayResponse } from './api';

function makeToday(attemptStatus: DailyFritzTodayResponse['attempt_status']): DailyFritzTodayResponse {
  return {
    ok: true,
    run_date: '2026-07-05',
    fritz_tier: 'elite',
    deal_size: 7,
    winning_score: 60,
    attempt_status: attemptStatus,
    current_game_number: null,
    streak: attemptStatus === 'none' ? 3 : 1,
    result: null,
    set_result: null,
    rank: null,
    leaderboard_preview: [],
  };
}

const emptySetResult: DailyFritzSetResult = {
  version: 2,
  format: 'best_of_3',
  playerGamesWon: 0,
  fritzGamesWon: 0,
  totalPointDiff: 0,
  games: [],
};

describe('buildDailyFritzHubGameCards', () => {
  it('marks game 1 active when no games played', () => {
    const cards = buildDailyFritzHubGameCards(null, {
      isComplete: false,
      isStarted: false,
      startActionPending: false,
      winTarget: 60,
    });
    expect(cards[0]?.gameState).toBe('active');
    expect(cards[1]?.gameState).toBe('locked');
    expect(cards[2]?.gameState).toBe('locked');
  });

  it('marks game 2 active after player wins game 1', () => {
    const setResult: DailyFritzSetResult = {
      ...emptySetResult,
      playerGamesWon: 1,
      games: [
        {
          gameNumber: 1,
          seed: 'seed-1',
          playerWon: true,
          playerScore: 60,
          fritzScore: 40,
          pointDiff: 20,
          completedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    };
    const cards = buildDailyFritzHubGameCards(setResult, {
      isComplete: false,
      isStarted: true,
      startActionPending: false,
      winTarget: 60,
    });
    expect(cards[0]?.gameState).toBe('won');
    expect(cards[1]?.gameState).toBe('active');
    expect(cards[2]?.gameState).toBe('locked');
  });
});

describe('buildDailyFritzHubViewModel', () => {
  it('returns play CTA when attempt not started', () => {
    const vm = buildDailyFritzHubViewModel(makeToday('none'), null, 0, false, true);
    expect(vm.primaryCtaLabel).toBe("Play Today's Set");
    expect(vm.isComplete).toBe(false);
    expect(vm.isStarted).toBe(false);
  });

  it('returns resume CTA when attempt started', () => {
    const vm = buildDailyFritzHubViewModel(makeToday('started'), emptySetResult, 0, false, true);
    expect(vm.primaryCtaLabel).toBe("Resume Today's Set");
    expect(vm.isStarted).toBe(true);
  });

  it('renders the authoritative completed hub after a lost /complete response', () => {
    const vm = buildDailyFritzHubViewModel(makeToday('completed'), emptySetResult, 0, false, true);
    expect(vm.primaryCtaLabel).toBe("View Today's Result");
    expect(vm.setStatusLabel).toBe('Complete');
    expect(vm.isComplete).toBe(true);
  });
});
