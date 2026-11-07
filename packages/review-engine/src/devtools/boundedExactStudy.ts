/**
 * Steps 2 to 4 of docs/review-bounded-exact-2026-11-07.md, offline on the recordings from recordExactPass.ts (bot play only; the exact-path decisions of the corpus).
 * Every bounded variant is replayed through the SAME engine the live solver uses (boundedExactSolver.ts runBounded, proved equal to a live run in its tests).
 *
 * Reference = what production computes today (C(n,k) seeded random draws). A second reference, the true exact value over every distinct hand, is reported so the
 * reference's own error is visible. Metrics: top-move agreement, grade agreement, Cohen's kappa, mean absolute loss error, with 95% bootstrap intervals, on all
 * decisions, on the non-Best subset (reference grade is not Best) and on decisions whose reference loss is within 0.25 points of a band edge. Tuning games pick the
 * parameters; held-out games are reported.
 *
 *   npx tsx packages/review-engine/src/devtools/boundedExactStudy.ts <exact_s0.jsonl> [<exact_s1.jsonl> ...]
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CorpusSplit } from './corpusSplit';
import { recordedHandSource, runBounded, type BoundedOptions, type BoundedResult, type HandSource } from './boundedExactSolver';
import {
  BAND_EDGES,
  bootstrapInterval,
  cohensKappa,
  formatInterval,
  fraction,
  gradeOfLoss,
  meanOf,
  quantile,
  type Grade,
} from './reviewSamplingStudyLib';

type Recording = {
  index: number; gameId: string; split: CorpusSplit; move: number; drawable: number; handSize: number; legal: number; C: number;
  actionKeys: string[]; playedIndex: number;
  ref: { topKey: string; loss: number; grade: Grade; ms: number; samples: number; coverage: number };
  hands: Array<{ d: number[]; n: number[]; ms: number }>;
};

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const files = process.argv.slice(2);
const recs: Recording[] = files.flatMap((f) => readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Recording));
const say = (line = '') => process.stdout.write(`${line}\n`);

// cold cost of every corpus decision (the A1 run), to put the change in whole-game terms
const csv = readFileSync(resolve(ROOT, 'docs/review-performance-measurement-2026-11-07.cold-run.csv'), 'utf8').trim().split('\n');
const head = csv[0]!.split(',');
const cold = csv.slice(1).map((line) => {
  const cells = line.split(',');
  const row: Record<string, string> = {};
  head.forEach((h, i) => { row[h] = cells[i] ?? ''; });
  return { gameId: row.gameId!, move: Number(row.moveNumber), ms: Number(row.ms), split: row.split as CorpusSplit };
});
const recKey = (gameId: string, move: number) => `${gameId}#${move}`;
const recByKey = new Map(recs.map((r) => [recKey(r.gameId, r.move), r]));

const sourceOf = (r: Recording): HandSource => recordedHandSource({ actionKeys: r.actionKeys, playedIndex: r.playedIndex, hands: r.hands.map((h) => ({ d: h.d, nodes: h.n, ms: h.ms })) });

type Verdict = { topKey: string; loss: number; grade: Grade };
function trueExact(r: Recording): Verdict & { ms: number } {
  const result = runBounded(sourceOf(r), { maxHands: r.C, earlyStop: false });
  return { topKey: r.actionKeys[result.topIndex]!, loss: result.loss, grade: result.grade, ms: result.ms };
}

type Outcome = { rec: Recording; verdict: Verdict; ms: number; hands: number; partial: boolean; reason: string; interval: readonly [number, number]; dropped: number; saved: number };
function replay(config: BoundedOptions): Outcome[] {
  return recs.map((rec) => {
    const result: BoundedResult = runBounded(sourceOf(rec), config);
    return { rec, verdict: { topKey: rec.actionKeys[result.topIndex]!, loss: result.loss, grade: result.grade }, ms: result.ms, hands: result.handsVisited, partial: result.partial, reason: result.reason, interval: result.lossInterval, dropped: result.dropped, saved: result.nodesSavedShare };
  });
}

const nearEdge = (loss: number) => BAND_EDGES.some((edge) => Math.abs(loss - edge) <= 0.25);
type Row = { ref: Verdict; got: Verdict; ms: number };
const pct = (r: { point: number | null; lo: number | null; hi: number | null }) => formatInterval(r);
function agreement(rows: Row[]): { top: string; grade: string; kappa: string; mae: string } {
  const top = bootstrapInterval(rows, (s) => fraction(s.map((x) => x.got.topKey === x.ref.topKey)));
  const grade = bootstrapInterval(rows, (s) => fraction(s.map((x) => x.got.grade === x.ref.grade)));
  const kappa = bootstrapInterval(rows, (s) => cohensKappa(s.map((x) => x.got.grade), s.map((x) => x.ref.grade)));
  const mae = meanOf(rows.map((x) => Math.abs(x.got.loss - x.ref.loss)));
  return { top: pct(top), grade: pct(grade), kappa: kappa.point === null ? 'n/a' : `${kappa.point.toFixed(2)} [${kappa.lo?.toFixed(2) ?? '?'}, ${kappa.hi?.toFixed(2) ?? '?'}]`, mae: mae === null ? 'n/a' : mae.toFixed(3) };
}
const fmt = (v: number | null, d = 0) => (v === null ? 'n/a' : v.toFixed(d));

// ---- 0. the reference's own error ----------------------------------------------------------------------------------------
say(`${recs.length} exact-path decisions with a recording (tuning ${recs.filter((r) => r.split === 'tuning').length}, held-out ${recs.filter((r) => r.split === 'heldout').length}); bot play`);
const exactVerdicts = recs.map((r) => ({ rec: r, ...trueExact(r) }));
say(`\n== The reference's own error: production's C(n,k) seeded draws (with replacement) vs the true value over every distinct hand ==`);
say(`production coverage of the distinct hands: mean ${fmt((meanOf(recs.map((r) => r.ref.coverage)) ?? 0) * 100, 1)}% (1 - 1/e = 63.2% is what C draws with replacement give)`);
for (const split of ['heldout', 'tuning'] as const) {
  const rows: Row[] = exactVerdicts.filter((e) => e.rec.split === split).map((e) => ({ ref: e.rec.ref, got: e, ms: e.ms }));
  const nb = rows.filter((x) => x.ref.grade !== 'best');
  const a = agreement(rows);
  const b = agreement(nb);
  say(`${split}: all ${rows.length}: top ${a.top}, grade ${a.grade}, MAE ${a.mae}; non-Best ${nb.length}: top ${b.top}, grade ${b.grade}, kappa ${b.kappa}, MAE ${b.mae}`);
}

// ---- configurations --------------------------------------------------------------------------------------------------------
type Config = { name: string; options: BoundedOptions };
const BIG = 8000;
const configs: Config[] = [
  { name: 'B loss-only, server cap', options: { maxHands: BIG } },
  { name: 'B loss+top, server cap', options: { maxHands: BIG, requireTopMove: true } },
  { name: 'B+C loss+top, racing', options: { maxHands: BIG, requireTopMove: true, racing: true } },
  { name: 'B loss+top, cap 400 (device)', options: { maxHands: 400, requireTopMove: true } },
  { name: 'B+C loss+top, cap 400, racing', options: { maxHands: 400, requireTopMove: true, racing: true } },
  { name: 'D cap 20 hands (no stop)', options: { maxHands: 20, earlyStop: false } },
  { name: 'D cap 40 hands (no stop)', options: { maxHands: 40, earlyStop: false } },
  { name: 'D cap 80 hands (no stop)', options: { maxHands: 80, earlyStop: false } },
  { name: 'D cap 160 hands (no stop)', options: { maxHands: 160, earlyStop: false } },
  { name: 'D cap 320 hands (no stop)', options: { maxHands: 320, earlyStop: false } },
  { name: 'D cap 640 hands (no stop)', options: { maxHands: 640, earlyStop: false } },
  { name: 'D time 25 ms (no stop)', options: { maxHands: BIG, maxMs: 25, earlyStop: false } },
  { name: 'D time 50 ms (no stop)', options: { maxHands: BIG, maxMs: 50, earlyStop: false } },
  { name: 'D time 100 ms (no stop)', options: { maxHands: BIG, maxMs: 100, earlyStop: false } },
  { name: 'B+C+D loss+top, 50 ms', options: { maxHands: BIG, maxMs: 50, requireTopMove: true, racing: true } },
  { name: 'B+C+D loss+top, 100 ms', options: { maxHands: BIG, maxMs: 100, requireTopMove: true, racing: true } },
  { name: 'B+C+D loss+top, 200 ms', options: { maxHands: BIG, maxMs: 200, requireTopMove: true, racing: true } },
];

// tuning: pick the cheapest of a small grid that meets the bar on the TUNING non-Best subset (reference = production)
const grid: Config[] = [];
for (const z of [1.64, 1.96, 2.58]) for (const halfWidth of [0.15, 0.25, 0.35]) grid.push({ name: `B+C loss+top z=${z} hw=${halfWidth}`, options: { maxHands: BIG, requireTopMove: true, racing: true, z, halfWidth } });

function costRows(outcomes: Outcome[], split: CorpusSplit | 'all'): { exactMs: number[]; allMs: number[] } {
  const wanted = new Set(outcomes.filter((o) => split === 'all' || o.rec.split === split).map((o) => recKey(o.rec.gameId, o.rec.move)));
  const byKey = new Map(outcomes.map((o) => [recKey(o.rec.gameId, o.rec.move), o]));
  const exactMs = outcomes.filter((o) => split === 'all' || o.rec.split === split).map((o) => o.ms);
  const allMs = cold.filter((c) => split === 'all' || c.split === split).map((c) => (wanted.has(recKey(c.gameId, c.move)) ? byKey.get(recKey(c.gameId, c.move))!.ms : c.ms));
  return { exactMs, allMs };
}
const baselineOutcomes: Outcome[] = recs.map((rec) => ({ rec, verdict: rec.ref, ms: rec.ref.ms, hands: rec.C, partial: false, reason: 'production', interval: [rec.ref.loss, rec.ref.loss] as const, dropped: 0, saved: 0 }));
const baselineAll = cold.map((c) => c.ms);

function report(split: CorpusSplit, list: Config[]): void {
  const rowsFor = (outcomes: Outcome[]) => outcomes.filter((o) => o.rec.split === split).map((o) => ({ ref: o.rec.ref as Verdict, got: o.verdict, ms: o.ms }));
  const base = costRows(baselineOutcomes, split);
  say(`\n== ${split.toUpperCase()} ==`);
  say(`before (production today): exact-path decisions mean ${fmt(meanOf(base.exactMs))} ms, p99 ${fmt(quantile(base.exactMs, 0.99))}, max ${fmt(Math.max(...base.exactMs))}; all decisions mean ${fmt(meanOf(base.allMs))} ms, p99 ${fmt(quantile(base.allMs, 0.99))}, max ${fmt(Math.max(...base.allMs))}; 60-decision game ${fmt(((meanOf(base.allMs) ?? 0) * 60) / 1000, 1)} s; decisions over 4.5 s (the 40x/180 s line): ${base.allMs.filter((m) => m > 4500).length}`);
  say('config | hands mean / p90 | partial | exact-path mean ms / p99 / max | all-decision p99 / max | 60-dec game s | over 4.5 s | top all / non-Best | grade all / non-Best | kappa non-Best | MAE non-Best | grade near-edge | racing dropped / saved');
  for (const config of list) {
    const outcomes = replay(config.options);
    const own = outcomes.filter((o) => o.rec.split === split);
    const rows = rowsFor(outcomes);
    const nb = rows.filter((x) => x.ref.grade !== 'best');
    const edge = rows.filter((x) => nearEdge(x.ref.loss));
    const cost = costRows(outcomes, split);
    const all = agreement(rows);
    const nonBest = agreement(nb);
    const edgeGrade = bootstrapInterval(edge, (s) => fraction(s.map((x) => x.got.grade === x.ref.grade)));
    say(
      `${config.name} | ${fmt(meanOf(own.map((o) => o.hands)))} / ${fmt(quantile(own.map((o) => o.hands), 0.9))} | ${((own.filter((o) => o.partial).length / own.length) * 100).toFixed(0)}%`
      + ` | ${fmt(meanOf(cost.exactMs))} / ${fmt(quantile(cost.exactMs, 0.99))} / ${fmt(Math.max(...cost.exactMs))} | ${fmt(quantile(cost.allMs, 0.99))} / ${fmt(Math.max(...cost.allMs))} | ${fmt(((meanOf(cost.allMs) ?? 0) * 60) / 1000, 1)} | ${cost.allMs.filter((m) => m > 4500).length}`
      + ` | ${all.top} / ${nonBest.top} | ${all.grade} / ${nonBest.grade} | ${nonBest.kappa} | ${nonBest.mae} | ${pct(edgeGrade)} | ${fmt(meanOf(own.map((o) => o.dropped)), 2)} / ${fmt((meanOf(own.map((o) => o.saved)) ?? 0) * 100)}%`,
    );
  }
}

// agreement with the TRUE exact value (production is itself a noisy reference: see the first section)
function reportVsTrueExact(split: CorpusSplit, list: Config[]): void {
  const truth = new Map(exactVerdicts.map((e) => [recKey(e.rec.gameId, e.rec.move), e]));
  say(`\n== ${split.toUpperCase()}: against the TRUE exact value over every distinct hand (not against production) ==`);
  say('config | exact-path ms mean / p99 / max | 60-decision game, exact-path decisions only s | top all / non-Best | grade all / non-Best | kappa non-Best | MAE non-Best');
  const prod = baselineOutcomes.filter((o) => o.rec.split === split);
  const prodRows = prod.map((o) => ({ ref: truth.get(recKey(o.rec.gameId, o.rec.move))! as Verdict, got: o.rec.ref as Verdict, ms: o.ms }));
  const prodNb = prodRows.filter((x) => x.ref.grade !== 'best');
  const pa = agreement(prodRows);
  const pn = agreement(prodNb);
  say(`production today (C seeded draws, 3 plies) | ${fmt(meanOf(prod.map((o) => o.ms)))} / ${fmt(quantile(prod.map((o) => o.ms), 0.99))} / ${fmt(Math.max(...prod.map((o) => o.ms)))} | ${fmt(((meanOf(prod.map((o) => o.ms)) ?? 0) * 60) / 1000, 1)} | ${pa.top} / ${pn.top} | ${pa.grade} / ${pn.grade} | ${pn.kappa} | ${pn.mae}`);
  for (const config of list) {
    const outcomes = replay(config.options).filter((o) => o.rec.split === split);
    const rows = outcomes.map((o) => ({ ref: truth.get(recKey(o.rec.gameId, o.rec.move))! as Verdict, got: o.verdict, ms: o.ms }));
    const nb = rows.filter((x) => x.ref.grade !== 'best');
    const a = agreement(rows);
    const b = agreement(nb);
    const ms = outcomes.map((o) => o.ms);
    say(`${config.name} | ${fmt(meanOf(ms))} / ${fmt(quantile(ms, 0.99))} / ${fmt(Math.max(...ms))} | ${fmt(((meanOf(ms) ?? 0) * 60) / 1000, 1)} | ${a.top} / ${b.top} | ${a.grade} / ${b.grade} | ${b.kappa} | ${b.mae}`);
  }
}

// tuning sweep
say('\n== Tuning sweep (6 tuning games): B+C loss+top with racing, by interval z and half-width ==');
const tuningRows = (config: Config) => replay(config.options).filter((o) => o.rec.split === 'tuning');
let chosen: Config | null = null;
let chosenCost = Infinity;
say('config | mean ms | grade non-Best | top non-Best | meets bar (grade >= 90%, top >= 95%)');
for (const config of grid) {
  const outcomes = tuningRows(config);
  const nb = outcomes.filter((o) => o.rec.ref.grade !== 'best');
  const g = fraction(nb.map((o) => o.verdict.grade === o.rec.ref.grade)) ?? 0;
  const t = fraction(nb.map((o) => o.verdict.topKey === o.rec.ref.topKey)) ?? 0;
  const mean = meanOf(outcomes.map((o) => o.ms)) ?? 0;
  const meets = g >= 0.9 && t >= 0.95;
  say(`${config.name} | ${fmt(mean)} | ${(g * 100).toFixed(1)}% | ${(t * 100).toFixed(1)}% | ${meets ? 'MEETS' : 'below'}`);
  if (meets && mean < chosenCost) { chosen = config; chosenCost = mean; }
}
say(`chosen on tuning: ${chosen ? chosen.name : 'none meets the bar; the most accurate is reported below'}`);
if (!chosen) {
  let bestScore = -1;
  for (const config of grid) {
    const nb = tuningRows(config).filter((o) => o.rec.ref.grade !== 'best');
    const score = (fraction(nb.map((o) => o.verdict.grade === o.rec.ref.grade)) ?? 0) + (fraction(nb.map((o) => o.verdict.topKey === o.rec.ref.topKey)) ?? 0);
    if (score > bestScore) { bestScore = score; chosen = config; }
  }
}
const finalList = [...configs, ...(chosen ? [{ ...chosen, name: `TUNED ${chosen.name}` }] : [])];
report('heldout', finalList);
report('tuning', finalList);
reportVsTrueExact('heldout', finalList);
reportVsTrueExact('tuning', finalList);

// ---- 4. the device caps in whole-game terms ---------------------------------------------------------------------------------
say('\n== Step 4: what a capped version costs on a device (laptop ms; a phone is the laptop times 2 to 5, a guess) ==');
say('config | laptop 60-decision game s (all decisions, held-out) | phone x2 / x5 s (guess) | grade non-Best | top non-Best');
for (const config of finalList.filter((c) => /cap|ms/.test(c.name))) {
  const outcomes = replay(config.options);
  const cost = costRows(outcomes, 'heldout');
  const nb = outcomes.filter((o) => o.rec.split === 'heldout' && o.rec.ref.grade !== 'best');
  const g = fraction(nb.map((o) => o.verdict.grade === o.rec.ref.grade));
  const t = fraction(nb.map((o) => o.verdict.topKey === o.rec.ref.topKey));
  const game = ((meanOf(cost.allMs) ?? 0) * 60) / 1000;
  say(`${config.name} | ${game.toFixed(1)} | ${(game * 2).toFixed(1)} / ${(game * 5).toFixed(1)} | ${g === null ? 'n/a' : (g * 100).toFixed(1)}% | ${t === null ? 'n/a' : (t * 100).toFixed(1)}%`);
}
say(`\n(the all-decision game cost includes the ${cold.length - recs.length} corpus decisions that are not on this path at their unchanged cold cost; the exact-path decisions alone would be ${fmt(((meanOf(recs.map((r) => r.ref.ms)) ?? 0) * 60) / 1000, 1)} s per 60 decisions today)`);
// keep gradeOfLoss referenced for the type system's sake
void gradeOfLoss;
