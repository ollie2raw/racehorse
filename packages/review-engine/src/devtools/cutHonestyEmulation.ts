/**
 * What honest labelling of cut verdicts does to the badges of the recorded corpus when the machine is slow (docs/review-partial-honesty-2026-11-08.md).
 * Runs every decision of every recorded game through adaptiveEvaluateReviewPosition exactly as the server calls it (phase 'completion', second opinion on) with
 * `cutHonesty` on and EVERY wall-clock ceiling divided by `slow` (the emulation of docs/review-single-depth-design-2026-11-08.md: 40 is the measured free-instance ratio, about 45).
 * ONE run gives both sides of the comparison: with the option on, the search and its acceptance are the very ones that run today (a run cut before its halfway sample is accepted
 * either way), so the badge TODAY is the label of the same evaluation with `partialSearch` removed, and the badge with the rule is the label with it. One JSON line per decision.
 *
 * Bot play only. Games are split between shards by index (run at most one niced shard). Nothing here is imported by production code.
 *   npx tsx packages/review-engine/src/devtools/cutHonestyEmulation.ts <out.jsonl> <shard> <shards> <slow>
 */
import { appendFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { adaptiveEvaluateReviewPosition } from '../adaptiveEvaluateReviewPosition';
import { evaluateReviewPosition, WALL_CLOCK_CEILING_DIAGNOSTIC, DEFAULT_REVIEW_WALL_CLOCK_CEILING_MS } from '../evaluateReviewPosition';
import { presentedLabelForEvaluation } from '../../../../client/src/analyzer/gameAccuracyModel';
import { replayRecordedSelfPlay } from './replayRecordedSelfPlay';

const out = resolve(process.argv[2] ?? '/tmp/cut-honesty.jsonl');
const shard = Number(process.argv[3] ?? '0');
const shards = Number(process.argv[4] ?? '1');
const slow = Number(process.argv[5] ?? '40');
const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/recorded-self-play');

const positions = replayRecordedSelfPlay(dir);
const games = [...new Set(positions.map((p) => p.snapshot.identifiers.gameId))];
writeFileSync(out, '');

// A slower machine reaches every wall-clock ceiling after proportionally less work; the fifth argument is how the option reaches the evaluator.
const evaluate: typeof evaluateReviewPosition = (snapshot, budget, threshold, now, options) =>
  evaluateReviewPosition(snapshot, { ...budget, maxWallClockMs: (budget.maxWallClockMs ?? DEFAULT_REVIEW_WALL_CLOCK_CEILING_MS) / slow }, threshold, now, options);

games.forEach((gameId, gameIndex) => {
  if (gameIndex % shards !== shard) return;
  for (const { snapshot } of positions.filter((p) => p.snapshot.identifiers.gameId === gameId)) {
    const started = performance.now();
    const result = adaptiveEvaluateReviewPosition(snapshot, { phase: 'completion', evaluate, cutHonesty: true, progressiveSampleOffset: 0 });
    const ms = performance.now() - started;
    const e = result.evaluation;
    const { partialSearch, ...withoutPartial } = e;
    const today = presentedLabelForEvaluation(withoutPartial as typeof e);
    const honest = presentedLabelForEvaluation(e);
    appendFileSync(out, `${JSON.stringify({
      gameId, seat: snapshot.identifiers.actorId, move: snapshot.identifiers.actionNumber, ms,
      tier: result.tier, reason: result.convergenceReason ?? null, space: result.estimatedStateSpace,
      source: e.evidence.source, confidence: e.evidence.confidence,
      samples: e.search.hiddenStateSamples, complete: e.search.complete,
      ceiling: e.diagnostics.includes(WALL_CLOCK_CEILING_DIAGNOSTIC),
      convergence: e.diagnostics.find((d) => d.startsWith('eval-convergence:')) ?? null,
      loss: e.loss.expectedPointDifferential,
      second: e.secondOpinion ? `${e.secondOpinion.kind}:${e.secondOpinion.verdict}` : null,
      partial: partialSearch ? { reason: partialSearch.reason, solved: partialSearch.samplesSolved, requested: partialSearch.samplesRequested, interval: partialSearch.lossInterval } : null,
      today, honest,
    })}\n`);
  }
});
process.stdout.write(`shard ${shard} done -> ${out}\n`);
