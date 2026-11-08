/**
 * Whole-game cost and verdict quality through the SHIPPING path (docs/review-single-depth-design-2026-11-08.md). Evaluates every decision of every recorded game, in game order,
 * with adaptiveEvaluateReviewPosition exactly as the server calls it (phase 'completion', second opinion on), one JSON line per decision.
 *
 *   slow    1 = the laptop as it is. N > 1 = emulate a machine N times slower by dividing EVERY wall-clock ceiling of the pipeline by N (tier ceilings 2 s / 120 s / 600 s / 1,800 s,
 *           the progressive chunk, the exact branch's 1,800 s, the bounded path's), so the same positions hit the ceilings a slow machine would. The node and sample budgets, and
 *           every verdict that does not depend on a clock, are untouched. The measured production ratio is about 45 (docs: free instance 0.15 CPU, benchmark 894 ms against 20 ms).
 *   bounded 1 = REVIEW_BOUNDED_EXACT_ENABLED on (the option the server then passes), 0 = off (what runs today).
 *
 * Bot play only. Games are split between shards by index. Nothing here is imported by production code.
 *   npx tsx packages/review-engine/src/devtools/wholeGameRun.ts <out.jsonl> <shard> <shards> <slow> <bounded>
 */
import { appendFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { adaptiveEvaluateReviewPosition } from '../adaptiveEvaluateReviewPosition';
import { evaluateReviewPosition, WALL_CLOCK_CEILING_DIAGNOSTIC, DEFAULT_REVIEW_WALL_CLOCK_CEILING_MS } from '../evaluateReviewPosition';
import { gradeOfLoss } from './reviewSamplingStudyLib';
import { replayRecordedSelfPlay } from './replayRecordedSelfPlay';

const out = resolve(process.argv[2] ?? '/tmp/whole-game.jsonl');
const shard = Number(process.argv[3] ?? '0');
const shards = Number(process.argv[4] ?? '1');
const slow = Number(process.argv[5] ?? '1');
const bounded = process.argv[6] === '1';
const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/recorded-self-play');

const positions = replayRecordedSelfPlay(dir);
const games = [...new Set(positions.map((p) => p.snapshot.identifiers.gameId))];
writeFileSync(out, '');

// A slower machine reaches every wall-clock ceiling after proportionally less work.
const evaluate: typeof evaluateReviewPosition = (snapshot, budget, threshold, now) =>
  evaluateReviewPosition(snapshot, { ...budget, maxWallClockMs: (budget.maxWallClockMs ?? DEFAULT_REVIEW_WALL_CLOCK_CEILING_MS) / slow }, threshold, now);

games.forEach((gameId, gameIndex) => {
  if (gameIndex % shards !== shard) return;
  for (const { snapshot } of positions.filter((p) => p.snapshot.identifiers.gameId === gameId)) {
    const started = performance.now();
    const result = adaptiveEvaluateReviewPosition(snapshot, {
      phase: 'completion',
      evaluate,
      ...(bounded ? { boundedExact: slow === 1 ? {} : { wallClockCeilingMs: 1_800_000 / slow } } : {}),
      progressiveSampleOffset: 0,
    });
    const ms = performance.now() - started;
    const e = result.evaluation;
    appendFileSync(out, `${JSON.stringify({
      gameId, seat: snapshot.identifiers.actorId, move: snapshot.identifiers.actionNumber, ms,
      lifecycle: result.lifecycle, tier: result.tier, reason: result.convergenceReason ?? null, space: result.estimatedStateSpace,
      source: e.evidence.source, confidence: e.evidence.confidence, label: e.evidence.displayLabel,
      samples: e.search.hiddenStateSamples, coverage: e.search.coverage, complete: e.search.complete, depth: e.search.depth,
      ceiling: e.diagnostics.includes(WALL_CLOCK_CEILING_DIAGNOSTIC), failure: e.evaluationProvenance?.failureReason ?? null,
      loss: e.loss.expectedPointDifferential, grade: gradeOfLoss(e.loss.expectedPointDifferential),
      top: JSON.stringify(e.best.action), legal: snapshot.legalActions.length, drawable: snapshot.preAction.boneyard.drawableCount,
      second: e.secondOpinion ? `${e.secondOpinion.kind}:${e.secondOpinion.verdict}` : null,
      bounded: e.boundedSearch ? { stop: e.boundedSearch.stopReason, partial: e.boundedSearch.partial, hands: e.boundedSearch.handsVisited, total: e.boundedSearch.totalHands } : null,
      fallback: e.heuristicFallbackReason ?? null,
    })}\n`);
  }
});
process.stdout.write(`shard ${shard} done -> ${out}\n`);
