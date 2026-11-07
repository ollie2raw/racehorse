/**
 * Phase A4 of docs/review-performance-measurement-2026-11-07.md: what the review costs ON THE EVENT LOOP, even though the search itself runs in a worker thread. At a
 * throttled CPU (about 0.1 vCPU) every one of these is 10 to 40 times slower and competes with live sockets. For one 76-decision job built from real corpus positions
 * (bot play) it measures, with the production functions:
 *   POST enqueue   JSON.stringify of the 76 snapshots (the request body), sanitizeSnapshotForReview over all of them (reviewCompletionWorker.ts:148)
 *   GET poll       deriveReviewedMoveQuality(job) on the fully scored job (reviewCompletionWorker.ts:635), building the response and JSON.stringify of it, with all evaluations
 *   store read     JSON.parse of that payload (what getSummary does with the database response each poll)
 * Medians of 20 runs after one warm-up. Flags anything over about 20 ms or 200 KB.
 *   npx tsx packages/review-engine/src/devtools/measureMainThreadCosts.ts [gameId] [decisions=76]
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { adaptiveEvaluateReviewPosition } from '../adaptiveEvaluateReviewPosition';
import { createReviewCompletionJob, jobAuthoritativeComplete } from '../durableReviewCompletionRuntime';
import { deriveReviewedMoveQuality } from '../reviewedMoveQuality';
import { sanitizeSnapshotForReview } from '../deriveReviewLegalActions';
import { replayRecordedSelfPlay } from './replayRecordedSelfPlay';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const dir = resolve(ROOT, 'packages/review-engine/fixtures/recorded-self-play');
const wantedGame = process.argv[2] ?? 'self-play:demo-strong-policy-1:1';
const count = Number(process.argv[3] ?? '76');

const all = replayRecordedSelfPlay(dir).filter(({ snapshot }) => snapshot.identifiers.gameId === wantedGame).slice(0, count);
if (all.length === 0) throw new Error(`no decisions for ${wantedGame}`);
process.stdout.write(`${all.length} decisions from ${wantedGame}\n`);

const snapshots = all.map(({ snapshot }) => snapshot);
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
function time<T>(fn: () => T, runs = 20): { ms: number; value: T } {
  let value = fn(); // warm-up
  const samples: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    const started = performance.now();
    value = fn();
    samples.push(performance.now() - started);
  }
  return { ms: median(samples), value };
}

// Evaluate every decision the way the server does (cold, completion phase), then assemble a fully scored job.
const evaluated = snapshots.map((snapshot) => adaptiveEvaluateReviewPosition(snapshot, { startTier: 1, maxTier: 4, phase: 'completion', allowProgressiveBeyondTier: true }));
const base = createReviewCompletionJob({ gameDigest: 'bench-digest', sourceMatchId: 'bench-match', userId: 'bench-user', snapshots });
const job = {
  ...base,
  status: 'complete' as const,
  decisions: base.decisions.map((row, index) => ({
    ...row,
    lifecycle: evaluated[index]!.lifecycle,
    tierReached: evaluated[index]!.tier,
    positionHash: evaluated[index]!.positionHash,
    evaluation: evaluated[index]!.evaluation,
  })),
};
process.stdout.write(`job complete: ${String(jobAuthoritativeComplete(job as never))}; lifecycles ${JSON.stringify(job.decisions.reduce<Record<string, number>>((acc, d) => { acc[d.lifecycle] = (acc[d.lifecycle] ?? 0) + 1; return acc; }, {}))}\n`);

const enqueueBody = time(() => JSON.stringify({ snapshots }));
const sanitize = time(() => snapshots.map((snapshot) => sanitizeSnapshotForReview(JSON.parse(JSON.stringify(snapshot)))));
const quality = time(() => deriveReviewedMoveQuality(job as never));
const response = () => ({
  jobId: job.jobId,
  status: job.status,
  stage: 'complete',
  complete: true,
  progress: { total: job.decisions.length, forced: 0, scored: job.decisions.length, remaining: 0 },
  accuracyModelResult: null,
  reviewedMoveQuality: deriveReviewedMoveQuality(job as never),
  decisions: job.decisions.map((d) => ({ decisionId: d.decisionId, positionHash: d.positionHash, lifecycle: d.lifecycle, tierReached: d.tierReached })),
  evaluations: job.decisions.flatMap((d) => (d.evaluation ? [d.evaluation] : [])),
});
const stringify = time(() => JSON.stringify(response()));
const payload = JSON.stringify(response());
const parse = time(() => JSON.parse(payload));
const flag = (ms: number, bytes?: number) => (ms > 20 || (bytes ?? 0) > 200 * 1024 ? '  <-- OVER the 20 ms / 200 KB line' : '');

const kb = (bytes: number) => (bytes / 1024).toFixed(1);
process.stdout.write('\nstep                                              ms (median of 20)   size\n');
process.stdout.write(`POST  JSON.stringify of the ${snapshots.length} snapshots (request body)      ${enqueueBody.ms.toFixed(2).padStart(7)}        ${kb(enqueueBody.value.length)} KB${flag(enqueueBody.ms, enqueueBody.value.length)}\n`);
process.stdout.write(`POST  sanitizeSnapshotForReview x${snapshots.length} (incl. a JSON round trip)   ${sanitize.ms.toFixed(2).padStart(7)}${flag(sanitize.ms)}\n`);
process.stdout.write(`GET   deriveReviewedMoveQuality(job)                ${quality.ms.toFixed(2).padStart(7)}${flag(quality.ms)}\n`);
process.stdout.write(`GET   build response + JSON.stringify               ${stringify.ms.toFixed(2).padStart(7)}        ${kb(payload.length)} KB${flag(stringify.ms, payload.length)}\n`);
process.stdout.write(`GET   JSON.parse of the same payload (store read)   ${parse.ms.toFixed(2).padStart(7)}${flag(parse.ms)}\n`);
const perEvaluation = (job.decisions.reduce((sum, d) => sum + (d.evaluation ? JSON.stringify(d.evaluation).length : 0), 0) / job.decisions.length / 1024).toFixed(2);
process.stdout.write(`\nmean evaluation JSON: ${perEvaluation} KB each; the poll repeats the whole payload every 3 to 15 s while a review runs\n`);
