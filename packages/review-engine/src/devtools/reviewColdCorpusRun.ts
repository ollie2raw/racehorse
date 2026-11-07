/**
 * Phase A1 of docs/review-performance-measurement-2026-11-07.md: every NON-FORCED decision of the recorded corpus, evaluated COLD (no recorded starting result: the
 * server drops client-sent evaluations and creates every row with tierReached null) exactly as the server's durable pass calls the evaluator
 * (durableReviewCompletionRuntime.ts:583): adaptiveEvaluateReviewPosition(snapshot, { startTier, maxTier: 4, phase: 'completion', allowProgressiveBeyondTier: true,
 * progressiveSampleOffset: 0 }). startTier 1 is the server's real cold start (row.tierReached ?? 1).
 *
 * Each decision runs in a worker thread that is killed after the server's per-position limit (REVIEW_COMPLETION_POSITION_TIMEOUT_MS, 180 s), as ReviewSearchRunner
 * does; a killed decision is recorded as { killed: true } (on the server: FAILED_RETRYABLE, attempt + 1, and after 5 attempts the job is failed_fatal).
 *
 * One JSON line per decision. Shards split the decisions by index (shard i of n takes index % n === i). All of it is bot play (two recorded policies, 5 games each).
 *   npx tsx packages/review-engine/src/devtools/reviewColdCorpusRun.ts <startTier 1|2> <outPath> [shard=0] [shards=1] [limitMs=180000]
 */
import { appendFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { splitOf } from './corpusSplit';

const startTier = Number(process.argv[2] ?? '1');
const outPath = resolve(process.argv[3] ?? '/tmp/review-cold-run.jsonl');
const shard = Number(process.argv[4] ?? '0');
const shards = Number(process.argv[5] ?? '1');
const limitMs = Number(process.argv[6] ?? '180000');
const workerFile = fileURLToPath(new URL('./reviewColdWorker.ts', import.meta.url));


type Row = Record<string, unknown> & { index: number; gameId: string };

function spawn(): Promise<{ worker: Worker; count: number }> {
  return new Promise((resolveSpawn, reject) => {
    const worker = new Worker(workerFile, { workerData: { startTier }, execArgv: ['--import', 'tsx'] });
    worker.once('error', reject);
    worker.once('message', (message: { ready: boolean; count: number }) => resolveSpawn({ worker, count: message.count }));
  });
}

function evaluate(worker: Worker, index: number): Promise<Row | null> {
  return new Promise((resolveEval) => {
    const timer = setTimeout(() => { void worker.terminate(); resolveEval(null); }, limitMs);
    worker.once('message', (row: Row) => { clearTimeout(timer); resolveEval(row); });
    worker.once('error', () => { clearTimeout(timer); resolveEval(null); });
    worker.postMessage(index);
  });
}

async function main(): Promise<void> {
  writeFileSync(outPath, '');
  let { worker, count } = await spawn();
  let done = 0;
  let killed = 0;
  for (let index = shard; index < count; index += shards) {
    const started = performance.now();
    const row = await evaluate(worker, index);
    if (row) {
      appendFileSync(outPath, `${JSON.stringify({ ...row, split: splitOf(row.gameId), killed: false })}\n`);
    } else {
      killed += 1;
      appendFileSync(outPath, `${JSON.stringify({ index, killed: true, ms: Math.round(performance.now() - started) })}\n`);
      // the worker was terminated: replay the corpus again in a fresh one
      ({ worker } = await spawn());
    }
    done += 1;
    if (done % 25 === 0) process.stderr.write(`shard ${shard}: ${done} done, ${killed} killed\n`);
  }
  await worker.terminate();
  process.stdout.write(`shard ${shard}/${shards}: ${done} decisions (startTier ${startTier}), ${killed} killed at ${limitMs} ms -> ${outPath}\n`);
}

void main();
