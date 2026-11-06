/**
 * Kill switch (#318, kept by the worker-isolation fix). Off unless REVIEW_SWEEP_ENABLED is exactly "true". Off means no periodic sweep and no kick on
 * enqueue; jobs are still accepted and stay queued until the sweep is turned back on, and the job route reports them `unavailable` ("sweep_disabled").
 *
 * Its own module so /health can report it without importing the whole worker.
 */
export function isReviewSweepEnabled(): boolean {
  return process.env.REVIEW_SWEEP_ENABLED === 'true';
}
