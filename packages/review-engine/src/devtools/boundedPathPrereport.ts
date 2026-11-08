/**
 * The two pre-reports of the bounded-path owner brief (docs/review-bounded-path-prereport-2026-11-07.md). Laptop, bot play, the recorded corpus.
 *
 *  (1) the LADDER path (decisions with a hidden-hand space above 8,000, which the ladder searches at 2 plies today) at 3 plies, N = 100 and N = 200 hands: cost and agreement
 *      against a 3-ply POOLED reference (two independent 2,500-sample passes combined, seeds distinct from the test pass).
 *  (2) the FLIP MATRIX of grades between a 2-ply N = 100 quick pass and the 3-ply verdict for the same decisions: how many badges would change if a quick pass were
 *      upgraded to 3 plies. The 3-ply verdict is the pooled reference for ladder decisions and the full 3-ply enumeration for exact-path decisions; the 2-ply N = 100 quick pass is
 *      the first 100 samples of the 2-ply pass (ladder) or the first 100 hands of the 2-ply enumeration (exact path). A sampling-only noise floor is reported beside it.
 *
 *   npx tsx packages/review-engine/src/devtools/boundedPathPrereport.ts <ladder.jsonl>... -- <exact3.jsonl>... -- <exact2.jsonl>...
 */
import { readFileSync } from 'node:fs';
import { recordedHandSource, runBounded } from './boundedExactSolver';
import {
  bootstrapInterval, cohensKappa, formatInterval, fraction, GRADES, meanOf, quantile, verdictAtSamples,
  type Grade, type SamplePass,
} from './reviewSamplingStudyLib';

type Split = 'tuning' | 'heldout';
type LadderRec = { gameId: string; move: number; split: Split; drawable: number; legal: number; test3: SamplePass; test2: SamplePass; refA3: SamplePass; refB3: SamplePass };
type ExactRec = { gameId: string; move: number; split: Split; C: number; actionKeys: string[]; playedIndex: number; hands: Array<{ d: number[]; n: number[]; ms: number }> };

const args = process.argv.slice(2);
const cut = (list: string[], index: number): string[] => {
  const parts: string[][] = [[]];
  for (const a of list) a === '--' ? parts.push([]) : parts[parts.length - 1]!.push(a);
  return parts[index] ?? [];
};
const load = <T>(files: string[]): T[] => files.flatMap((f) => readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as T));
const ladder = load<LadderRec>(cut(args, 0));
const exact3 = load<ExactRec>(cut(args, 1));
const exact2 = load<ExactRec>(cut(args, 2));
const say = (line = '') => process.stdout.write(`${line}\n`);
const pct = (r: { point: number | null; lo: number | null; hi: number | null }) => formatInterval(r);
const fmt = (v: number | null, d = 0) => (v === null ? 'n/a' : v.toFixed(d));

const pool = (a: SamplePass, b: SamplePass): SamplePass => ({
  perSample: [...a.perSample, ...b.perSample],
  cumNodes: [...a.cumNodes, ...b.cumNodes],
  msPerSample: [...a.msPerSample, ...b.msPerSample],
  actionKeys: a.actionKeys,
  playedIndex: a.playedIndex,
});
const msUpTo = (pass: SamplePass, n: number) => pass.msPerSample.slice(0, n).reduce((s, x) => s + x, 0);

type Row = { split: Split; topAgree: boolean; gradeAgree: boolean; refGrade: Grade; testGrade: Grade; absLoss: number; ms: number };
const summarize = (name: string, rows: Row[]) => {
  const nonBest = rows.filter((r) => r.refGrade !== 'best');
  const stat = (set: Row[], fn: (r: Row) => boolean) => bootstrapInterval(set, (s) => fraction(s.map(fn)));
  const kappa = bootstrapInterval(nonBest, (s) => cohensKappa(s.map((r) => r.refGrade), s.map((r) => r.testGrade)));
  const mae = bootstrapInterval(nonBest, (s) => meanOf(s.map((r) => r.absLoss)));
  const ms = rows.map((r) => r.ms);
  say(`| ${name} | ${rows.length} / ${nonBest.length} | ${pct(stat(rows, (r) => r.topAgree))} | ${pct(stat(rows, (r) => r.gradeAgree))} | ${pct(stat(nonBest, (r) => r.topAgree))} | ${pct(stat(nonBest, (r) => r.gradeAgree))} | ${kappa.point === null ? 'n/a' : kappa.point.toFixed(2)} | ${mae.point === null ? 'n/a' : mae.point.toFixed(3)} | ${fmt(meanOf(ms))} / ${fmt(quantile(ms, 0.5))} / ${fmt(quantile(ms, 0.99))} / ${fmt(Math.max(...ms))} |`);
};

