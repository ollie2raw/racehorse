import { dedupeCandidatesByTile } from '@racehorse/game-core/review';
import type { ReviewEvaluationV1 } from '@racehorse/game-core/review';
import {
  accuracyFromEvaluations,
  LOSS_BAND_BOUNDARIES,
  type CalibratedLossBandBoundaries,
} from '@racehorse/review-engine';
import { ACCURACY_MODEL_VERSION } from '@racehorse/review-engine';
import { gradeFromAccuracy } from './accuracyGrade';

/**
 * C4 (docs/scoping/phase-c-accuracy-model-spec.md, sections 4a and 6): the
 * calibrated accuracy model's client-side consumers. Client-side (not
 * packages/review-engine) for the same reason classifyHeuristicResult.ts's
 * bucket policy already is -- label/grade policy is a presentation
 * concern, review-engine only supplies the calibrated numbers
 * (accuracyFromEvaluations, LOSS_BAND_BOUNDARIES).
 *
 * Nothing in this file is called by analyzeMoveLog (moveAnalyzer.ts) --
 * that function is synchronous and has no access to real per-decision
 * ReviewEvaluationV1 data (that lives in the separate, already-shipped
 * async review-worker pipeline, useReviewWorkerBatch.ts's
 * resultsByDecisionId). A future caller with that data computes and
 * attaches a GameAccuracyModelResult to a GameAnalysis; this file only
 * provides the pure functions to do so.
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
 * Spec section 4a: "these labels only apply to scorable decisions -- a
 * forced or heuristic-only decision gets no loss-band label at all." Reuses
 * the same forced/heuristic predicate `isScorable` (review-engine) and
 * `accuracyFromEvaluations` (C1/C2) already use, not a re-derived notion of
 * "scorable."
 */
export function lossBandLabelForEvaluation(
  evaluation: ReviewEvaluationV1,
  boundaries: CalibratedLossBandBoundaries = LOSS_BAND_BOUNDARIES,
): LossBandLabel | null {
  const forced = dedupeCandidatesByTile(evaluation.candidates).length === 1;
  const heuristicOnly = evaluation.evidence.source === 'heuristic';
  if (forced || heuristicOnly) return null;
  return lossBandLabel(evaluation.loss.expectedPointDifferential, boundaries);
}

/**
 * Minimum fraction of non-forced decisions that must be solver-scorable
 * (non-heuristic) before `accuracy`/`grade` populate at all -- independent
 * of `status` (see the C4 follow-up revision to spec section 6). Derived
 * from the 5th percentile of per-game `coverageFraction` across the
 * 100-game recorded corpus (packages/review-engine/fixtures/
 * recorded-self-play + recorded-client-policy, 2026-09-17 snapshot,
 * spanning daily-fritz-master and pvf-bot-match standard/hard/master
 * tiers): observed range 0.365079-0.696970, mean 0.558783. Not one of
 * those 100 real games ever reached zero heuristic decisions (the
 * original all-or-nothing trigger this floor replaces literally never
 * fired on real data), so this floor is chosen to be cleared by the real
 * distribution instead: the 5th percentile is a direct, nonparametric
 * statement -- 95% of real games already clear it -- rather than the true
 * observed minimum (which would trivially pass every game seen so far and
 * prove nothing) or a parametric choice like mean-minus-two-stddev (which
 * assumes a normality this 100-game sample doesn't need to justify).
 * Re-derive from a re-recorded or meaningfully expanded corpus the same
 * way accuracyModelCalibration.ts's constants are re-derived -- never by
 * hand-picking a rounder number.
 */
export const MINIMUM_COVERAGE_FLOOR = 0.46808510638297873;

/**
 * C4 follow-up (docs/scoping/phase-c-accuracy-model-spec.md, section 6,
 * 2026-09-17 revision): a single flat shape, not a discriminated union --
 * `status` no longer gates which fields are present or whether
 * `accuracy`/`grade` populate. See `computeGameAccuracyModel` below for
 * the actual trigger conditions.
 */
