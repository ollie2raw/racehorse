/**
 * Canonical Circuit scoring formula — owned by @racehorse/game-core.
 *
 * points = round(baseDifficulty * gradeMultiplier * comboBoost)
 *   baseDifficulty   = 100 * difficulty (1–5)
 *   gradeMultiplier  = optimal 1.0 | strong 0.7 | inaccurate 0.2 | blunder 0
 *   comboBoost       = 1 + min(comboBefore, 8) * 0.12
 *   combo increments on optimal/strong; resets on inaccurate/blunder
 *
 * Decision-speed bonuses are intentionally NOT used (timing is unreliable).
 * Illegal / rejected interactions award 0 points and must not change combo.
 */

import type { CircuitDecisionGrade } from './circuitEvaluate';

export const CIRCUIT_MAX_STRIKES = 3;

export function computeCircuitDecisionPoints(input: {
  grade: CircuitDecisionGrade;
  difficulty: number;
  comboBefore: number;
}): { points: number; nextCombo: number } {
  const clampedDifficulty = Math.min(5, Math.max(1, Math.floor(input.difficulty)));
  const base = 100 * clampedDifficulty;
  const comboBefore = Math.max(0, Math.floor(input.comboBefore));

  let multiplier = 0;
  let nextCombo = 0;
  switch (input.grade) {
    case 'optimal':
      multiplier = 1;
      nextCombo = comboBefore + 1;
      break;
    case 'strong':
      multiplier = 0.7;
      nextCombo = comboBefore + 1;
      break;
    case 'inaccurate':
      multiplier = 0.2;
      nextCombo = 0;
      break;
    case 'blunder':
      multiplier = 0;
      nextCombo = 0;
      break;
  }

  const comboBoost = 1 + Math.min(comboBefore, 8) * 0.12;
  const points = Math.round(base * multiplier * comboBoost);
  return { points, nextCombo };
}
