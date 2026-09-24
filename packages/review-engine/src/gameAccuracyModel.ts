import { isForcedDecision } from '@racehorse/game-core/review';
import type { ReviewEvaluationV1 } from '@racehorse/game-core/review';
import { accuracyFromEvaluations, ACCURACY_MODEL_VERSION, isScorable } from './reviewAccuracy';
import { gradeFromAccuracy } from './accuracyGrade';
import { isEvaluationUnavailable } from './finalizeReviewEvaluations';

/**
 * C4 (docs/scoping/phase-c-accuracy-model-spec.md, sections 4a and 6).
 * Relocated from client/src/analyzer/gameAccuracyModel.ts (E2,
 * docs/scoping/game-review-oracle-upgrade-2026-09-13.md Phase E) so the
 * server can compute the exact same result the client asserts, for
 * reconciliation -- one implementation, not two.
 *
 * `lossBandLabel`/`lossBandLabelForEvaluation` (the per-move label
 * function D5 wired into GameReviewer) deliberately did NOT move with
 * this -- label/badge presentation policy stays client-side
 * (client/src/analyzer/gameAccuracyModel.ts), per classifyHeuristicResult.ts's
 * own established precedent. Only the headline accuracy/grade computation
 * -- the part a server-side reconciliation check actually needs -- moved.
 */

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
  /**
   * Diagnostic: `'complete'` when every non-forced decision is either
   * exact/search-scored or finalized UNAVAILABLE (zero live ESTIMATE
   * residuals). Does NOT gate accuracy/grade below.
   */
  readonly status: 'complete' | 'partial';
  readonly accuracyModelVersion: string;
  /** Populated whenever coverageFraction >= MINIMUM_COVERAGE_FLOOR, regardless of status. */
  readonly accuracy: number | null;
  /** Derived from the new accuracy, not the legacy one. Null exactly when accuracy is null. */
  readonly grade: 'S' | 'A' | 'B' | 'C' | 'D' | null;
  /** How many non-forced decisions remain heuristic ESTIMATE (not unavailable). */
  readonly heuristicMoveCount: number;
  /** Non-forced decisions finalized as UNAVAILABLE (excluded from calibrated accuracy). */
  readonly unavailableMoveCount?: number;
  /** Total non-forced decisions in scope, for "X of Y moves" copy. */
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
 * either way -- same action-level forced predicate as
 * `isScorable`/`lossBandLabelForEvaluation` (`isForcedDecision`).
 *
 * `accuracy`/`grade`, precisely (the C4 follow-up revision): populated
 * whenever `coverageFraction >= MINIMUM_COVERAGE_FLOOR`, regardless of
 * `status` -- a real game commonly has `status: 'partial'` (some
 * heuristic-tier decisions) while still clearing the coverage floor.
 * USER-FACING grade must still be suppressed on partial coverage (see
 * PostGameReviewPrompt); the `grade` field here may populate for
 * reconciliation but must not be presented as a whole-game letter when
 * heuristic estimates remain.
 */
export function computeGameAccuracyModel(
  evaluations: readonly ReviewEvaluationV1[],
): GameAccuracyModelResult {
  const nonForced = evaluations.filter(
    (evaluation) => !isForcedDecision(evaluation.candidates),
  );
  const unavailableMoveCount = nonForced.filter(isEvaluationUnavailable).length;
  const heuristicMoveCount = nonForced.filter(
    (evaluation) =>
      evaluation.evidence.source === 'heuristic' && !isEvaluationUnavailable(evaluation),
  ).length;
  const totalNonForcedMoveCount = nonForced.length;
  const scorableNonForcedCount = nonForced.filter((evaluation) =>
    isScorable(evaluation, evaluation.candidates),
  ).length;
  const coverageFraction = totalNonForcedMoveCount > 0 ? scorableNonForcedCount / totalNonForcedMoveCount : 0;
  // Complete = no residual ESTIMATE. UNAVAILABLE is allowed on a finalized review.
  const status: 'complete' | 'partial' =
    heuristicMoveCount === 0 && totalNonForcedMoveCount > 0 ? 'complete' : 'partial';

  const unscored = {
    status,
    accuracyModelVersion: ACCURACY_MODEL_VERSION,
    accuracy: null,
    grade: null,
    heuristicMoveCount,
    unavailableMoveCount,
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
    // Letter grade is a whole-game claim: only when every non-forced
    // decision was calibrated/scorable (no estimates, no unavailable gaps).
    // Unavailable residuals keep status complete for estimate-accounting but
    // suppress the letter grade — same honesty as partial estimate coverage.
    grade:
      status === 'complete' && unavailableMoveCount === 0
        ? gradeFromAccuracy(result.accuracy)
        : null,
    heuristicMoveCount,
    unavailableMoveCount,
    totalNonForcedMoveCount,
    coverageFraction,
  };
}
