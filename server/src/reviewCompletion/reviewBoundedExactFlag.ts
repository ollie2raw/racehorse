/**
 * The bounded exact path (packages/review-engine/src/boundedExactSearch.ts, docs/review-bounded-path-prereport-2026-11-07.md). Off unless REVIEW_BOUNDED_EXACT_ENABLED is exactly
 * "true"; off means every review decision is evaluated exactly as before the path existed. On, a decision whose hidden-hand space is 8,000 or fewer is searched by visiting the
 * distinct hands once each in a seeded random order (stopping when the verdict is settled, with a node cap and an interval on a capped answer) instead of drawing C(n,k) hands
 * with replacement. Read per call, so a test can flip it; Render restarts the service when the variable changes.
 *
 * Its own module, like reviewSweepFlag.ts, so /health or a test can read it without importing the whole worker.
 */
export function isReviewBoundedExactEnabled(): boolean {
  return process.env.REVIEW_BOUNDED_EXACT_ENABLED === 'true';
}

/**
 * The options one review position is evaluated with. Flag off: the very same object, untouched (so the evaluation is exactly what it was before the path existed). Flag on:
 * the same options plus `boundedExact` (the tuned defaults of boundedExactSearch.ts; a plain object, so it crosses the worker-thread boundary).
 */
export function withBoundedExactOption<T extends object | undefined>(options: T): T | (NonNullable<T> & { readonly boundedExact: Record<string, never> }) {
  return isReviewBoundedExactEnabled() ? { ...(options ?? {}), boundedExact: {} } as NonNullable<T> & { readonly boundedExact: Record<string, never> } : options;
}
