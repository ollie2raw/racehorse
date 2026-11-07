/**
 * Q1, the independent check (docs/review-bounded-exact-2026-11-07.md). Agreement between 2-ply and 3-ply is not quality. On the exact-path decisions where the two
 * depths (both TRUE enumeration, from the recordings) pick a different top move or a different grade for the played move, play every candidate OUT TO THE END OF THE
 * HAND against sampled opponent hands (the shared rolloutValue.ts helper and the Fritz 'standard' policy of reviewRolloutCalibration.ts): which depth's top move does
 * the whole-hand view prefer, and whose loss figure is closer to the whole-hand loss? Bot play only; the rollout is itself a noisy yardstick (median standard error
 * about 0.8 points for one decision, per docs/review-quality-baseline-2026-11-02.md), so only the averages are read.
 *
 *   npx tsx packages/review-engine/src/devtools/depthRolloutCheck.ts <3ply.jsonl>... -- <2ply.jsonl>... [samples=200]
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordedHandSource, runBounded } from './boundedExactSolver';
import { replayRecordedSelfPlay } from './replayRecordedSelfPlay';
import { rolloutGain, sampleAllocations } from '../rolloutValue';
import { bootstrapInterval, canonicalActionKey, formatInterval, fraction, meanOf, type Grade } from './reviewSamplingStudyLib';

type Rec = { gameId: string; split: 'tuning' | 'heldout'; move: number; C: number; actionKeys: string[]; playedIndex: number; hands: Array<{ d: number[]; n: number[]; ms: number }> };
const args = process.argv.slice(2);
const sep = args.indexOf('--');
const samplesArg = args.slice(sep + 1).find((a) => /^\d+$/.test(a));
const samples = Number(samplesArg ?? '200');
const load = (files: string[]) => files.flatMap((f) => readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Rec));
const rec3 = load(args.slice(0, sep));
const rec2 = load(args.slice(sep + 1).filter((a) => !/^\d+$/.test(a)));
const key = (r: Rec) => `${r.gameId}#${r.move}`;
const by2 = new Map(rec2.map((r) => [key(r), r]));
const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/recorded-self-play');
const snapshots = new Map(replayRecordedSelfPlay(dir).map(({ snapshot }) => [`${snapshot.identifiers.gameId}#${snapshot.identifiers.actionNumber}`, snapshot]));
const say = (line = '') => process.stdout.write(`${line}\n`);
const fmt = (v: number | null, d = 2) => (v === null ? 'n/a' : v.toFixed(d));

const verdict = (r: Rec) => {
  const result = runBounded(recordedHandSource({ actionKeys: r.actionKeys, playedIndex: r.playedIndex, hands: r.hands.map((h) => ({ d: h.d, nodes: h.n, ms: h.ms })) }), { maxHands: r.C, earlyStop: false });
  return { topIndex: result.topIndex, loss: result.loss, grade: result.grade as Grade };
};

type Row = { gameId: string; topChange: boolean; gradeChange: boolean; loss3: number; loss2: number; rolloutLoss3: number; rolloutLoss2: number; diff32: number; se: number; prefers: '3-ply' | '2-ply' | 'neither' };
const rows: Row[] = [];
for (const r3 of rec3) {
  const r2 = by2.get(key(r3));
  const snapshot = snapshots.get(key(r3));
  if (!r2 || !snapshot) continue;
  const v3 = verdict(r3);
  const v2 = verdict(r2);
  const topChange = v3.topIndex !== v2.topIndex;
  const gradeChange = v3.grade !== v2.grade;
  if (!topChange && !gradeChange) continue;
  const actions = snapshot.legalActions;
  const allocations = [...sampleAllocations(snapshot, 'A', samples / 2), ...sampleAllocations(snapshot, 'B', samples / 2)];
  if (allocations.length < 20) continue;
  const need = new Set([v3.topIndex, v2.topIndex, r3.playedIndex]);
  const gains = new Map<number, number[]>();
  for (const i of need) gains.set(i, allocations.map((a) => rolloutGain(snapshot, a, actions[i]!, 'standard')));
  const m = (i: number) => meanOf(gains.get(i)!)!;
  const paired = gains.get(v3.topIndex)!.map((g, j) => g - gains.get(v2.topIndex)![j]!);
  const mean = meanOf(paired)!;
  const sd = Math.sqrt(paired.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, paired.length - 1));
  const se = sd / Math.sqrt(paired.length);
  rows.push({
    gameId: r3.gameId, topChange, gradeChange, loss3: v3.loss, loss2: v2.loss,
    rolloutLoss3: m(v3.topIndex) - m(r3.playedIndex), rolloutLoss2: m(v2.topIndex) - m(r3.playedIndex),
    diff32: mean, se, prefers: !topChange ? 'neither' : mean > 2 * se ? '3-ply' : mean < -2 * se ? '2-ply' : 'neither',
  });
}

say(`${rows.length} decisions where 2-ply and 3-ply (both true enumeration) differ in the top move (${rows.filter((r) => r.topChange).length}) or the grade of the played move (${rows.filter((r) => r.gradeChange).length}); ${samples} rollouts per candidate (Fritz 'standard' policy), bot play\n`);
const tops = rows.filter((r) => r.topChange);
say('## Which depth\'s top move does the whole-hand view prefer? (decisions where the top move differs)\n');
say(`- 3-ply's move preferred by more than 2 standard errors: ${tops.filter((r) => r.prefers === '3-ply').length} of ${tops.length}`);
say(`- 2-ply's move preferred by more than 2 standard errors: ${tops.filter((r) => r.prefers === '2-ply').length} of ${tops.length}`);
say(`- neither (within 2 standard errors): ${tops.filter((r) => r.prefers === 'neither').length} of ${tops.length}`);
const advantage = bootstrapInterval(tops, (s) => meanOf(s.map((r) => r.diff32)));
say(`- mean rollout advantage of the 3-ply move over the 2-ply move: ${fmt(advantage.point)} points [${fmt(advantage.lo)}, ${fmt(advantage.hi)}] (positive favours 3-ply)`);
const better3 = bootstrapInterval(tops, (s) => fraction(s.map((r) => r.diff32 > 0)));
say(`- share of these decisions where the 3-ply move has the higher rollout mean: ${formatInterval(better3)}`);
say(`- mean |rollout difference| between the two moves: ${fmt(meanOf(tops.map((r) => Math.abs(r.diff32))))} points; mean standard error of one such comparison: ${fmt(meanOf(tops.map((r) => r.se)))}`);

say('\n## Whose loss figure is closer to the whole-hand loss of the played move? (all decisions where the depths differ)\n');
const err3 = rows.map((r) => Math.abs(r.loss3 - r.rolloutLoss3));
const err2 = rows.map((r) => Math.abs(r.loss2 - r.rolloutLoss2));
const closer3 = rows.map((_, i) => err3[i]! < err2[i]!);
say(`- mean |claimed loss - rollout loss|: 3-ply ${fmt(meanOf(err3))}, 2-ply ${fmt(meanOf(err2))} points`);
const diffErr = bootstrapInterval(rows.map((_, i) => err2[i]! - err3[i]!), (s) => meanOf(s));
say(`- 2-ply error minus 3-ply error: ${fmt(diffErr.point)} [${fmt(diffErr.lo)}, ${fmt(diffErr.hi)}] (positive favours 3-ply)`);
say(`- the 3-ply figure is closer to the rollout in ${closer3.filter(Boolean).length} of ${rows.length}`);
void canonicalActionKey;
