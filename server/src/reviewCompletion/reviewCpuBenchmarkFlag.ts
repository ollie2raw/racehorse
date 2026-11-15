/**
 * The boot CPU benchmark (a fixed review position searched 20 times in the review worker thread, about 30 s after boot).
 * Off unless REVIEW_CPU_BENCHMARK_ENABLED is exactly "true": it is a diagnostic only (its result is shown on the review
 * cost snapshot and nothing reads it to schedule or budget work), and it burns CPU in the first minute after a deploy,
 * when live rooms are reconnecting. Read per call; Render restarts the service when the variable changes.
 *
 * Its own module, like reviewBoundedExactFlag.ts, so a test can read it without importing the whole worker.
 */
export function isReviewCpuBenchmarkEnabled(): boolean {
  return process.env.REVIEW_CPU_BENCHMARK_ENABLED === 'true';
}