export type GameAccuracyModelResult = {
  /** Diagnostic only -- whether EVERY non-forced decision was solver-scorable. Does NOT gate accuracy/grade below. */
  readonly status: 'complete' | 'partial';
  readonly accuracyModelVersion: string;
  /** Populated whenever coverageFraction >= MINIMUM_COVERAGE_FLOOR, regardless of status. */
  readonly accuracy: number | null;
  /** Derived from the new accuracy, not the legacy one. Null exactly when accuracy is null. */
  readonly grade: 'S' | 'A' | 'B' | 'C' | 'D' | null;
  /** How many non-forced decisions were heuristic-tier. */
  readonly heuristicMoveCount: number;
  /** Total non-forced (scorable-or-heuristic) decisions in scope, for "X of Y moves" copy. */
  readonly totalNonForcedMoveCount: number;
  /** scorableNonForcedCount / totalNonForcedMoveCount; 0 (never NaN) when totalNonForcedMoveCount is 0. The gate for accuracy/grade above -- deliberately the inverse direction of heuristicMoveCount, not a repurposing of it. */
  readonly coverageFraction: number;
};

/**
 * `status`, precisely (unchanged from the original spec section 6 trigger,
 * now diagnostic-only): among all decisions in `evaluations` that are NOT
 * forced, if ANY has `evidence.source === 'heuristic'`, `status` is
 * `'partial'`. Only when ZERO non-forced decisions are heuristic-tier is
 * `status` `'complete'`. Forced decisions are excluded from this check
 * either way -- same forced predicate as
 * `isScorable`/`lossBandLabelForEvaluation`.
 *
 * `accuracy`/`grade`, precisely (the C4 follow-up revision): populated
 * whenever `coverageFraction >= MINIMUM_COVERAGE_FLOOR`, regardless of
 * `status` -- a real game commonly has `status: 'partial'` (some
 * heuristic-tier decisions) while still clearing the coverage floor, in
 * which case a real accuracy/grade is shown rather than suppressed.
 */
export function computeGameAccuracyModel(
  evaluations: readonly ReviewEvaluationV1[],
): GameAccuracyModelResult {
  const nonForced = evaluations.filter(
    (evaluation) => dedupeCandidatesByTile(evaluation.candidates).length > 1,
  );
  const heuristicMoveCount = nonForced.filter(
    (evaluation) => evaluation.evidence.source === 'heuristic',
  ).length;
  const totalNonForcedMoveCount = nonForced.length;
  const scorableNonForcedCount = totalNonForcedMoveCount - heuristicMoveCount;
  const coverageFraction = totalNonForcedMoveCount > 0 ? scorableNonForcedCount / totalNonForcedMoveCount : 0;
  const status: 'complete' | 'partial' =
    heuristicMoveCount === 0 && totalNonForcedMoveCount > 0 ? 'complete' : 'partial';

  const unscored = {
    status,
    accuracyModelVersion: ACCURACY_MODEL_VERSION,
    accuracy: null,
    grade: null,
    heuristicMoveCount,
    totalNonForcedMoveCount,
    coverageFraction,
  } as const;

  if (coverageFraction < MINIMUM_COVERAGE_FLOOR) return unscored;

  const result = accuracyFromEvaluations(evaluations);
  if (result.status !== 'computed') {
    // coverageFraction > 0 implies scorableNonForcedCount > 0 implies
    // isScorable found decisions -- accuracyFromEvaluations returning
    // 'no-scorable-decisions' here would mean these two predicates
    // disagree, which shouldn't happen. Kept as an honest fallback rather
    // than assumed unreachable, same convention as the 0-of-0 case above.
    return unscored;
  }

  return {
    status,
    accuracyModelVersion: result.accuracyModelVersion,
    accuracy: result.accuracy,
    grade: gradeFromAccuracy(result.accuracy),
    heuristicMoveCount,
    totalNonForcedMoveCount,
    coverageFraction,
  };
}
