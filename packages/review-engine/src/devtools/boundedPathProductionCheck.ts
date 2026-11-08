/**
 * Checks the PRODUCTION bounded path (evaluateBoundedExact with its tuned defaults, the decision-id-keyed visiting order, the live search) against the truth: the full 3-ply
 * enumeration of every distinct hand recorded by recordExactPass.ts. docs/review-bounded-exact-2026-11-07.md measured the same rule offline on a recording with another
 * visiting order ('bx-v1'); this shows the code that would ship reproduces it. Bot play only, laptop, cold.
 *
 *   npx tsx packages/review-engine/src/devtools/boundedPathProductionCheck.ts <exact3.jsonl>...
 */
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateBoundedExact } from '../boundedExactSearch';
import { recordedHandSource, runBounded } from './boundedExactSolver';
import { replayRecordedSelfPlay } from './replayRecordedSelfPlay';
import { bootstrapInterval, canonicalActionKey, cohensKappa, formatInterval, fraction, gradeOfLoss, meanOf, quantile, type Grade } from './reviewSamplingStudyLib';

type Rec = { gameId: string; split: 'tuning' | 'heldout'; move: number; C: number; actionKeys: string[]; playedIndex: number; ref: { topKey: string; loss: number; grade: Grade; ms: number } | null; hands: Array<{ d: number[]; n: number[]; ms: number }> };
const records = process.argv.slice(2).flatMap((f) => readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Rec));
const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/recorded-self-play');
const snapshots = new Map(replayRecordedSelfPlay(dir).map(({ snapshot }) => [`${snapshot.identifiers.gameId}#${snapshot.identifiers.actionNumber}`, snapshot]));
const say = (line = '') => process.stdout.write(`${line}\n`);

