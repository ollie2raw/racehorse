/**
 * The laptop half of the server's one-time CPU benchmark: the SAME fixed snapshot (server/workers/reviewBenchmark.snapshot.json), the SAME budget (100 sampled
 * hidden hands, 200,000 nodes, 2 plies, seed 'review-cpu-benchmark') and the same 20 runs the worker thread runs on the instance about 30 s after boot. The
 * production median divided by this median is the instance's slowdown factor (reviewSweepStatus.decisionCost.benchmark on /health).
 *   npx tsx packages/review-engine/src/devtools/measureServerBenchmarkOnLaptop.ts [runs=20]
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import type { ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import { evaluateReviewPosition } from '../evaluateReviewPosition';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const snapshot = JSON.parse(readFileSync(resolve(ROOT, 'server/workers/reviewBenchmark.snapshot.json'), 'utf8')) as ReviewPositionSnapshotV2;
const runs = Number(process.argv[2] ?? '20');
const budget = { maxNodes: 200_000, maxHiddenStateSamples: 100, maxPlyDepth: 2, seed: 'review-cpu-benchmark', maxWallClockMs: 30_000 };

// one warm-up (JIT), not counted, then the counted runs exactly as the worker does them
evaluateReviewPosition(snapshot, budget, 0.02);
const times: number[] = [];
const started = performance.now();
for (let i = 0; i < runs; i += 1) {
  const t0 = performance.now();
  evaluateReviewPosition(snapshot, budget, 0.02);
  times.push(performance.now() - t0);
}
const total = performance.now() - started;
times.sort((a, b) => a - b);
process.stdout.write(
  `${snapshot.identifiers.decisionId}: ${runs} runs at 100 samples: median ${times[Math.floor(times.length / 2)]!.toFixed(1)} ms, min ${times[0]!.toFixed(1)}, max ${times[times.length - 1]!.toFixed(1)}, total ${total.toFixed(0)} ms\n`,
);