// ---------------------------------------------------------------- (1)
say('## (1) The ladder path at 3 plies, N = 100 and N = 200, against a 3-ply pooled reference\n');
say(`${ladder.length} ladder decisions (tuning ${ladder.filter((r) => r.split === 'tuning').length}, held-out ${ladder.filter((r) => r.split === 'heldout').length}); reference = two independent 3-ply passes of ${ladder[0]?.refA3.perSample.length ?? 0} samples pooled (${(ladder[0]?.refA3.perSample.length ?? 0) * 2}); the test pass uses a different seed.\n`);
const header = '| test | decisions / non-Best | top-move all | grade all | top-move non-Best | grade non-Best | kappa non-Best | MAE non-Best | ms per decision: mean / median / p99 / max |\n|---|---|---|---|---|---|---|---|---|';
for (const split of ['all', 'heldout', 'tuning'] as const) {
  const recs = ladder.filter((r) => split === 'all' || r.split === split);
  say(`### ${split === 'all' ? 'All ladder decisions' : split === 'heldout' ? 'Held-out games' : 'Tuning games'}\n`);
  say(header);
  for (const [label, depth, n] of [['3-ply N = 100', 3, 100], ['3-ply N = 200', 3, 200], ['2-ply N = 100 (today\'s tier 1)', 2, 100], ['2-ply N = 200', 2, 200]] as const) {
    const rows: Row[] = recs.map((r) => {
      const ref = verdictAtSamples(pool(r.refA3, r.refB3), 1_000_000);
      const pass = depth === 3 ? r.test3 : r.test2;
      const v = verdictAtSamples(pass, n);
      return { split: r.split, topAgree: v.topIndex === ref.topIndex, gradeAgree: v.grade === ref.grade, refGrade: ref.grade, testGrade: v.grade, absLoss: Math.abs(v.loss - ref.loss), ms: msUpTo(pass, n) };
    });
    summarize(label, rows);
  }
  say();
}

