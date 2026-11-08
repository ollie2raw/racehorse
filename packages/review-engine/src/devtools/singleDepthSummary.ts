/**
 * Summary of singleDepthStudy.ts for docs/review-single-depth-design-2026-11-08.md.
 *   npx tsx packages/review-engine/src/devtools/singleDepthSummary.ts --sd <a.jsonl>... --ladder <a.jsonl>... --rep <a.jsonl>... --wg1 <b1 run.jsonl>... --wg0 <b0 run.jsonl>...
 */
import { readFileSync } from 'node:fs';
import {
  bootstrapInterval, cohensKappa, formatInterval, fraction, meanOf, quantile, verdictAtSamples,
  type Grade, type SamplePass,
} from './reviewSamplingStudyLib';

type At = { top: string; grade: Grade; loss: number; ms: number; lo: number; hi: number };
type Sd = { gameId: string; seat: string; move: number; split: 'tuning' | 'heldout'; path: 'exact' | 'ladder'; distinct: number | null; legal: number; S1: Record<number, At>; S2: Record<number, At>; ref: { top: string; grade: Grade; loss: number } | null; resumeOk: boolean };
type Ladder = { gameId: string; move: number; refA3: SamplePass; refB3: SamplePass };
type Rep = { gameId: string; move: number; P1: { top: string; grade: Grade }; P2: { top: string; grade: Grade }; B1: { top: string; grade: Grade }; B2: { top: string; grade: Grade }; F1: { top: string; grade: Grade }; F2: { top: string; grade: Grade } };
type Wg = { gameId: string; seat: string; move: number; ms: number; lifecycle: string; drawable: number; space: number };

const argv = process.argv.slice(2);
const files = (flag: string): string[] => {
  const i = argv.indexOf(flag);
  if (i === -1) return [];
  const out: string[] = [];
  for (let j = i + 1; j < argv.length && !argv[j]!.startsWith('--'); j += 1) out.push(argv[j]!);
  return out;
};
const load = <T>(list: string[]): T[] => list.flatMap((f) => readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as T));
const sd = load<Sd>(files('--sd'));
const ladder = load<Ladder>(files('--ladder'));
const rep = load<Rep>(files('--rep'));
const wg1 = load<Wg>(files('--wg1'));
const wg0 = load<Wg>(files('--wg0'));
const say = (line = '') => process.stdout.write(`${line}\n`);
const fmt = (v: number | null, d = 0) => (v === null ? 'n/a' : v.toFixed(d));
const sec = (ms: number | null) => (ms === null ? 'n/a' : `${(ms / 1000).toFixed(1)} s`);
const key = (r: { gameId: string; move: number }) => `${r.gameId}#${r.move}`;
const pct = (hits: boolean[]) => formatInterval(bootstrapInterval(hits, (s) => fraction(s)));
const NS = [100, 200, 400] as const;

// references: exact path = the pooled 2 x 1,000 unit reference of the study; ladder = the pooled 2 x 2,500 3-ply pass
const ladderRef = new Map<string, { top: string; grade: Grade }>();
for (const r of ladder) {
  const pooled: SamplePass = { perSample: [...r.refA3.perSample, ...r.refB3.perSample], cumNodes: [], msPerSample: [], actionKeys: r.refA3.actionKeys, playedIndex: r.refA3.playedIndex };
  const v = verdictAtSamples(pooled, 1_000_000);
  ladderRef.set(key(r), { top: r.refA3.actionKeys[v.topIndex]!, grade: v.grade });
}
const refOf = (r: Sd) => (r.path === 'exact' ? r.ref : ladderRef.get(key(r)) ?? null);

say(`${sd.length} decisions with tiles to draw (exact path ${sd.filter((r) => r.path === 'exact').length}, ladder ${sd.filter((r) => r.path === 'ladder').length}); resumable-statistics check (stats of units 0..99 + 100..399 equal units 0..399, exactly): ${sd.filter((r) => r.resumeOk).length} of ${sd.length}\n`);

