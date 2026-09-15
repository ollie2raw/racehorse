import { runReviewBatch } from './runReviewBatch';
import type { ReviewWorkerRequest, ReviewWorkerResponse } from './reviewWorkerTypes';

/**
 * B5 (game-review-oracle-upgrade-2026-09-13.md): the actual worker entry
 * point. Deliberately thin -- self.onmessage/postMessage plumbing only,
 * everything real lives in runReviewBatch.ts (fully unit-tested there).
 * This file cannot run under vitest (no real Worker global scope) and is
 * not covered by the test suite; keep it a 1:1 mapping of runReviewBatch's
 * callbacks to postMessage calls so there is nothing here worth testing in
 * isolation.
 *
 * Not wired to any host yet (no caller in this PR) -- a future host spawns
 * this with `new Worker(new URL('./reviewWorker.ts', import.meta.url),
 * { type: 'module' })` per Vite's native worker convention.
 */
let cancelled = false;

function postResponse(response: ReviewWorkerResponse): void {
  self.postMessage(response);
}

self.onmessage = (event: MessageEvent<ReviewWorkerRequest>) => {
  const request = event.data;

  if (request.type === 'cancel') {
    cancelled = true;
    return;
  }

  cancelled = false;
  runReviewBatch(request.snapshots, request.budget, request.coverageThreshold, {
    onResult: (decisionId, evaluation) => postResponse({ type: 'result', decisionId, evaluation }),
    onError: (decisionId, message) => postResponse({ type: 'error', decisionId, message }),
    onDone: () => postResponse({ type: 'done' }),
    isCancelled: () => cancelled,
  });
};
