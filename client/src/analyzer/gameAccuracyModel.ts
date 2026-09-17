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

/** Spec section 6's additive GameAnalysis field contract, exactly as specced. */
export type GameAccuracyModelResult =
  | {
      readonly status: 'complete';
      readonly accuracyModelVersion: string;
      readonly accuracy: number; // 0-100, from accuracyFromEvaluations
      readonly grade: 'S' | 'A' | 'B' | 'C' | 'D'; // derived from the new accuracy, not the legacy one
    }
  | {
      readonly status: 'partial';
      readonly accuracyModelVersion: string;
      readonly accuracy: null;
      readonly grade: null;
      /** How many non-forced decisions were heuristic-tier -- the reason this is partial. */
      readonly heuristicMoveCount: number;
      /** Total non-forced (scorable-or-heuristic) decisions in scope, for "X of Y moves" copy. */
      readonly totalNonForcedMoveCount: number;
    };

/**
 * Spec section 6's cutover trigger, precisely: among all decisions in
 * `evaluations` that are NOT forced, if ANY has `evidence.source ===
 * 'heuristic'`, the result is `partial`. Only when ZERO non-forced
 * decisions are heuristic-tier does the result become `complete`. Forced
 * decisions are excluded from this check either way (they don't affect it)
 * -- same forced predicate as `isScorable`/`lossBandLabelForEvaluation`.
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

  if (heuristicMoveCount > 0) {
    return {
      status: 'partial',
      accuracyModelVersion: ACCURACY_MODEL_VERSION,
      accuracy: null,
      grade: null,
      heuristicMoveCount,
      totalNonForcedMoveCount: nonForced.length,
    };
  }

  const result = accuracyFromEvaluations(evaluations);
  if (result.status !== 'computed') {
    // Spec section 6's binary complete/partial trigger has no slot for
    // "zero non-forced decisions were even in scope" (e.g. a hand played
    // entirely with forced moves) -- `complete` requires a real `accuracy`
    // number, which accuracyFromEvaluations cannot produce here. Honest
    // 'partial' with 0-of-0 counts (a real, accurate "0 of 0 moves
    // reviewed"), not a fabricated 'complete'.
    return {
      status: 'partial',
      accuracyModelVersion: ACCURACY_MODEL_VERSION,
      accuracy: null,
      grade: null,
      heuristicMoveCount: 0,
      totalNonForcedMoveCount: 0,
    };
  }

  return {
    status: 'complete',
    accuracyModelVersion: result.accuracyModelVersion,
    accuracy: result.accuracy,
    grade: gradeFromAccuracy(result.accuracy),
  };
}
