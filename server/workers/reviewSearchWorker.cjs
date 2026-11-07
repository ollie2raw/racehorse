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

const fs = require('node:fs');
const path = require('node:path');
const v8 = require('node:v8');
const { performance } = require('node:perf_hooks');
const { adaptiveEvaluateReviewPosition, evaluateReviewPosition } = require('@racehorse/review-engine');

/** CPU this thread used (ms), when Node can tell (process.threadCpuUsage, Node 23.9+); null otherwise, so the parent falls back to process-wide CPU. */
function threadCpuMs() {
  try {
    if (typeof process.threadCpuUsage === 'function') {
      const usage = process.threadCpuUsage();
      return (usage.user + usage.system) / 1000;
    }
  } catch {
    // not available
  }
  return null;
}

/** This worker's own heap against its cap (resourceLimits.maxOldGenerationSizeMb), in MB. */
function heapMb() {
  const stats = v8.getHeapStatistics();
  return { heapUsedMb: Math.round(stats.used_heap_size / 1048576), heapLimitMb: Math.round(stats.heap_size_limit / 1048576) };
}

/**
 * The one-time CPU benchmark: ONE fixed hidden-hand midgame snapshot at 100 sampled hidden hands, run `runs` times, here in the worker thread (so it cannot
 * stall the event loop). Its median ms against the same code on a laptop (measureServerBenchmarkOnLaptop.ts) is the instance's slowdown factor.
 */
function runBenchmark(runs) {
  const snapshot = JSON.parse(fs.readFileSync(path.join(__dirname, 'reviewBenchmark.snapshot.json'), 'utf8'));
  const budget = { maxNodes: 200000, maxHiddenStateSamples: 100, maxPlyDepth: 2, seed: 'review-cpu-benchmark', maxWallClockMs: 30000 };
  const times = [];
  const cpuBefore = threadCpuMs();
  const started = performance.now();
  for (let i = 0; i < runs; i += 1) {
    const t0 = performance.now();
    evaluateReviewPosition(snapshot, budget, 0.02);
    times.push(performance.now() - t0);
  }
  const totalMs = performance.now() - started;
  const cpuAfter = threadCpuMs();
  times.sort((a, b) => a - b);
  return {
    snapshotId: snapshot.identifiers.decisionId,
    runs,
    medianMs: Math.round(times[Math.floor(times.length / 2)] * 10) / 10,
    minMs: Math.round(times[0] * 10) / 10,
    maxMs: Math.round(times[times.length - 1] * 10) / 10,
    totalMs: Math.round(totalMs),
    cpuMs: cpuBefore != null && cpuAfter != null ? Math.round(cpuAfter - cpuBefore) : null,
  };
}

parentPort.on('message', (message) => {
  if (message.type === 'benchmark') {
    try {
      parentPort.postMessage({ id: message.id, ok: true, benchmark: runBenchmark(message.runs || 20) });
    } catch (error) {
      parentPort.postMessage({ id: message.id, ok: false, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) });
    }
    return;
  }
  const { id, snapshot, options } = message;
  try {
    const cpuBefore = threadCpuMs();
    const started = performance.now();
    const result = adaptiveEvaluateReviewPosition(snapshot, options);
    const wallMs = performance.now() - started;
    const cpuAfter = threadCpuMs();
    parentPort.postMessage({
      id,
      ok: true,
      result,
      metrics: { wallMs, threadCpuMs: cpuBefore != null && cpuAfter != null ? cpuAfter - cpuBefore : null, ...heapMb() },
    });
  } catch (error) {
    parentPort.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
  }
});
