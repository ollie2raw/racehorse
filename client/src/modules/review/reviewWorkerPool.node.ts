/// <reference types="node" />
import { Worker } from 'node:worker_threads';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ReviewWorkerLike } from './runReviewBatchPool';
import type { ReviewWorkerRequest, ReviewWorkerResponse } from './reviewWorkerTypes';

const WORKER_URL = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), 'reviewWorkerNodeBootstrap.mjs'));

/**
 * perf/review-batch-worker-pool: the Node half of the pool's
 * environment-appropriate primitive split (worker_threads, since Node has
 * no Web Worker global). Used by the devtools measurement script
 * (client/scripts/measureReviewBatchPool.ts) and any future Node-side
 * (server/CI) review batch host.
 *
 * The JavaScript bootstrap registers tsx inside the worker before loading
 * reviewWorkerNode.ts. Loader hooks are established in that worker's own
 * context, without depending on the host's tsx or Vitest loader arguments.
 */
export function createNodeReviewWorker(): ReviewWorkerLike {
  const worker = new Worker(WORKER_URL, {
    execArgv: [],
  });

  const facade: ReviewWorkerLike = {
    postMessage: (message: ReviewWorkerRequest) => worker.postMessage(message),
    terminate: () => {
      void worker.terminate();
    },
    onmessage: null,
    onerror: null,
  };

  // Use addListener (not .on) so architecture INV-07's socket.on scanner
  // does not false-positive on Node worker_threads EventEmitter APIs.
  worker.addListener('message', (data: ReviewWorkerResponse) => {
    facade.onmessage?.({ data });
  });
  worker.addListener('error', (error: unknown) => {
    facade.onerror?.(error);
  });

  return facade;
}
