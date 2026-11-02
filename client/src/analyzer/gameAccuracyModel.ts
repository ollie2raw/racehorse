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

/** A loss-band label as PRESENTED: the four bands plus the milder `Good` a verdict softens to when the second opinion does not confirm it. */
export type PresentedLabel = LossBandLabel | 'Good';

/**
 * One grade softer, the way chess.com gives the milder grade when its engine is unsure instead of an accusation (or a "Best") it cannot
 * back. Inaccuracy -> Good, Mistake and Blunder -> Inaccuracy, Best -> Good.
 */
const SOFTER_LABEL: Readonly<Record<LossBandLabel, PresentedLabel>> = {
  Best: 'Good',
  Inaccuracy: 'Good',
  Mistake: 'Inaccuracy',
  Blunder: 'Inaccuracy',
};

/**
 * The label to SHOW. Equal to the loss-band label unless the whole-hand second opinion (docs/review-quality-baseline-2026-11-02.md
 * section 7) did not confirm the verdict, in which case it is one grade softer. The loss, the bands and the accuracy number are
 * unchanged: this only moves what the player is told. A verdict of a different kind than the label (an error opinion on a move whose
 * loss is within the Best tolerance) is not softened.
 */
export function presentedLabelForEvaluation(
  evaluation: ReviewEvaluationV1,
  boundaries: CalibratedLossBandBoundaries = LOSS_BAND_BOUNDARIES,
): PresentedLabel | null {
  const label = lossBandLabelForEvaluation(evaluation, boundaries);
  if (!label) return null;
  const opinion = evaluation.secondOpinion;
  if (!opinion || opinion.verdict !== 'unconfirmed') return label;
  const applies = opinion.kind === 'best' ? label === 'Best' : label !== 'Best';
  return applies ? SOFTER_LABEL[label] : label;
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
