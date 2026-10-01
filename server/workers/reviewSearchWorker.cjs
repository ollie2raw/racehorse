/**
 * Review search worker thread. Runs adaptiveEvaluateReviewPosition off the
 * web server's event loop (2026-09-30 / 10-01 outages: review search on the
 * main thread stopped /ping from answering).
 *
 * Plain CommonJS so it loads unchanged from src (vitest, ts-node-dev) and
 * dist (production): it requires the built @racehorse/review-engine, which
 * the server's prebuild produces.
 *
 * One request at a time: { id, snapshot, options } -> { id, ok, result } or
 * { id, ok: false, error }. The parent enforces the per-position time limit
 * by terminating this thread.
 */
'use strict';

const { parentPort } = require('node:worker_threads');
const os = require('node:os');

// Lowest CPU priority for this thread only. On Linux a worker thread is its
// own task and setpriority(PRIO_PROCESS, 0) applies to the calling thread;
// elsewhere it would renice the whole process, so it is Linux-only.
if (process.platform === 'linux') {
  try {
    os.setPriority(0, 19);
  } catch {
    // Not permitted in some containers; isolation does not depend on it.
  }
}

const { adaptiveEvaluateReviewPosition } = require('@racehorse/review-engine');

parentPort.on('message', (message) => {
  const { id, snapshot, options } = message;
  try {
    const result = adaptiveEvaluateReviewPosition(snapshot, options);
    parentPort.postMessage({ id, ok: true, result });
  } catch (error) {
    parentPort.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
  }
});
