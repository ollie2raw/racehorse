/**
 * Do the review's grades mean anything about the whole hand? The review's search values a position at its horizon as the CURRENT SCORE DIFFERENCE
 * (solveMidgameDeterminization's leafValue), so its "best move" is the move that scores the most over the next two plies. This tool checks that against a long
 * view that does not share the blind spot: for each sampled decision, every legal move is PLAYED OUT TO THE END OF THE HAND (including the end-of-hand award) many
 * times against opponent hands sampled consistently with what the reviewed player could know, both sides continuing with the same fixed policy. The same sampled
 * hands are used for every candidate, so the comparison is paired.
 *
 *   npx tsx src/devtools/reviewRolloutCalibration.ts [corpusDir] [decisions] [samples] [outPath] [rolloutTier=standard]
 *
 * Two independent sets of sampled hands are drawn (A and B). The main figures pool both; each flag is also checked in each half separately, so a result that
 * appears only by sampling chance can be told from one that persists.
 *
 * It measures the review against ROLLOUT value, not against truth: the rollout value is only as good as its continuation policy.
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FritzTier } from '@racehorse/game-core';
import type { ReviewAction } from '@racehorse/game-core/review';
import { ADAPTIVE_COVERAGE_THRESHOLD, SEARCH_ESCALATION_TIERS } from '../adaptiveEvaluateReviewPosition';
import { evaluateReviewPosition } from '../evaluateReviewPosition';
import { LOSS_BAND_BOUNDARIES } from '../accuracyModelCalibration';
import { replayRecordedSelfPlay } from './replayRecordedSelfPlay';
import { rolloutGain, sampleAllocations } from '../rolloutValue';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const dir = resolve(process.argv[2] ?? resolve(ROOT, 'packages/review-engine/fixtures/recorded-self-play'));
const wanted = Number(process.argv[3] ?? '60');
const samples = Number(process.argv[4] ?? '40');
const outPath = process.argv[5] ? resolve(process.argv[5]) : null;
const rolloutTier = (process.argv[6] ?? 'standard') as FritzTier;

const key = (a: ReviewAction) => JSON.stringify(a);

const band = (loss: number) => (loss <= LOSS_BAND_BOUNDARIES.bestTolerance ? 'best' : loss <= LOSS_BAND_BOUNDARIES.inaccuracyToMistake ? 'inaccuracy' : loss <= LOSS_BAND_BOUNDARIES.mistakeToBlunder ? 'mistake' : 'blunder');
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
const sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, xs.length - 1)); };
function pearson(a: number[], b: number[]) {
  const ma = mean(a); const mb = mean(b);
  let num = 0; let da = 0; let db = 0;
  for (let i = 0; i < a.length; i += 1) { num += (a[i]! - ma) * (b[i]! - mb); da += (a[i]! - ma) ** 2; db += (b[i]! - mb) ** 2; }
  return da === 0 || db === 0 ? NaN : num / Math.sqrt(da * db);
}

const pool = replayRecordedSelfPlay(dir).filter(({ snapshot, evaluation }) => snapshot.preAction.boneyard.drawableCount > 0 && evaluation.candidates.length > 1);
const stride = Math.max(1, Math.floor(pool.length / wanted));
const chosen = pool.filter((_, i) => i % stride === 0).slice(0, wanted);

type Row = {
  band: string;
  reviewLoss: number;
  rolloutLoss: number; // rollout(best by review) - rollout(played), positive = the review's best really is better
  rolloutSe: number;
  reviewTopIsRolloutTop: boolean;
  playedIsRolloutTop: boolean;
  rolloutBestMinusPlayed: number; // max over candidates minus played
  nCandidates: number;
  playedIsReviewBest: boolean;
  /** the rollout prefers another move to the played one by more than 1 point, in half A and in half B */
  preferOtherA: boolean;
  preferOtherB: boolean;
  reviewBestBeatsPlayedA: boolean;
  reviewBestBeatsPlayedB: boolean;
  /** the review's best minus the played move, in rollout points, in each half (positive = the review's best really is better) */
  diffA: number;
  diffB: number;
  /** the rollout's own best move minus the played move, in each half (how much the long view thinks the played move leaves on the table) */
  otherAdvA: number;
  otherAdvB: number;
};
const rows: Row[] = [];
const started = Date.now();
let n = 0;
for (const { snapshot } of chosen) {
  const evaluation = evaluateReviewPosition(snapshot, SEARCH_ESCALATION_TIERS[1]!.budget, ADAPTIVE_COVERAGE_THRESHOLD, () => 0);
  if (evaluation.evidence.source === 'heuristic') continue;
  const actions = evaluation.candidates.map((c) => c.action);
  const allocsA = sampleAllocations(snapshot, 'A', samples);
  const allocsB = sampleAllocations(snapshot, 'B', samples);
  if (allocsA.length < 10 || allocsB.length < 10) continue;
  const gainsA = new Map<string, number[]>();
  const gainsB = new Map<string, number[]>();
  for (const action of actions) {
    gainsA.set(key(action), allocsA.map((a) => rolloutGain(snapshot, a, action, rolloutTier)));
    gainsB.set(key(action), allocsB.map((a) => rolloutGain(snapshot, a, action, rolloutTier)));
  }
  const gains = new Map<string, number[]>(actions.map((a) => [key(a), [...gainsA.get(key(a))!, ...gainsB.get(key(a))!]]));
  const value = (a: ReviewAction) => mean(gains.get(key(a))!);
  const half = (g: Map<string, number[]>, a: ReviewAction) => mean(g.get(key(a))!);
  const topOf = (g: Map<string, number[]>) => actions.reduce((p, c) => (half(g, c) > half(g, p) ? c : p), actions[0]!);
  const played = evaluation.played.action;
  const best = evaluation.best.action;
  const rolloutTop = actions.reduce((p, c) => (value(c) > value(p) ? c : p), actions[0]!);
  const diffs = gains.get(key(best))!.map((g, i) => g - gains.get(key(played))![i]!);
  rows.push({
    band: band(Math.max(0, evaluation.loss.expectedPointDifferential)),
    reviewLoss: Math.max(0, evaluation.loss.expectedPointDifferential),
    rolloutLoss: mean(diffs),
    rolloutSe: sd(diffs) / Math.sqrt(diffs.length),
    reviewTopIsRolloutTop: key(best) === key(rolloutTop),
    playedIsRolloutTop: key(played) === key(rolloutTop),
    rolloutBestMinusPlayed: value(rolloutTop) - value(played),
    nCandidates: actions.length,
    playedIsReviewBest: key(played) === key(best),
    preferOtherA: half(gainsA, topOf(gainsA)) - half(gainsA, played) > 1,
    preferOtherB: half(gainsB, topOf(gainsB)) - half(gainsB, played) > 1,
    reviewBestBeatsPlayedA: half(gainsA, best) - half(gainsA, played) > 0,
    reviewBestBeatsPlayedB: half(gainsB, best) - half(gainsB, played) > 0,
    diffA: half(gainsA, best) - half(gainsA, played),
    diffB: half(gainsB, best) - half(gainsB, played),
    otherAdvA: half(gainsA, topOf(gainsA)) - half(gainsA, played),
    otherAdvB: half(gainsB, topOf(gainsB)) - half(gainsB, played),
  });
  n += 1;
  if (n % 5 === 0) process.stderr.write(`${n}/${chosen.length} (${Math.round((Date.now() - started) / 1000)}s)\n`);
}

