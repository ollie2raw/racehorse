/// <reference types="node" />
import { parentPort } from 'node:worker_threads';
import { runReviewBatch } from './runReviewBatch';
import type { ReviewWorkerRequest, ReviewWorkerResponse } from './reviewWorkerTypes';

/**
 * perf/review-batch-worker-pool: the Node worker_threads counterpart of
 * reviewWorker.ts (B5's browser Web Worker entry point). Same 1:1
 * request/response mapping onto runReviewBatch -- the only real logic
 * still lives in runReviewBatch.ts, fully unit-tested there. This file is
 * environment plumbing only (parentPort.on/postMessage instead of
 * self.onmessage/postMessage, since worker_threads has no self/Worker
 * global scope), used by the devtools measurement script and any future
 * Node-side (server/CI) review batch host -- never imported by client
 * browser bundle entry points.
 */
if (!parentPort) {
  throw new Error('reviewWorkerNode.ts must run inside a node:worker_threads Worker (no parentPort found).');
}

let cancelled = false;

function postResponse(response: ReviewWorkerResponse): void {
  parentPort!.postMessage(response);
}

parentPort.on('message', (request: ReviewWorkerRequest) => {
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
});