say('## 1. Fixed-N units at 3 plies: repeatability and agreement with the reference, by N\n');
say('Self = the same decision run twice with different seed keys. Reference = pooled 2 x 1,000 units (exact path) / pooled 2 x 2,500 3-ply samples (ladder). Non-Best is defined by the second run in "self" and by the reference in "vs reference".\n');
say('| path | N | decisions / non-Best (self) | self: top move, all | self: grade, all | self: top move, non-Best | self: grade, non-Best | vs reference: decisions / non-Best | top move, all | grade, all | top move, non-Best | grade, non-Best | kappa, non-Best |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const path of ['exact', 'ladder', 'all'] as const) {
  const set = sd.filter((r) => path === 'all' || r.path === path);
  for (const n of NS) {
    const selfNon = set.filter((r) => r.S2[n]!.grade !== 'best');
    const pairs: Array<{ top: boolean; grade: boolean; refGrade: Grade; runGrade: Grade }> = [];
    for (const r of set) {
      const ref = refOf(r);
      if (!ref) continue;
      for (const run of [r.S1[n]!, r.S2[n]!]) pairs.push({ top: run.top === ref.top, grade: run.grade === ref.grade, refGrade: ref.grade, runGrade: run.grade });
    }
    const nonBest = pairs.filter((p) => p.refGrade !== 'best');
    const kappa = cohensKappa(nonBest.map((p) => p.refGrade), nonBest.map((p) => p.runGrade));
    say(`| ${path} | ${n} | ${set.length} / ${selfNon.length} | ${pct(set.map((r) => r.S1[n]!.top === r.S2[n]!.top))} | ${pct(set.map((r) => r.S1[n]!.grade === r.S2[n]!.grade))} | ${pct(selfNon.map((r) => r.S1[n]!.top === r.S2[n]!.top))} | ${pct(selfNon.map((r) => r.S1[n]!.grade === r.S2[n]!.grade))} | ${pairs.length} / ${nonBest.length} | ${pct(pairs.map((p) => p.top))} | ${pct(pairs.map((p) => p.grade))} | ${pct(nonBest.map((p) => p.top))} | ${pct(nonBest.map((p) => p.grade))} | ${fmt(kappa, 2)} |`);
  }
}

say('\n## 2. The methods that exist today against the same reference (exact path, 3 plies)\n');
say('Reference = pooled 2 x 1,000 units drawn over hands AND boneyard orders. Non-Best by the reference. Each method has two runs (seeds 1, 2); both are counted.\n');
say('| method | runs / non-Best | top move, all | grade, all | top move, non-Best | grade, non-Best | kappa, non-Best |\n|---|---|---|---|---|---|---|');
const refByKey = new Map(sd.filter((r) => r.path === 'exact').map((r) => [key(r), r.ref!]));
const joined = rep.filter((r) => refByKey.has(key(r)));
for (const [label, names] of [['production today (C draws with replacement)', ['P1', 'P2']], ['bounded path (shipping, tuned)', ['B1', 'B2']], ['full enumeration of the distinct hands', ['F1', 'F2']]] as const) {
  const pairs = joined.flatMap((r) => names.map((n) => ({ run: r[n as 'P1'], ref: refByKey.get(key(r))! })));
  const nonBest = pairs.filter((p) => p.ref.grade !== 'best');
  const kappa = cohensKappa(nonBest.map((p) => p.ref.grade), nonBest.map((p) => p.run.grade));
  say(`| ${label} | ${pairs.length} / ${nonBest.length} | ${pct(pairs.map((p) => p.run.top === p.ref.top))} | ${pct(pairs.map((p) => p.run.grade === p.ref.grade))} | ${pct(nonBest.map((p) => p.run.top === p.ref.top))} | ${pct(nonBest.map((p) => p.run.grade === p.ref.grade))} | ${fmt(kappa, 2)} |`);
}
for (const n of NS) {
  const pairs = sd.filter((r) => r.path === 'exact').flatMap((r) => [r.S1[n]!, r.S2[n]!].map((run) => ({ run, ref: r.ref! })));
  const nonBest = pairs.filter((p) => p.ref.grade !== 'best');
  const kappa = cohensKappa(nonBest.map((p) => p.ref.grade), nonBest.map((p) => p.run.grade));
  say(`| fixed N = ${n} units, 3 plies | ${pairs.length} / ${nonBest.length} | ${pct(pairs.map((p) => p.run.top === p.ref.top))} | ${pct(pairs.map((p) => p.run.grade === p.ref.grade))} | ${pct(nonBest.map((p) => p.run.top === p.ref.top))} | ${pct(nonBest.map((p) => p.run.grade === p.ref.grade))} | ${fmt(kappa, 2)} |`);
}

