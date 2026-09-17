import { dedupeCandidatesByTile } from '@racehorse/game-core/review';
import type { ReviewCandidateEvaluationV1, ReviewEvaluationV1 } from '@racehorse/game-core/review';
import { ACCURACY_MODEL_CALIBRATION_VERSION, CALIBRATED_K } from './accuracyModelCalibration';

/**
 * C0 spec (docs/scoping/phase-c-accuracy-model-spec.md), section 3. HISTORICAL
 * -- kept for the tests that exercise the mapping's structural properties
 * (monotonicity, ceiling, floor separation, invariances) using a fixed,
 * non-degenerate constant, and as a record of what shipped before C2/C4's
 * calibration and cutover. `accuracyFromEvaluations` no longer defaults to
 * this: its live default is now `CALIBRATED_K` (C4,
 * accuracyModelCalibration.ts), fit against real data and signed off. Do
 * not read this as the production value -- it never was calibrated, and
 * MUST NOT be treated as a real number by any test that asserts a specific
 * accuracy value.
 */
export const UNCALIBRATED_DEFAULT_K = 0.1;

/**
 * C4 (phase-c-accuracy-model-spec.md section 3's "never silently"
 * versioning rule): this is now literally `ACCURACY_MODEL_CALIBRATION_VERSION`
 * (accuracyModelCalibration.ts) -- one source of truth, so the two can
 * never drift apart. Bumped whenever `CALIBRATED_K` or
 * `LOSS_BAND_BOUNDARIES` changes (re-fit against new data, or a change to
 * the fitting method itself) -- always change accuracyModelCalibration.ts,
 * never this constant directly.
 */
export const ACCURACY_MODEL_VERSION: string = ACCURACY_MODEL_CALIBRATION_VERSION;

/**
 * C0 spec section 2: a decision counts toward headline accuracy only if it
 * is neither forced (there was only one real choice) nor heuristic-only
 * (the evaluation never cleared the coverage bar for a real point-
 * differential estimate). Exported so C2 (histogram computation) and C4
 * (cutover condition) can both reuse this exact predicate rather than each
 * re-deriving their own notion of "scorable."
 */
export function isScorable(
  evaluation: ReviewEvaluationV1,
  candidates: readonly ReviewCandidateEvaluationV1[],
): boolean {
  const forced = dedupeCandidatesByTile(candidates).length === 1;
  const heuristicOnly = evaluation.evidence.source === 'heuristic';
  return !forced && !heuristicOnly;
}

export type AccuracyResult =
  | { readonly status: 'no-scorable-decisions' }
  | {
      readonly status: 'computed';
      readonly accuracy: number;
      readonly scorableCount: number;
      readonly accuracyModelVersion: string;
    };

/**
 * C0 spec sections 1-3. Computes headline accuracy as a bounded exponential
 * decay of the mean loss over scorable decisions only (forced and
 * heuristic-only decisions are excluded from both numerator and
 * denominator, per `isScorable`). Returns a discriminated result rather
 * than a bare number so the empty-denominator case (every decision in
 * scope was forced or heuristic-only) is representable instead of
 * fabricated as 0 or 100.
 *
 * `k` defaults to `CALIBRATED_K` (C4) -- the real, signed-off, fitted
 * value, not a placeholder. Callers needing the pre-calibration constant
 * for a structural/property test may still pass `UNCALIBRATED_DEFAULT_K`
 * explicitly.
 */
export function accuracyFromEvaluations(
  evaluations: readonly ReviewEvaluationV1[],
  k: number = CALIBRATED_K,
): AccuracyResult {
  const scorableLosses = evaluations
    .filter((evaluation) => isScorable(evaluation, evaluation.candidates))
    .map((evaluation) => evaluation.loss.expectedPointDifferential);

  if (scorableLosses.length === 0) {
    return { status: 'no-scorable-decisions' };
  }

  const meanLoss = scorableLosses.reduce((sum, loss) => sum + loss, 0) / scorableLosses.length;
  const accuracy = clamp(100 * Math.exp(-k * meanLoss), 0, 100);

  return {
    status: 'computed',
    accuracy,
    scorableCount: scorableLosses.length,
    accuracyModelVersion: ACCURACY_MODEL_VERSION,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
