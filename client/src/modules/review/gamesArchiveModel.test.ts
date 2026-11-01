import { describe, expect, it } from 'vitest';
import {
  NO_FILTERS,
  computeArchiveStats,
  filterGames,
  formatAccuracy,
  gameResult,
  tiersPresent,
  titleCase,
} from './gamesArchiveModel.ts';
import type { SavedGameSummary } from './savedGames.ts';

let counter = 0;
function game(overrides: Partial<SavedGameSummary> = {}): SavedGameSummary {
  counter += 1;
  return {
    sourceMatchId: `g${counter}`,
    mode: 'pvf',
    fritzTier: 'elite',
    dealSize: 7,
    winningScore: 60,
    result: { you: 61, opponent: 40, winner: 'you' },
    moveCount: 80,
    verification: 'replay_verified',
    playedAt: null,
    savedAt: '2026-11-01T00:00:00.000Z',
    review: null,
    ...overrides,
  };
}
const loss = (overrides: Partial<SavedGameSummary> = {}) => game({ result: { you: 30, opponent: 60, winner: 'opponent' }, ...overrides });
const review = (accuracy: number | null, grade: string | null = null) => ({ id: `r${counter}`, accuracy, grade });

describe('computeArchiveStats', () => {
  it('counts games, wins, losses and the win rate over decided games', () => {
    const stats = computeArchiveStats([game(), game(), loss(), game({ result: { you: 0, opponent: 0, winner: null } })]);
    expect(stats).toMatchObject({ games: 4, wins: 2, losses: 1, winRate: 67 });
  });

  it('has no win rate when nothing was decided, and no average when nothing has an accuracy', () => {
    expect(computeArchiveStats([])).toEqual({ games: 0, wins: 0, losses: 0, winRate: null, reviewed: 0, averageAccuracy: null });
    expect(computeArchiveStats([game({ review: review(null) })])).toMatchObject({ reviewed: 1, averageAccuracy: null });
  });

  it('averages only the accuracies that exist, to one decimal', () => {
    const stats = computeArchiveStats([
      game({ review: review(90) }),
      game({ review: review(81.25) }),
      game({ review: review(null) }),
      game(),
    ]);
    expect(stats.reviewed).toBe(3);
    expect(stats.averageAccuracy).toBe(85.6);
  });

  it('never counts a non-finite accuracy', () => {
    expect(computeArchiveStats([game({ review: review(Number.NaN) })]).averageAccuracy).toBeNull();
  });
});

describe('filterGames', () => {
  const games = [game({ fritzTier: 'rookie' }), loss({ fritzTier: 'master' }), game({ fritzTier: 'master' }), loss({ fritzTier: 'elite' })];

  it('keeps everything with no filters', () => {
    expect(filterGames(games, NO_FILTERS)).toHaveLength(4);
  });

  it('filters by result', () => {
    expect(filterGames(games, { result: 'wins', tier: 'all' }).map(gameResult)).toEqual(['win', 'win']);
    expect(filterGames(games, { result: 'losses', tier: 'all' }).map(gameResult)).toEqual(['loss', 'loss']);
  });

  it('filters by tier, and combines with result', () => {
    expect(filterGames(games, { result: 'all', tier: 'master' })).toHaveLength(2);
    expect(filterGames(games, { result: 'losses', tier: 'master' })).toHaveLength(1);
    expect(filterGames(games, { result: 'wins', tier: 'elite' })).toHaveLength(0);
  });

  it('does not treat an undecided game as a win or a loss', () => {
    const draw = game({ result: { you: 0, opponent: 0, winner: null } });
    expect(filterGames([draw], { result: 'wins', tier: 'all' })).toHaveLength(0);
    expect(filterGames([draw], { result: 'losses', tier: 'all' })).toHaveLength(0);
    expect(filterGames([draw], NO_FILTERS)).toHaveLength(1);
  });
});

describe('tiersPresent', () => {
  it('lists only the tiers that appear, weakest first, then unknown ones alphabetically', () => {
    const games = [game({ fritzTier: 'master' }), game({ fritzTier: 'rookie' }), game({ fritzTier: 'zeta' }), game({ fritzTier: 'master' }), game({ fritzTier: null }), game({ fritzTier: 'alpha' })];
    expect(tiersPresent(games)).toEqual(['rookie', 'master', 'alpha', 'zeta']);
  });
});

describe('formatting', () => {
  it('formats accuracy to one decimal and hides a missing one', () => {
    expect(formatAccuracy(91.234)).toBe('91.2%');
    expect(formatAccuracy(90)).toBe('90%');
    expect(formatAccuracy(null)).toBeNull();
    expect(formatAccuracy(Number.NaN)).toBeNull();
  });

  it('title-cases a tier, with Fritz as the fallback', () => {
    expect(titleCase('elite')).toBe('Elite');
    expect(titleCase(null)).toBe('Fritz');
  });
});
