import { isForcedDecision } from '@racehorse/game-core/review';
import type { ReviewEvaluationV1 } from '@racehorse/game-core/review';
import { LOSS_BAND_BOUNDARIES, type CalibratedLossBandBoundaries } from '@racehorse/review-engine';

/**
 * D5 (docs/scoping/game-review-oracle-upgrade-2026-09-13.md, Phase D): the
 * per-move loss-band label function GameReviewer wires into its
 * exact/search-evidence rendering. Kept client-side deliberately --
 * label/badge presentation policy, same reasoning as
 * classifyHeuristicResult.ts's own bucket policy.
 */

/** Spec section 4a's four ordinal loss-band labels. */
export type LossBandLabel = 'Best' | 'Inaccuracy' | 'Mistake' | 'Blunder';

/**
 * Spec section 4a: `moveLoss` mapped onto the four ordinal bands via the
 * three calibrated boundaries. Boundaries are inclusive on their lower
 * (better) side -- a `moveLoss` exactly at a boundary falls into the
 * better band, matching the spec's own "within a small, calibrated
 * tolerance of 0" wording for `Best` (a tolerance is a `<=`, not a strict
 * `<`).
 */
export function lossBandLabel(
  moveLoss: number,
  boundaries: CalibratedLossBandBoundaries = LOSS_BAND_BOUNDARIES,
): LossBandLabel {
  if (moveLoss <= boundaries.bestTolerance) return 'Best';
  if (moveLoss <= boundaries.inaccuracyToMistake) return 'Inaccuracy';
  if (moveLoss <= boundaries.mistakeToBlunder) return 'Mistake';
  return 'Blunder';
}

/**
 * Spec section 4a: labels only apply to scorable decisions -- a forced
 * (action-level) or heuristic-only decision gets no loss-band label.
 */
export function lossBandLabelForEvaluation(
  evaluation: ReviewEvaluationV1,
  boundaries: CalibratedLossBandBoundaries = LOSS_BAND_BOUNDARIES,
): LossBandLabel | null {
  const forced = isForcedDecision(evaluation.candidates);
  const heuristicOnly = evaluation.evidence.source === 'heuristic';
  if (forced || heuristicOnly) return null;
  return lossBandLabel(evaluation.loss.expectedPointDifferential, boundaries);
}