type Row = {
  split: 'tuning' | 'heldout'; truthGrade: Grade; prodGrade: Grade; topAgree: boolean; gradeAgree: boolean; ms: number; refMs: number; hands: number; total: number; partial: boolean; reason: string;
  /** The complete enumeration under the SAME boneyard realization as the bounded run (the fair truth), and under the recording's. */
  fairGrade: Grade; fairTopAgree: boolean; fairGradeAgree: boolean; fullMs: number; floorTopAgree: boolean; floorGradeAgree: boolean;
};
const rows: Row[] = [];
for (const rec of records) {
  const snapshot = snapshots.get(`${rec.gameId}#${rec.move}`);
  if (!snapshot) continue;
  const truth = runBounded(recordedHandSource({ actionKeys: rec.actionKeys, playedIndex: rec.playedIndex, hands: rec.hands.map((h) => ({ d: h.d, nodes: h.n, ms: h.ms })) }), { maxHands: rec.C, earlyStop: false });
  const started = performance.now();
  const evaluation = evaluateBoundedExact(snapshot)!;
  const ms = performance.now() - started;
  const topKey = canonicalActionKey(evaluation.best.action);
  const grade = gradeOfLoss(evaluation.loss.expectedPointDifferential);
  const fullStarted = performance.now();
  const full = evaluateBoundedExact(snapshot, { minHands: 1_000_000 })!;
  const fullMs = performance.now() - fullStarted;
  const fairGrade = gradeOfLoss(full.loss.expectedPointDifferential);
  const fairTop = canonicalActionKey(full.best.action);
  rows.push({
    split: rec.split, truthGrade: truth.grade, prodGrade: grade,
    topAgree: topKey === rec.actionKeys[truth.topIndex], gradeAgree: grade === truth.grade,
    ms, refMs: rec.ref?.ms ?? 0, hands: evaluation.boundedSearch!.handsVisited, total: evaluation.boundedSearch!.totalHands,
    partial: evaluation.boundedSearch!.partial, reason: evaluation.boundedSearch!.stopReason,
    fairGrade, fairTopAgree: topKey === fairTop, fairGradeAgree: grade === fairGrade, fullMs,
    floorTopAgree: fairTop === rec.actionKeys[truth.topIndex], floorGradeAgree: fairGrade === truth.grade,
  });
}
const fmt = (v: number | null, d = 0) => (v === null ? 'n/a' : v.toFixed(d));
say(`${rows.length} exact-path midgame decisions; production bounded path (tuned defaults, live search, order keyed by decision id) against the full 3-ply enumeration\n`);
say('| set | decisions / non-Best | top-move all | grade all | top-move non-Best | grade non-Best | kappa non-Best | ms mean / median / p99 / max | hands visited (mean share of all) | stop reasons |\n|---|---|---|---|---|---|---|---|---|---|');
for (const split of ['all', 'heldout', 'tuning'] as const) {
  const set = rows.filter((r) => split === 'all' || r.split === split);
  const nonBest = set.filter((r) => r.truthGrade !== 'best');
  const s = (rs: Row[], f: (r: Row) => boolean) => formatInterval(bootstrapInterval(rs, (x) => fraction(x.map(f))));
  const kappa = cohensKappa(nonBest.map((r) => r.truthGrade), nonBest.map((r) => r.prodGrade));
  const reasons = new Map<string, number>();
  for (const r of set) reasons.set(r.reason, (reasons.get(r.reason) ?? 0) + 1);
  const ms = set.map((r) => r.ms);
  say(`| ${split} | ${set.length} / ${nonBest.length} | ${s(set, (r) => r.topAgree)} | ${s(set, (r) => r.gradeAgree)} | ${s(nonBest, (r) => r.topAgree)} | ${s(nonBest, (r) => r.gradeAgree)} | ${fmt(kappa, 2)} | ${fmt(meanOf(ms))} / ${fmt(quantile(ms, 0.5))} / ${fmt(quantile(ms, 0.99))} / ${fmt(Math.max(...ms))} | ${fmt(meanOf(set.map((r) => r.hands)), 1)} (${fmt((meanOf(set.map((r) => r.hands / r.total)) ?? 0) * 100)}%) | ${[...reasons].map(([k, v]) => `${k} ${v}`).join(', ')} |`);
}
say('\n**Against the complete enumeration under the SAME boneyard realization (the fair truth for this code), and the boneyard-order noise floor (that complete enumeration against the recording\'s):**\n');
say('| set | decisions / non-Best (by the fair truth) | top-move all | grade all | top-move non-Best | grade non-Best | kappa non-Best | complete enumeration ms mean / p99 / max | floor: complete(this seed) vs recording, grade non-Best |\n|---|---|---|---|---|---|---|---|---|');
for (const split of ['all', 'heldout', 'tuning'] as const) {
  const set = rows.filter((r) => split === 'all' || r.split === split);
  const nonBest = set.filter((r) => r.fairGrade !== 'best');
  const s = (rs: Row[], f: (r: Row) => boolean) => formatInterval(bootstrapInterval(rs, (x) => fraction(x.map(f))));
  const kappa = cohensKappa(nonBest.map((r) => r.fairGrade), nonBest.map((r) => r.prodGrade));
  const floorNonBest = set.filter((r) => r.truthGrade !== 'best');
  const full = set.map((r) => r.fullMs);
  say(`| ${split} | ${set.length} / ${nonBest.length} | ${s(set, (r) => r.fairTopAgree)} | ${s(set, (r) => r.fairGradeAgree)} | ${s(nonBest, (r) => r.fairTopAgree)} | ${s(nonBest, (r) => r.fairGradeAgree)} | ${fmt(kappa, 2)} | ${fmt(meanOf(full))} / ${fmt(quantile(full, 0.99))} / ${fmt(Math.max(...full))} | ${s(floorNonBest, (r) => r.floorGradeAgree)} (top ${s(floorNonBest, (r) => r.floorTopAgree)}) |`);
}
const refMs = rows.map((r) => r.refMs);
say(`\nProduction today (the branch it replaces; ms recorded in the same run): mean ${fmt(meanOf(refMs))}, median ${fmt(quantile(refMs, 0.5))}, p99 ${fmt(quantile(refMs, 0.99))}, max ${fmt(Math.max(...refMs))}.`);
say(`Partial results: ${rows.filter((r) => r.partial).length} of ${rows.length}.`);
