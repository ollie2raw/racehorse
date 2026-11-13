/**
 * Honest labelling of a sampled review verdict that was cut short (packages/review-engine/src/partialSearch.ts, docs/review-partial-honesty-2026-11-08.md). Off unless
 * REVIEW_CUT_HONESTY_ENABLED is exactly "true"; off means every review decision is evaluated exactly as before. On, a sampled verdict that the wall-clock ceiling or a node
 * budget cut short carries `partialSearch` (partial = true and a 95% loss interval of the played move), and the review shows a severity badge (or "Best") for it only when that
 * interval lies inside one grade band; otherwise its confidence is 'low' and it has no badge. A run cut before its halfway sample is no longer accepted as "stability-converged".
 * Read per call, so a test can flip it; Render restarts the service when the variable changes.
 *
 * Its own module, like reviewBoundedExactFlag.ts, so /health or a test can read it without importing the whole worker.
 */
export function isReviewCutHonestyEnabled(): boolean {
  return process.env.REVIEW_CUT_HONESTY_ENABLED === 'true';
}

/**
 * The options one review position is evaluated with. Flag off: the very same object, untouched (so the evaluation is exactly what it was before the flag existed). Flag on:
 * the same options plus `cutHonesty: true` (a plain object, so it crosses the worker-thread boundary).
 */
export function withCutHonestyOption<T extends object | undefined>(options: T): T | (NonNullable<T> & { readonly cutHonesty: true }) {
  return isReviewCutHonestyEnabled() ? { ...(options ?? {}), cutHonesty: true } as NonNullable<T> & { readonly cutHonesty: true } : options;
}
