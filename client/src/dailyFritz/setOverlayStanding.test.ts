// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { buildDailyFritzSetOverlayViewModel } from './buildDailyFritzSetOverlayViewModel';

const game = (n: number, ps: number, fz: number) => ({
  gameNumber: n, seed: 's', playerWon: ps > fz, playerScore: ps, fritzScore: fz,
  pointDiff: ps - fz, completedAt: '2026-08-28T09:36:00Z',
});
const actions = {
  continueSet: () => {}, submitCompletedGame: () => {}, closeEmbeddedRun: () => {},
  loadToday: () => {}, openLeaderboardForRunDate: () => {}, clearOverlay: () => {},
  retryFinalSubmission: () => {}, startPractice: () => {},
} as never;

function between(playerGamesWon: number, fritzGamesWon: number) {
  return buildDailyFritzSetOverlayViewModel(
    { kind: 'between', completedGame: game(1, 65, 33),
      setResult: { version: 2, format: 'best_of_3', playerGamesWon, fritzGamesWon,
        totalPointDiff: 32, games: [game(1, 65, 33)], setWinner: null,
        hasSkunk: false, instantSkunk: false },
      nextGameNumber: 2 } as never,
    actions,
    { todayRunDate: '2026-08-26' },
  );
}

describe('interstitial standing chip', () => {
  it('names who leads', () => {
    expect(between(1, 0).standing).toBe('You lead 1-0');
    expect(between(0, 1).standing).toBe('Fritz leads 1-0');
  });

  it('calls a level set all square', () => {
    expect(between(1, 1).standing).toBe('All square 1-1');
  });

  it('stamps the run id from the day in context', () => {
    expect(between(1, 0).runId).toBe('DF-2026-08-26');
  });
});
