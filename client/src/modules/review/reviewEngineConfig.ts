import type { ReviewDispatchBudget } from '@racehorse/review-engine';

/**
 * Client-side default budget/threshold config for review computation
 * (B5, game-review-oracle-upgrade-2026-09-13.md). No such default existed
 * before this file -- previously only test files constructed budgets
 * ad hoc. Values here are the same provisional numbers the B-integration
 * research settled on (PR #227), not re-derived: coverageThreshold 2% is
 * explicitly provisional pending real product/data-review calibration
 * (see issue #226), and maxPlyDepth 2 / maxHiddenStateSamples 100 /
 * maxNodes 200,000 are the budget range that research measured landing
 * comfortably under 100ms per decision on real fixtures.
 *
 * `seed` is a fixed string rather than per-call randomness so a batch's
 * results are byte-stable across runs (matching every solver's own
 * determinism convention) -- callers that need per-request variation
 * should override it explicitly, not rely on this default doing so.
 */
export const DEFAULT_REVIEW_DISPATCH_BUDGET: ReviewDispatchBudget = {
  maxNodes: 200_000,
  maxHiddenStateSamples: 100,
  maxPlyDepth: 2,
  seed: 'racehorse-review-default-seed',
};

export const DEFAULT_REVIEW_COVERAGE_THRESHOLD = 0.02;

/**
 * F4b: per-decision wall-clock safety ceiling lives on
 * `ReviewDispatchBudget.maxWallClockMs` (optional). When omitted,
 * `@racehorse/review-engine`'s `DEFAULT_REVIEW_WALL_CLOCK_CEILING_MS` (2000)
 * applies inside `evaluateReviewPosition`. Intentionally NOT set on
 * {@link DEFAULT_REVIEW_DISPATCH_BUDGET} so production search node/sample/ply
 * budgets stay unchanged and F4a byte-identity tests keep comparing the same
 * budget object shape; the engine default is the documented ceiling.
 */

/**
 * F4a default browser worker-pool size. Lives here (not in
 * useReviewWorkerBatch) so callers that mock the hook module still get this
 * pure hardware-derived number. Cap 8; fallback 4 when navigator is absent.
 * Does not change search budgets or coverage thresholds.
 */
export function defaultReviewWorkerPoolSize(): number {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined;
  return Math.max(1, Math.min(cores && cores > 0 ? cores : 4, 8));
}