say('\n## 3. Cost per decision of the fixed-N units (laptop ms, one run, cold)\n');
say('| path | N | decisions | mean | median | p90 | p99 | max |\n|---|---|---|---|---|---|---|---|');
for (const path of ['exact', 'ladder', 'all'] as const) {
  const set = sd.filter((r) => path === 'all' || r.path === path);
  for (const n of NS) {
    const ms = set.map((r) => r.S1[n]!.ms);
    say(`| ${path} | ${n} | ${set.length} | ${fmt(meanOf(ms), 1)} | ${fmt(quantile(ms, 0.5), 1)} | ${fmt(quantile(ms, 0.9))} | ${fmt(quantile(ms, 0.99))} | ${fmt(Math.max(...ms))} |`);
  }
}

say('\n## 4. Whole-game laptop time: the shipping paths against fixed-N units\n');
const costKey = new Map(sd.map((r) => [key(r), r]));
const fixed = (rows: Wg[], n: number) => rows.map((r) => ({ ...r, ms: costKey.has(key(r)) ? costKey.get(key(r))!.S1[n]!.ms : r.ms }));
const variants: Array<[string, Wg[]]> = [
  ['shipping today (flag off)', wg0],
  ['shipping with the bounded flag on', wg1],
  ['fixed N = 100 units, 3 plies (everything with tiles to draw; forced and locked yards as shipped)', fixed(wg1, 100)],
  ['fixed N = 200', fixed(wg1, 200)],
  ['fixed N = 400 (= 100 now, extended to 400 later: the extension is a merge, so the total is the N = 400 cost)', fixed(wg1, 400)],
];
const gameTotals = (rows: Wg[], by: (r: Wg) => string) => {
  const m = new Map<string, number>();
  for (const r of rows) m.set(by(r), (m.get(by(r)) ?? 0) + r.ms);
  return [...m.values()];
};
say('| path | unit | mean | p90 | p99 | min | max | x2 (phone, guess) | x5 (phone, guess) | x45 (Render free, measured ratio) |\n|---|---|---|---|---|---|---|---|---|---|');
for (const [name, rows] of variants) {
  for (const [unit, totals] of [['game', gameTotals(rows, (r) => r.gameId)], ['one seat', gameTotals(rows, (r) => `${r.gameId}|${r.seat}`)]] as const) {
    const m = meanOf(totals)!;
    say(`| ${name} | ${unit} (${totals.length}) | ${sec(m)} | ${sec(quantile(totals, 0.9))} | ${sec(quantile(totals, 0.99))} | ${sec(Math.min(...totals))} | ${sec(Math.max(...totals))} | ${sec(m * 2)} | ${sec(m * 5)} | ${sec(m * 45)} |`);
  }
}
say('\n(p90 and p99 of 10 games or 20 seat-games are the second-largest and the largest value.)');

say('\n## 5. Server verification: recompute k random decisions after submission\n');
say('Cost of recomputing ONE decision at N units, laptop ms, and on the free Render instance (x45):\n');
say('| recompute | mean | p90 | p99 (one unlucky decision) | max | mean on Render x45 | p99 on Render x45 |\n|---|---|---|---|---|---|---|');
for (const n of NS) {
  const ms = sd.map((r) => r.S1[n]!.ms);
  say(`| a decision at N = ${n} | ${fmt(meanOf(ms), 1)} ms | ${fmt(quantile(ms, 0.9))} ms | ${fmt(quantile(ms, 0.99))} ms | ${fmt(Math.max(...ms))} ms | ${sec((meanOf(ms) ?? 0) * 45)} | ${sec((quantile(ms, 0.99) ?? 0) * 45)} |`);
}
const cheap = sd.filter((r) => r.S1[100]!.ms <= 100);
say(`\nIf the verifier picks only among decisions whose N = 100 cost is at most 100 ms on the laptop (${cheap.length} of ${sd.length}, ${((cheap.length / sd.length) * 100).toFixed(0)}%): mean ${fmt(meanOf(cheap.map((r) => r.S1[100]!.ms)), 1)} ms at N = 100, ${fmt(meanOf(cheap.map((r) => r.S1[400]!.ms)), 1)} ms at N = 400; x45: ${sec((meanOf(cheap.map((r) => r.S1[100]!.ms)) ?? 0) * 45)} and ${sec((meanOf(cheap.map((r) => r.S1[400]!.ms)) ?? 0) * 45)}.`);
