/**
 * Questions 1 to 3 of the owner's five extra questions (docs/review-bounded-exact-2026-11-07.md). Bot play only; the 501 exact-path decisions (drawable tiles > 0,
 * C(n,k) between 1 and 8,000) of the corpus, from the 3-ply recording (recordExactPass.ts ... 3) and the 2-ply recording (recordExactPass.ts ... 2): each is one pass over
 * EVERY distinct hidden hand, in the same seeded random order, each hand once.
 *
 *   Q1  the current 3-ply result (production: C(n,k) seeded draws with replacement) against 2-ply TRUE enumeration: top-move and grade agreement on all and on non-Best,
 *       bootstrap intervals, cost; and how the paired disagreement is distributed over the reference loss.
 *   Q2  the cost of true 2-ply enumeration for decisions with C <= 300.
 *   Q3  for C > 300: agreement and cost at fixed N = 100, 200, 400 hands (random order, no replacement, a prefix of the enumeration, so it can be resumed) against the
 *       POOLED 2-ply reference (both 2,500-sample passes of the Phase B study combined: seeds 'B-ref' and 'B-alt', 5,000 samples).
 *
 *   npx tsx packages/review-engine/src/devtools/boundedExactQuestions.ts <3ply.jsonl>... -- <2ply.jsonl>...
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordedHandSource, runBounded } from './boundedExactSolver';
import { replayRecordedSelfPlay } from './replayRecordedSelfPlay';
import {
  BAND_EDGES,
  bootstrapInterval,
  canonicalActionKey,
  cohensKappa,
  formatInterval,
  fraction,
  gradeOfLoss,
  meanOf,
  quantile,
  runSamplePass,
  type Grade,
} from './reviewSamplingStudyLib';

type Rec = {
  gameId: string; split: 'tuning' | 'heldout'; move: number; legal: number; C: number; actionKeys: string[]; playedIndex: number;
  ref: { topKey: string; loss: number; grade: Grade; ms: number } | null;
  hands: Array<{ d: number[]; n: number[]; ms: number }>;
};
const args = process.argv.slice(2);
const split = args.indexOf('--');
const load = (files: string[]) => files.flatMap((f) => readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Rec));
const rec3 = load(args.slice(0, split));
const rec2 = load(args.slice(split + 1));
const key = (r: Rec) => `${r.gameId}#${r.move}`;
const by2 = new Map(rec2.map((r) => [key(r), r]));
const say = (line = '') => process.stdout.write(`${line}\n`);
const fmt = (v: number | null, d = 0) => (v === null ? 'n/a' : v.toFixed(d));
const pct = (r: { point: number | null; lo: number | null; hi: number | null }) => formatInterval(r);

type V = { topKey: string; loss: number; grade: Grade };
const verdictOf = (r: Rec, maxHands: number): V & { ms: number; hands: number } => {
  const result = runBounded(recordedHandSource({ actionKeys: r.actionKeys, playedIndex: r.playedIndex, hands: r.hands.map((h) => ({ d: h.d, nodes: h.n, ms: h.ms })) }), { maxHands, earlyStop: false });
  return { topKey: r.actionKeys[result.topIndex]!, loss: result.loss, grade: result.grade, ms: result.ms, hands: result.handsVisited };
};
type Pair = { ref: V; got: V };
function agreement(rows: Pair[]) {
  const nonBest = rows.filter((x) => x.ref.grade !== 'best');
  const f = (items: Pair[], pick: (x: Pair) => boolean) => bootstrapInterval(items, (s) => fraction(s.map(pick)));
  const kappa = (items: Pair[]) => bootstrapInterval(items, (s) => cohensKappa(s.map((x) => x.got.grade), s.map((x) => x.ref.grade)));
  const k = kappa(nonBest);
  return {
    n: rows.length,
    nonBest: nonBest.length,
    topAll: pct(f(rows, (x) => x.got.topKey === x.ref.topKey)),
    gradeAll: pct(f(rows, (x) => x.got.grade === x.ref.grade)),
    topNb: pct(f(nonBest, (x) => x.got.topKey === x.ref.topKey)),
    gradeNb: pct(f(nonBest, (x) => x.got.grade === x.ref.grade)),
    kappaNb: k.point === null ? 'n/a' : `${k.point.toFixed(2)} [${k.lo?.toFixed(2) ?? '?'}, ${k.hi?.toFixed(2) ?? '?'}]`,
    maeNb: fmt(meanOf(nonBest.map((x) => Math.abs(x.got.loss - x.ref.loss))), 3),
    maeAll: fmt(meanOf(rows.map((x) => Math.abs(x.got.loss - x.ref.loss))), 3),
  };
}
const line = (label: string, a: ReturnType<typeof agreement>) => say(`| ${label} | ${a.n} / ${a.nonBest} | ${a.topAll} | ${a.gradeAll} | ${a.topNb} | ${a.gradeNb} | ${a.kappaNb} | ${a.maeNb} |`);
const header = () => { say('| comparison | n all / non-Best | top-move all | grade all | top-move non-Best | grade non-Best | kappa non-Best | MAE loss non-Best |'); say('|---|---|---|---|---|---|---|---|'); };

// ---------------- Q1 ----------------
say(`# Q1. 3-ply (production today) against 2-ply TRUE enumeration (each distinct hand once, random order)\n`);
const q1 = rec3.filter((r) => by2.has(key(r)) && r.ref);
const e3 = new Map(q1.map((r) => [key(r), verdictOf(r, r.C)]));
const e2 = new Map(q1.map((r) => [key(r), verdictOf(by2.get(key(r))!, r.C)]));
say(`${q1.length} decisions with both recordings (tuning ${q1.filter((r) => r.split === 'tuning').length}, held-out ${q1.filter((r) => r.split === 'heldout').length}); bot play\n`);
for (const which of ['heldout', 'tuning'] as const) {
  const items = q1.filter((r) => r.split === which);
  say(`## ${which}\n`);
  header();
  line('2-ply true enum. vs production 3-ply', agreement(items.map((r) => ({ ref: r.ref!, got: e2.get(key(r))! }))));
  line('3-ply true enum. vs production 3-ply (production\'s own error)', agreement(items.map((r) => ({ ref: r.ref!, got: e3.get(key(r))! }))));
  line('2-ply true enum. vs 3-ply true enum. (the depth effect alone)', agreement(items.map((r) => ({ ref: e3.get(key(r))!, got: e2.get(key(r))! }))));
  say('');
}
const costs = (items: Rec[], f: (r: Rec) => number) => items.map(f);
const rows = (label: string, ms: number[]) => say(`| ${label} | ${ms.length} | ${fmt(meanOf(ms))} | ${fmt(quantile(ms, 0.5))} | ${fmt(quantile(ms, 0.9))} | ${fmt(quantile(ms, 0.99))} | ${fmt(Math.max(...ms))} |`);
say('## Cost per decision (ms, laptop, cold; all 501)\n');
say('| | n | mean | median | p90 | p99 | max |\n|---|---|---|---|---|---|---|');
rows('production 3-ply (C draws, with replacement)', costs(q1, (r) => r.ref!.ms));
rows('3-ply true enumeration (every distinct hand)', costs(q1, (r) => e3.get(key(r))!.ms));
rows('2-ply true enumeration (every distinct hand)', costs(q1, (r) => e2.get(key(r))!.ms));

say('\n## Where the 2-ply and 3-ply true-enumeration answers differ, by the 3-ply loss of the played move\n');
say('| 3-ply loss of the played move | n | top move changes | grade changes | mean |loss(3) - loss(2)| |\n|---|---|---|---|---|');
const bins: Array<[string, (loss: number) => boolean]> = [
  [`Best (<= ${BAND_EDGES[0].toFixed(2)})`, (l) => l <= BAND_EDGES[0]],
  [`inaccuracy (${BAND_EDGES[0].toFixed(2)} to ${BAND_EDGES[1].toFixed(2)})`, (l) => l > BAND_EDGES[0] && l <= BAND_EDGES[1]],
  [`mistake (${BAND_EDGES[1].toFixed(2)} to ${BAND_EDGES[2].toFixed(2)})`, (l) => l > BAND_EDGES[1] && l <= BAND_EDGES[2]],
  [`blunder (> ${BAND_EDGES[2].toFixed(2)})`, (l) => l > BAND_EDGES[2]],
];
for (const [label, test] of bins) {
  const items = q1.filter((r) => test(e3.get(key(r))!.loss));
  if (items.length === 0) continue;
  const top = items.filter((r) => e2.get(key(r))!.topKey !== e3.get(key(r))!.topKey).length;
  const grade = items.filter((r) => e2.get(key(r))!.grade !== e3.get(key(r))!.grade).length;
  say(`| ${label} | ${items.length} | ${top} (${((top / items.length) * 100).toFixed(0)}%) | ${grade} (${((grade / items.length) * 100).toFixed(0)}%) | ${fmt(meanOf(items.map((r) => Math.abs(e3.get(key(r))!.loss - e2.get(key(r))!.loss))), 3)} |`);
}
const nearEdge = (l: number) => BAND_EDGES.some((edge) => Math.abs(l - edge) <= 0.25);
const ne = q1.filter((r) => nearEdge(e3.get(key(r))!.loss));
say(`\ngrade changes among decisions within 0.25 points of a band edge: ${ne.filter((r) => e2.get(key(r))!.grade !== e3.get(key(r))!.grade).length} of ${ne.length}; elsewhere: ${q1.filter((r) => !nearEdge(e3.get(key(r))!.loss)).filter((r) => e2.get(key(r))!.grade !== e3.get(key(r))!.grade).length} of ${q1.length - ne.length}`);

// ---------------- Q2 ----------------
say('\n# Q2. Cost of true 2-ply enumeration where C <= 300\n');
const small = rec2.filter((r) => r.C <= 300);
const ms2 = small.map((r) => r.hands.reduce((s, h) => s + h.ms, 0));
say('| bucket | n | mean ms | median | p90 | p99 | max |\n|---|---|---|---|---|---|---|');
rows('C <= 300, 2-ply true enumeration', ms2);
for (const [lo, hi] of [[1, 20], [21, 100], [101, 300]] as const) rows(`C ${lo} to ${hi}`, rec2.filter((r) => r.C >= lo && r.C <= hi).map((r) => r.hands.reduce((s, h) => s + h.ms, 0)));
const small3 = rec3.filter((r) => r.C <= 300 && r.ref);
rows('(production 3-ply on the same C <= 300 decisions)', small3.map((r) => r.ref!.ms));
say(`\nC <= 300 decisions are ${small.length} of ${rec2.length} exact-path decisions; their total 2-ply enumeration time is ${(ms2.reduce((s, x) => s + x, 0) / 1000).toFixed(1)} s against ${(small3.reduce((s, r) => s + r.ref!.ms, 0) / 1000).toFixed(1)} s for production 3-ply.`);

// ---------------- Q3 ----------------
say('\n# Q3. C > 300: fixed N = 100, 200, 400 hands (random order, no replacement, a prefix) against the pooled 2-ply reference\n');
const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/recorded-self-play');
const snapshots = new Map(replayRecordedSelfPlay(dir).map(({ snapshot }) => [`${snapshot.identifiers.gameId}#${snapshot.identifiers.actionNumber}`, snapshot]));
const big = rec2.filter((r) => r.C > 300);
say(`${big.length} decisions with C > 300 (tuning ${big.filter((r) => r.split === 'tuning').length}, held-out ${big.filter((r) => r.split === 'heldout').length}); pooled reference = the sum of the two 2,500-sample passes (seeds B-ref and B-alt, 2 plies, with replacement), 5,000 samples\n`);
type Pooled = V;
const pooled = new Map<string, Pooled>();
for (const r of big) {
  const snapshot = snapshots.get(key(r))!;
  const a = runSamplePass(snapshot, 'B-ref', 2500);
  const b = runSamplePass(snapshot, 'B-alt', 2500);
  if (!a || !b) continue;
  const actions = a.actionKeys.length;
  const sums = new Array<number>(actions).fill(0);
  let n = 0;
  for (const pass of [a, b]) for (const sample of pass.perSample) { for (let i = 0; i < actions; i += 1) sums[i]! += sample[i]!; n += 1; }
  const mean = (i: number) => sums[i]! / n;
  const order = [...Array(actions).keys()].sort((x, y) => (mean(y) !== mean(x) ? mean(y) - mean(x) : a.actionKeys[x]! < a.actionKeys[y]! ? -1 : 1));
  const loss = mean(order[0]!) - mean(a.playedIndex);
  pooled.set(key(r), { topKey: a.actionKeys[order[0]!]!, loss, grade: gradeOfLoss(loss) });
}
const secondary = (items: Rec[], n: number) => items.map((r) => ({ ref: verdictOf(r, r.C) as V, got: verdictOf(r, n) as V }));
for (const which of ['heldout', 'tuning'] as const) {
  const items = big.filter((r) => r.split === which && pooled.has(key(r)));
  say(`## ${which} (${items.length} decisions, ${items.filter((r) => pooled.get(key(r))!.grade !== 'best').length} non-Best by the pooled reference)\n`);
  header();
  for (const n of [100, 200, 400]) line(`N = ${n} vs pooled reference`, agreement(items.map((r) => ({ ref: pooled.get(key(r))!, got: verdictOf(r, n) }))));
  line('(2-ply complete enumeration vs pooled reference)', agreement(items.map((r) => ({ ref: pooled.get(key(r))!, got: verdictOf(r, r.C) }))));
  for (const n of [100, 200, 400]) line(`(N = ${n} vs the complete 2-ply enumeration)`, agreement(secondary(items, n)));
  say('');
}
say('## Cost at fixed N (ms per decision, laptop; the sum of the first N hands\' recorded times), C > 300\n');
say('| | n | mean | median | p90 | p99 | max |\n|---|---|---|---|---|---|---|');
for (const n of [100, 200, 400]) rows(`N = ${n}`, big.map((r) => verdictOf(r, n).ms));
rows('complete 2-ply enumeration', big.map((r) => r.hands.reduce((s, h) => s + h.ms, 0)));
rows('(production 3-ply on the same decisions)', rec3.filter((r) => r.C > 300 && r.ref).map((r) => r.ref!.ms));
const covered = big.filter((r) => r.C <= 400).length;
say(`\n(${covered} of these ${big.length} decisions have C <= 400, so N = 400 already visits every hand for them.)`);
