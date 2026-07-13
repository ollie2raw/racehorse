import { describe, expect, it } from 'vitest';
import { createEmptyPlayerIdentityModel } from './playerIdentityNormalization';
import { derivePlayerIdentity, derivePlayerIdentityMilestones } from './playerIdentityDerivation';

describe('player identity derivation', () => {
  it('derives only milestones supported by available data', () => {
    const base = createEmptyPlayerIdentityModel(100);
    const model = derivePlayerIdentity({
      ...base,
      competitive: { ...base.competitive, rating: 1000, peakRating: 1100, rankedGames: 12, bestStreak: 4 },
      puzzle: { ...base.puzzle, bestScore: 90 },
      learning: { ...base.learning, completedNodes: 3, totalNodes: 8 },
    });
    expect(model.milestones).toEqual([
      { type: 'rating_peak', value: 1100, achieved: false },
      { type: 'best_streak', value: 4, achieved: true },
      { type: 'ranked_games', value: 12, achieved: true },
      { type: 'puzzle_best', value: 90, achieved: true },
      { type: 'journey_progress', completed: 3, total: 8, achieved: false },
    ]);
    expect(derivePlayerIdentityMilestones(base)).toEqual([]);
  });

  it('does not create personality titles or arbitrary thresholds', () => {
    const model = derivePlayerIdentity(createEmptyPlayerIdentityModel(100));
    expect(model).not.toHaveProperty('title');
    expect(model.milestones).toEqual([]);
  });
});