// ---------------------------------------------------------------- (2)
say('## (2) Flip matrix: 2-ply N = 100 quick pass against the 3-ply verdict, same decisions\n');
type Pair = { path: 'ladder' | 'exact'; split: Split; quick: Grade; deep: Grade; noise: Grade; gameId: string; quickTop: number; deepTop: number };
const pairs: Pair[] = [];
for (const r of ladder) {
  const deep = verdictAtSamples(pool(r.refA3, r.refB3), 1_000_000);
  const quick = verdictAtSamples(r.test2, 100);
  const noise = verdictAtSamples(r.test3, 100); // 3-ply, N = 100, independent seed: the sampling-only comparison
  pairs.push({ path: 'ladder', split: r.split, quick: quick.grade, deep: deep.grade, noise: noise.grade, gameId: r.gameId, quickTop: quick.topIndex, deepTop: deep.topIndex });
}
const by2 = new Map(exact2.map((r) => [`${r.gameId}#${r.move}`, r]));
for (const r3 of exact3) {
  const r2 = by2.get(`${r3.gameId}#${r3.move}`);
  if (!r2) continue;
  const run = (rec: ExactRec, hands: number) => runBounded(recordedHandSource({ actionKeys: rec.actionKeys, playedIndex: rec.playedIndex, hands: rec.hands.map((h) => ({ d: h.d, nodes: h.n, ms: h.ms })) }), { maxHands: hands, earlyStop: false });
  const deep = run(r3, r3.C);
  const quick = run(r2, 100);
  const noise = run(r3, 100); // the 3-ply pass over the same first 100 hands
  pairs.push({ path: 'exact', split: r3.split, quick: quick.grade, deep: deep.grade, noise: noise.grade, gameId: r3.gameId, quickTop: quick.topIndex, deepTop: deep.topIndex });
}
const matrix = (set: Pair[], a: 'quick' | 'noise') => {
  const m = new Map<string, number>();
  for (const p of set) m.set(`${p[a]}>${p.deep}`, (m.get(`${p[a]}>${p.deep}`) ?? 0) + 1);
  return m;
};
const printMatrix = (title: string, set: Pair[], a: 'quick' | 'noise') => {
  const m = matrix(set, a);
  say(`**${title}** (${set.length} decisions; rows = the quick pass's badge, columns = the 3-ply badge)\n`);
  say(`| quick \\ 3-ply | ${GRADES.join(' | ')} | row total | changes |\n|---|---|---|---|---|---|---|`);
  for (const row of GRADES) {
    const counts = GRADES.map((col) => m.get(`${row}>${col}`) ?? 0);
    const total = counts.reduce((s, x) => s + x, 0);
    say(`| ${row} | ${counts.map((c, i) => (GRADES[i] === row ? `**${c}**` : String(c))).join(' | ')} | ${total} | ${total - counts[GRADES.indexOf(row)]!} (${total ? (((total - counts[GRADES.indexOf(row)]!) / total) * 100).toFixed(0) : 0}%) |`);
  }
  say();
};
const flipStats = (name: string, set: Pair[], a: 'quick' | 'noise') => {
  const changed = (p: Pair) => p[a] !== p.deep;
  const order = (g: Grade) => GRADES.indexOf(g);
  const nonBestQuick = set.filter((p) => p[a] !== 'best');
  const bestDeep = set.filter((p) => p.deep === 'best');
  const harsher = set.filter((p) => order(p.deep) > order(p[a]));
  const milder = set.filter((p) => order(p.deep) < order(p[a]));
  const total = bootstrapInterval(set, (s) => fraction(s.map(changed)));
  const nbq = bootstrapInterval(nonBestQuick, (s) => fraction(s.map(changed)));
  const h = bootstrapInterval(set, (s) => fraction(s.map((p) => order(p.deep) > order(p[a]))));
  const m = bootstrapInterval(set, (s) => fraction(s.map((p) => order(p.deep) < order(p[a]))));
  const bestToErr = bootstrapInterval(set.filter((p) => p[a] === 'best'), (s) => fraction(s.map((p) => p.deep !== 'best')));
  say(`| ${name} | ${set.length} | ${pct(total)} | ${pct(h)} (${harsher.length}) | ${pct(m)} (${milder.length}) | ${pct(nbq)} (of ${nonBestQuick.length} non-Best quick badges) | ${pct(bestToErr)} (of ${set.filter((p) => p[a] === 'best').length} quick Bests) | ${bestDeep.length} |`);
};
const groups: Array<[string, (p: Pair) => boolean]> = [
  ['all decisions', () => true],
  ['ladder path', (p) => p.path === 'ladder'],
  ['exact path', (p) => p.path === 'exact'],
  ['held-out games', (p) => p.split === 'heldout'],
  ['tuning games', (p) => p.split === 'tuning'],
];
printMatrix('All decisions: 2-ply N = 100 quick pass vs 3-ply', pairs, 'quick');
printMatrix('Ladder path only', pairs.filter((p) => p.path === 'ladder'), 'quick');
printMatrix('Exact path only', pairs.filter((p) => p.path === 'exact'), 'quick');
printMatrix('Noise floor, all decisions: 3-ply N = 100 (independent seed / the same first 100 hands) vs the same 3-ply verdict (sampling only, no depth change)', pairs, 'noise');
say('| group | decisions | badge changes | become harsher | become milder | non-Best quick badges that change | quick Bests that become an error | decisions that are Best at 3 plies |\n|---|---|---|---|---|---|---|---|');
for (const [name, fn] of groups) flipStats(`${name}: 2-ply N=100 vs 3-ply`, pairs.filter(fn), 'quick');
for (const [name, fn] of groups.slice(0, 3)) flipStats(`${name}: noise floor (3-ply N=100)`, pairs.filter(fn), 'noise');
say();
const topChange = bootstrapInterval(pairs, (s) => fraction(s.map((p) => p.quickTop !== p.deepTop)));
say(`Top move differs between the 2-ply N = 100 pass and the 3-ply verdict: ${pct(topChange)}.`);
const games = new Map<string, Pair[]>();
for (const p of pairs) games.set(p.gameId, [...(games.get(p.gameId) ?? []), p]);
const perGame = [...games.values()].map((g) => g.filter((p) => p.quick !== p.deep).length);
say(`Badges that change per game (these ${pairs.length} non-forced decisions over ${games.size} games): mean ${fmt(meanOf(perGame), 1)}, median ${fmt(quantile(perGame, 0.5))}, max ${fmt(Math.max(...perGame))}; decisions per game: mean ${fmt(meanOf([...games.values()].map((g) => g.length)), 1)}.`);
