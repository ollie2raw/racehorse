/**
 * How stable is the review's answer? For a sample of recorded decisions with tiles still to draw (the hidden-hand search case), the evaluator is run again on
 * the same position under different conditions, and we count how often what a PLAYER SEES changes:
 *
 *   A  tier 2 (2,500 sampled hidden states, the production starting budget), seed 1
 *   B  tier 2, a DIFFERENT seed          -> A vs B is pure sampling noise at the production budget
 *   C  tier 3 (12,000 samples)           -> A vs C is what more samples at the same depth change
 *   D  the SAME 2,500 samples but searched 3 plies deep instead of 2 -> A vs D is what a deeper search changes
 *
 * "What a player sees" is (1) which move is the best one and (2) the grade of the move they played (best / inaccuracy / mistake / blunder, from the
 * calibrated loss bands). Manually invoked:
 *   npx tsx src/devtools/reviewSearchStability.ts [corpusDir] [sampleCount] [outPath]
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import type { ReviewEvaluationV1 } from '@racehorse/game-core/review';
import { ADAPTIVE_COVERAGE_THRESHOLD, SEARCH_ESCALATION_TIERS } from '../adaptiveEvaluateReviewPosition';
import { evaluateReviewPosition } from '../evaluateReviewPosition';
import { LOSS_BAND_BOUNDARIES } from '../accuracyModelCalibration';
import { replayRecordedSelfPlay } from './replayRecordedSelfPlay';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const dir = resolve(process.argv[2] ?? resolve(ROOT, 'packages/review-engine/fixtures/recorded-self-play'));
const sampleCount = Number(process.argv[3] ?? '120');
const outPath = process.argv[4] ? resolve(process.argv[4]) : null;

const tier = (n: 1 | 2 | 3 | 4) => SEARCH_ESCALATION_TIERS.find((t) => t.tier === n)!.budget;
const run = (snapshot: Parameters<typeof evaluateReviewPosition>[0], budget: Parameters<typeof evaluateReviewPosition>[1]) => {
  const started = performance.now();
  const evaluation = evaluateReviewPosition(snapshot, budget, ADAPTIVE_COVERAGE_THRESHOLD);
  return { evaluation, ms: performance.now() - started };
};

const band = (lossPoints: number): 'best' | 'inaccuracy' | 'mistake' | 'blunder' => {
  if (lossPoints <= LOSS_BAND_BOUNDARIES.bestTolerance) return 'best';
  if (lossPoints <= LOSS_BAND_BOUNDARIES.inaccuracyToMistake) return 'inaccuracy';
  if (lossPoints <= LOSS_BAND_BOUNDARIES.mistakeToBlunder) return 'mistake';
  return 'blunder';
};
const key = (e: ReviewEvaluationV1) => JSON.stringify(e.best.action);

const all = replayRecordedSelfPlay(dir).filter(({ snapshot, evaluation }) => snapshot.preAction.boneyard.drawableCount > 0 && evaluation.candidates.length > 1);
const stride = Math.max(1, Math.floor(all.length / sampleCount));
const sample = all.filter((_, i) => i % stride === 0).slice(0, sampleCount);

type Row = {
  handSize: number;
  tierA: string; tierB: string; tierC: string; tierD: string;
  topAB: boolean; topAC: boolean; topAD: boolean;
  bandAB: boolean; bandAC: boolean; bandAD: boolean;
  played: string;
  msA: number; msC: number; msD: number;
};
const rows: Row[] = [];
let n = 0;
for (const { snapshot } of sample) {
  const A = run(snapshot, { ...tier(2), seed: 'stability-A' });
  const B = run(snapshot, { ...tier(2), seed: 'stability-B' });
  const C = run(snapshot, tier(3));
  const D = run(snapshot, { ...tier(2), maxPlyDepth: 3, seed: 'stability-A' });
  const loss = (e: ReviewEvaluationV1) => Math.max(0, e.loss.expectedPointDifferential);
  rows.push({
    handSize: snapshot.preAction.actorHand.length,
    tierA: A.evaluation.evidence.source, tierB: B.evaluation.evidence.source, tierC: C.evaluation.evidence.source, tierD: D.evaluation.evidence.source,
    topAB: key(A.evaluation) === key(B.evaluation), topAC: key(A.evaluation) === key(C.evaluation), topAD: key(A.evaluation) === key(D.evaluation),
    bandAB: band(loss(A.evaluation)) === band(loss(B.evaluation)),
    bandAC: band(loss(A.evaluation)) === band(loss(C.evaluation)),
    bandAD: band(loss(A.evaluation)) === band(loss(D.evaluation)),
    played: band(loss(A.evaluation)),
    msA: A.ms, msC: C.ms, msD: D.ms,
  });
  n += 1;
  if (n % 10 === 0) process.stderr.write(`${n}/${sample.length}\n`);
}

const pct = (k: number, d: number) => (d === 0 ? '—' : `${((k / d) * 100).toFixed(1)}%`);
const wilson = (k: number, d: number) => {
  if (d === 0) return '—';
  const z = 1.96; const p = k / d;
  const denom = 1 + (z * z) / d;
  const centre = (p + (z * z) / (2 * d)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / d + (z * z) / (4 * d * d))) / denom;
  return `[${((centre - half) * 100).toFixed(1)}%, ${((centre + half) * 100).toFixed(1)}%]`;
};
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] ?? 0; };
const searchOnly = rows.filter((r) => r.tierA !== 'heuristic' && r.tierB !== 'heuristic' && r.tierC !== 'heuristic' && r.tierD !== 'heuristic');
const section = (label: string, topK: (r: Row) => boolean, bandK: (r: Row) => boolean) => {
  const top = searchOnly.filter(topK).length;
  const bnd = searchOnly.filter(bandK).length;
  return `| ${label} | ${searchOnly.length} | ${pct(top, searchOnly.length)} ${wilson(top, searchOnly.length)} | ${pct(bnd, searchOnly.length)} ${wilson(bnd, searchOnly.length)} |`;
};
const flips = (pred: (r: Row) => boolean) => `${searchOnly.filter(pred).length}`;

const report = [
  '# Review search stability',
  '',
  `Corpus: \`${dir.replace(ROOT + '/', '')}\`; ${all.length} non-forced decisions with tiles still drawable, ${rows.length} sampled (every ${stride}th). Decisions where any run fell to the heuristic (${rows.length - searchOnly.length}) are left out of the agreement figures below.`,
  '',
  '"Top move" = the move the review calls best. "Grade" = the grade of the move actually played, from the calibrated loss bands. A flip is a change a player would see. 95% Wilson intervals.',
  '',
  '| comparison | decisions | same top move | same grade of the played move |',
  '| --- | ---: | ---: | ---: |',
  section('A vs B: same budget (2,500 samples), different seed. Pure sampling noise.', (r) => r.topAB, (r) => r.bandAB),
  section('A vs C: 2,500 vs 12,000 samples', (r) => r.topAC, (r) => r.bandAC),
  section('A vs D: the same 2,500 samples, searched 3 plies deep instead of 2', (r) => r.topAD, (r) => r.bandAD),
  '',
  `Grade flips: A/B ${flips((r) => !r.bandAB)}, A/C ${flips((r) => !r.bandAC)}, A/D ${flips((r) => !r.bandAD)} of ${searchOnly.length}.`,
  '',
  '### Grade of the played move at the production budget',
  '',
  ...['best', 'inaccuracy', 'mistake', 'blunder'].map((g) => `- ${g}: ${searchOnly.filter((r) => r.played === g).length}`),
  '',
  '### Tiers returned at each budget (all sampled)',
  '',
  ...(['A', 'B', 'C', 'D'] as const).map((k) => {
    const f = (r: Row) => r[`tier${k}` as 'tierA'];
    return `- ${k}: exact ${rows.filter((r) => f(r) === 'exact').length}, search ${rows.filter((r) => f(r) === 'search').length}, heuristic ${rows.filter((r) => f(r) === 'heuristic').length}`;
  }),
  '',
  `### Time per decision (median / worst)`,
  '',
  `- 2,500 samples: ${median(rows.map((r) => r.msA)).toFixed(0)} ms / ${Math.max(...rows.map((r) => r.msA)).toFixed(0)} ms`,
  `- 12,000 samples: ${median(rows.map((r) => r.msC)).toFixed(0)} ms / ${Math.max(...rows.map((r) => r.msC)).toFixed(0)} ms`,
  `- 2,500 samples, depth 3: ${median(rows.map((r) => r.msD)).toFixed(0)} ms / ${Math.max(...rows.map((r) => r.msD)).toFixed(0)} ms`,
  '',
].join('\n');

if (outPath) writeFileSync(outPath, report);
console.log(report);
