/**
 * What the device's quick review costs on REAL game positions (the recorded self-play corpus), with the production quick budget.
 *   npx tsx scripts/measureQuickReview.ts [count=60]
 * One thread, no worker pool: the pool divides this by up to QUICK_REVIEW_MAX_WORKERS. Compare the server's per-decision cost in
 * packages/review-engine/src/devtools/measureRealGameReviewCost.ts.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { replayRecordedSelfPlay } from '../../packages/review-engine/src/devtools/replayRecordedSelfPlay';
import { runReviewBatch } from '../src/modules/review/runReviewBatch';
import { DEFAULT_REVIEW_COVERAGE_THRESHOLD, QUICK_REVIEW_DISPATCH_BUDGET } from '../src/modules/review/reviewEngineConfig';

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../packages/review-engine/fixtures/recorded-self-play');
const wanted = Number(process.argv[2] ?? '60');
const pool = replayRecordedSelfPlay(dir).filter(({ snapshot }) => snapshot.legalActions.length > 1);
const stride = Math.max(1, Math.floor(pool.length / wanted));
const snapshots = pool.filter((_, i) => i % stride === 0).slice(0, wanted).map(({ snapshot }) => snapshot);

const perDecision: number[] = [];
let last = performance.now();
let errors = 0;
const started = performance.now();
runReviewBatch(snapshots, QUICK_REVIEW_DISPATCH_BUDGET, DEFAULT_REVIEW_COVERAGE_THRESHOLD, {
  onResult: () => {
    const now = performance.now();
    perDecision.push(now - last);
    last = now;
  },
  onError: () => { errors += 1; },
  onDone: () => undefined,
  isCancelled: () => false,
});
const total = performance.now() - started;
const sorted = [...perDecision].sort((a, b) => a - b);
const pick = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!.toFixed(0);
process.stdout.write(`${snapshots.length} real decisions, ${errors} errors\n`);
process.stdout.write(`per decision: mean ${(total / snapshots.length).toFixed(0)} ms, p50 ${pick(0.5)}, p90 ${pick(0.9)}, max ${sorted[sorted.length - 1]!.toFixed(0)}\n`);
process.stdout.write(`${snapshots.length} decisions on one thread: ${(total / 1000).toFixed(1)} s; with 4 workers about ${(total / 4000).toFixed(1)} s\n`);
