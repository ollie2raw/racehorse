import type { ReviewWorkerLike } from './runReviewBatchPool';

/**
 * perf/review-batch-worker-pool: the browser half of the pool's
 * environment-appropriate primitive split. Spawns another instance of the
 * exact same B5 reviewWorker.ts entry point useReviewWorkerBatch.ts's
 * single-worker host already uses -- a pool of N of these, not a second
 * worker implementation. Not imported by any Node code path (this file
 * uses `new Worker(...)`, a browser-only global), so it's safe for Vite to
 * bundle without pulling in worker_threads.
 */
export function createBrowserReviewWorker(): ReviewWorkerLike {
  return new Worker(new URL('./reviewWorker.ts', import.meta.url), { type: 'module' }) as unknown as ReviewWorkerLike;
}
