import type { PlayerIdentityMilestone, PlayerIdentityModel } from './playerIdentityTypes';
import { derivePlayerIdentitySignals } from './playerIdentitySignals';

export type PlayerRatingTier = { label: string; color: string };

export function getPlayerRatingTier(rating: number | null, provisional: boolean | null): PlayerRatingTier {
  if (provisional === true) return { label: 'Provisional', color: 'var(--text-dim)' };
  if (rating != null && rating >= 1600) return { label: 'Master', color: 'var(--tier-master)' };
  if (rating != null && rating >= 1300) return { label: 'Elite', color: 'var(--tier-elite)' };
  if (rating != null && rating >= 1000) return { label: 'Standard', color: 'var(--tier-standard)' };
  return { label: rating == null ? 'Unrated' : 'Rookie', color: rating == null ? 'var(--text-dim)' : 'var(--tier-rookie)' };
}

export function derivePlayerIdentityMilestones(model: PlayerIdentityModel): PlayerIdentityMilestone[] {
  const milestones: PlayerIdentityMilestone[] = [];
  if (model.competitive.rating != null && model.competitive.peakRating != null) {
    milestones.push({ type: 'rating_peak', value: model.competitive.peakRating, achieved: model.competitive.rating >= model.competitive.peakRating });
  }
  if (model.competitive.bestStreak != null) milestones.push({ type: 'best_streak', value: model.competitive.bestStreak, achieved: true });
  if (model.competitive.rankedGames != null) milestones.push({ type: 'ranked_games', value: model.competitive.rankedGames, achieved: true });
  if (model.puzzle.bestScore != null) milestones.push({ type: 'puzzle_best', value: model.puzzle.bestScore, achieved: true });
  if (model.learning.completedNodes != null && model.learning.totalNodes != null) {
    milestones.push({ type: 'journey_progress', completed: model.learning.completedNodes, total: model.learning.totalNodes, achieved: model.learning.totalNodes > 0 && model.learning.completedNodes >= model.learning.totalNodes });
  }
  return milestones;
}

export function derivePlayerIdentity(model: PlayerIdentityModel): PlayerIdentityModel {
  const withMilestones = { ...model, milestones: derivePlayerIdentityMilestones(model) };
  return { ...withMilestones, identitySignals: derivePlayerIdentitySignals(withMilestones) };
}
