import { dedupeCandidatesByTile } from '@racehorse/game-core/review';
import type { ReviewCandidateEvaluationV1, ReviewEvaluationV1 } from '@racehorse/game-core/review';

/**
 * C0 spec (docs/scoping/phase-c-accuracy-model-spec.md), section 3. The map
 * from mean loss to a 0-100 accuracy score. `k` is the model's single free
 * parameter -- calibrated by C2 against real loss histograms, not guessed
 * here. This value is a provisional placeholder ONLY, chosen so the
 * exponential decay has a sane, non-degenerate shape (k too close to 0
 * flattens the curve toward a constant 100; k too large collapses it toward
 * 0 for almost any nonzero loss) while property tests are being written
 * against it. It carries no calibration meaning and MUST NOT be treated as
 * a real number by any test that asserts a specific accuracy value -- only
 * by tests that check relative/structural properties (monotonicity,
 * ceiling, floor separation, invariances). C2 will overwrite this.
 */
export const UNCALIBRATED_DEFAULT_K = 0.1;

/**
 * Bumped whenever `UNCALIBRATED_DEFAULT_K` (or, later, its calibrated
 * replacement) or the functional form in `accuracyFromEvaluations` changes,
 * per C0 spec section 3. The `-uncalibrated` suffix marks this as the
 * pre-C2 version; C2 mints a new version string alongside its real `k`.
 */
export const ACCURACY_MODEL_VERSION = 'accuracy-model-v1-uncalibrated';

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
 */
export function accuracyFromEvaluations(
  evaluations: readonly ReviewEvaluationV1[],
  k: number = UNCALIBRATED_DEFAULT_K,
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