const pct = (k: number, d: number) => (d === 0 ? '—' : `${((k / d) * 100).toFixed(0)}%`);
const bands = ['best', 'inaccuracy', 'mistake', 'blunder'];
const graded = rows.filter((r) => !r.playedIsReviewBest);

/**
 * Second opinion, cross-validated. The review calls the played move worse than its best (an error verdict) or best. Would asking the whole-hand view first, and
 * only keeping the verdict when it agrees, make the verdicts that remain more trustworthy? The rule is decided on one independent set of sampled hands and judged on
 * the OTHER (A decides and B judges, then B decides and A judges, pooled), so the rule never grades itself.
 *   error verdict kept   when the deciding half also finds the review's best better than the played move (by more than 0)
 *   "Best" kept          unless the deciding half finds another move better than the played one by more than 1 point
 * A verdict "holds up" if the judging half agrees: for an error, the review's best beats the played move by more than 0.25; for "Best", no other move beats it by more than 1.
 */
function secondOpinionSection(all: Row[]): string[] {
  type Pair = { decide: { diff: number; adv: number }; judge: { diff: number; adv: number }; row: Row };
  const pairs: Pair[] = all.flatMap((row) => [
    { decide: { diff: row.diffA, adv: row.otherAdvA }, judge: { diff: row.diffB, adv: row.otherAdvB }, row },
    { decide: { diff: row.diffB, adv: row.otherAdvB }, judge: { diff: row.diffA, adv: row.otherAdvA }, row },
  ]);
  const errorPairs = (bandsIn: string[]) => pairs.filter((p) => !p.row.playedIsReviewBest && bandsIn.includes(p.row.band));
  const errLine = (label: string, ps: Pair[]) => {
    const holds = (p: Pair) => p.judge.diff > 0.25;
    const kept = ps.filter((p) => p.decide.diff > 0);
    const dropped = ps.filter((p) => !(p.decide.diff > 0));
    return `| ${label} | ${ps.length} | ${pct(ps.filter(holds).length, ps.length)} | ${kept.length} (${pct(kept.length, ps.length)}) | ${pct(kept.filter(holds).length, kept.length)} | ${dropped.length} | ${pct(dropped.filter(holds).length, dropped.length)} |`;
  };
  const bestPairs = pairs.filter((p) => p.row.playedIsReviewBest);
  const suppressed = bestPairs.filter((p) => p.decide.adv > 1);
  const remaining = bestPairs.filter((p) => !(p.decide.adv > 1));
  const bad = (p: Pair) => p.judge.adv > 1;
  return [
    '### Second opinion: would asking the whole-hand view first make the verdicts more trustworthy? (cross-validated)',
    '',
    'Each decision is judged twice (one independent half of the sampled hands decides, the other judges, and the reverse). An **error verdict** is kept only if the deciding half also finds the review\'s best better than the played move; a verdict **holds up** if the judging half finds it better by more than 0.25 points.',
    '',
    '| error verdicts | judged | holds up as the review stands | kept by the rule | holds up among the kept | dropped | holds up among the dropped |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    errLine('inaccuracy', errorPairs(['inaccuracy'])),
    errLine('mistake or blunder', errorPairs(['mistake', 'blunder'])),
    errLine('all error verdicts', errorPairs(['inaccuracy', 'mistake', 'blunder'])),
    '',
    `"Best" verdicts (the played move is the review's best): ${bestPairs.length} judged. As the review stands, the judging half finds another move better by more than 1 point in ${pct(bestPairs.filter(bad).length, bestPairs.length)}. The rule suppresses ${suppressed.length} (${pct(suppressed.length, bestPairs.length)}) as a close call; among those the judging half agrees in ${pct(suppressed.filter(bad).length, suppressed.length)}. Among the ${remaining.length} still called Best it finds a better move in ${pct(remaining.filter(bad).length, remaining.length)}.`,
    '',
  ];
}
const lines = [
  '# Review rollout calibration',
  '',
  `Corpus \`${dir.replace(ROOT + '/', '')}\`; ${rows.length} decisions (search or exact, tiles still to draw), every legal move played to the end of the hand against ${samples} sampled opponent hands, continuation policy = Fritz "${rolloutTier}" for both sides. Paired: the same sampled hands for every candidate.`,
  '',
  '"Rollout gain" = points the reviewed player gains over the opponent from this decision to the end of the hand (including the end-of-hand award). The question: when the review calls the played move worse than its best, does the best move really gain more over the whole hand?',
  '',
  '| review grade of the played move | decisions | review says it costs (mean pts) | rollout says it costs (mean pts) | review\'s best really beats played in rollouts | rollout agrees by > 2 standard errors |',
  '| --- | ---: | ---: | ---: | ---: | ---: |',
  ...bands.map((b) => {
    const rs = rows.filter((r) => r.band === b && !r.playedIsReviewBest);
    return `| ${b} | ${rs.length} | ${mean(rs.map((r) => r.reviewLoss)).toFixed(2)} | ${mean(rs.map((r) => r.rolloutLoss)).toFixed(2)} | ${pct(rs.filter((r) => r.rolloutLoss > 0).length, rs.length)} | ${pct(rs.filter((r) => r.rolloutLoss > 2 * r.rolloutSe).length, rs.length)} |`;
  }),
  '',
  `Correlation between the review's loss and the rollout loss (decisions where the move played was not the review's best, n = ${graded.length}): **${pearson(graded.map((r) => r.reviewLoss), graded.map((r) => r.rolloutLoss)).toFixed(2)}**.`,
  '',
  '### Does the review pick the move that is best over the whole hand?',
  '',
  `- the review's top move is also the rollout's top move: ${pct(rows.filter((r) => r.reviewTopIsRolloutTop).length, rows.length)} of ${rows.length}`,
  `- the move actually played is the rollout's top move: ${pct(rows.filter((r) => r.playedIsRolloutTop).length, rows.length)}`,
  `- the move played is the review's best (graded "best" for free): ${rows.filter((r) => r.playedIsReviewBest).length}; of those the rollout prefers a different move by more than 1 point in ${rows.filter((r) => r.playedIsReviewBest && r.rolloutBestMinusPlayed > 1).length} (**moves the review calls best that lose over the hand**)`,
  `- mean rollout points lost by the played move versus the rollout's best move: ${mean(rows.map((r) => r.rolloutBestMinusPlayed)).toFixed(2)}`,
  `- **noise floor** (two independent sets of ${samples} sampled hands): of the ${rows.filter((r) => r.playedIsReviewBest).length} played moves the review calls best, the rollout prefers another by more than 1 point in half A for ${rows.filter((r) => r.playedIsReviewBest && r.preferOtherA).length}, in half B for ${rows.filter((r) => r.playedIsReviewBest && r.preferOtherB).length}, and in BOTH halves for ${rows.filter((r) => r.playedIsReviewBest && r.preferOtherA && r.preferOtherB).length} (the persistent ones are the credible ones)`,
  `- for the ${graded.length} decisions where the review says the played move was not best: its best beats the played move in half A for ${graded.filter((r) => r.reviewBestBeatsPlayedA).length}, in half B for ${graded.filter((r) => r.reviewBestBeatsPlayedB).length}, in both for ${graded.filter((r) => r.reviewBestBeatsPlayedA && r.reviewBestBeatsPlayedB).length}`,
  `- median standard error of the rollout loss on the ${graded.length} graded decisions (pooled): ${[...graded].map((r) => r.rolloutSe).sort((a, b) => a - b)[Math.floor(graded.length / 2)]!.toFixed(2)} points`,
  `- legal candidates per decision, mean: ${mean(rows.map((r) => r.nCandidates)).toFixed(1)}`,
  '',
  ...secondOpinionSection(rows),
  `Took ${Math.round((Date.now() - started) / 1000)} s.`,
  '',
].join('\n');
if (outPath) writeFileSync(outPath, lines);
console.log(lines);
