import type { RoundScore } from './types';

const BASE_SCORES = [500, 800, 1200, 1800, 2500];
const MAX_SPEED_BONUS = 500;
const SPEED_DECAY_SECONDS = 120;
const MAX_OPTIMALITY_BONUS = 1000;

export function scoreRound(
  round: number,
  timeTakenMs: number,
  playerScore: number,
  optimalScore: number,
): RoundScore {
  const baseScore = BASE_SCORES[Math.max(0, Math.min(BASE_SCORES.length - 1, round - 1))] ?? 500;

  const timeTakenSec = Math.max(0, timeTakenMs) / 1000;
  const speedBonus = Math.max(
    0,
    Math.round(MAX_SPEED_BONUS * (1 - timeTakenSec / SPEED_DECAY_SECONDS)),
  );

  const denominator = Math.max(1, optimalScore);
  const optimalityPct = Math.min(1.0, Math.max(0, playerScore / denominator));
  const optimalityBonus = Math.round(MAX_OPTIMALITY_BONUS * optimalityPct);

  return {
    baseScore,
    speedBonus,
    optimalityPct,
    optimalityBonus,
    total: baseScore + speedBonus + optimalityBonus,
  };
}

export function getGauntletMultiplier(roundsCompleted: number): number {
  const multipliers = [1.0, 1.0, 1.0, 1.15, 1.35];
  return multipliers[roundsCompleted - 1] ?? 1.0;
}
