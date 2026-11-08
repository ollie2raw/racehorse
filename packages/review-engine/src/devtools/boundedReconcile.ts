/**
 * Items 1 and 2 of the 2026-11-08 brief (docs/review-single-depth-design-2026-11-08.md): reconcile #501 with #502, and production's self-agreement. Reads the output of
 * boundedPathRepeatability.ts (501 exact-path midgame decisions, every method run with two seeds) and runs the shipping bounded path on the locked yards.
 *   npx tsx packages/review-engine/src/devtools/boundedReconcile.ts <rep.jsonl>...
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateBoundedExact, buildHandUniverse } from '../boundedExactSearch';
import { replayRecordedSelfPlay } from './replayRecordedSelfPlay';
import { bootstrapInterval, cohensKappa, formatInterval, fraction, meanOf, type Grade } from './reviewSamplingStudyLib';

type Run = { top: string; grade: Grade; loss: number; ms: number; hands?: number; reason?: string };
type Row = { split: 'tuning' | 'heldout'; C: number; P1: Run; P2: Run; B1: Run; B2: Run; F1: Run; F2: Run };
const rows = process.argv.slice(2).flatMap((f) => readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Row));
const say = (line = '') => process.stdout.write(`${line}\n`);
const pct = (hits: boolean[]) => formatInterval(bootstrapInterval(hits, (s) => fraction(s)));

say(`${rows.length} exact-path midgame decisions (tuning ${rows.filter((r) => r.split === 'tuning').length}, held-out ${rows.filter((r) => r.split === 'heldout').length})\n`);

// ---- (a) (b) (c): how a bounded run ends
say('## How the shipping bounded path ends a decision\n');
say('| set | decisions | (a) ran to full enumeration (complete) | (b) stopped early by the sequential rule (resolved) | (c) hit a cap (partial) | hands visited, mean share of the distinct hands |\n|---|---|---|---|---|---|');
const share = (n: number, d: number) => `${n} (${((n / d) * 100).toFixed(1)}%)`;
for (const [name, set] of [['all', rows], ['held-out', rows.filter((r) => r.split === 'heldout')], ['tuning', rows.filter((r) => r.split === 'tuning')]] as const) {
  const count = (reason: string) => set.filter((r) => r.B1.reason === reason).length;
  const hands = meanOf(set.map((r) => (r.B1.hands ?? 0) / r.C)) ?? 0;
  say(`| ${name} | ${set.length} | ${share(count('complete'), set.length)} | ${share(count('resolved'), set.length)} | ${share(set.length - count('complete') - count('resolved'), set.length)} | ${(hands * 100).toFixed(0)}% |`);
}
const byC = (lo: number, hi: number) => rows.filter((r) => r.C >= lo && r.C <= hi);
say('\nBy number of distinct hands C(n,k) (stop reasons of the seed-1 run):\n');
say('| C | decisions | complete | resolved | mean share of hands visited |\n|---|---|---|---|---|');
for (const [lo, hi] of [[1, 20], [21, 164], [165, 999], [1000, 2999], [3000, 4999], [5000, 8000]] as const) {
  const set = byC(lo, hi);
  if (set.length === 0) continue;
  say(`| ${lo} to ${hi} | ${set.length} | ${set.filter((r) => r.B1.reason === 'complete').length} | ${set.filter((r) => r.B1.reason === 'resolved').length} | ${(((meanOf(set.map((r) => (r.B1.hands ?? 0) / r.C)) ?? 0)) * 100).toFixed(0)}% |`);
}

// locked yards: the cap
const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/recorded-self-play');
const locked = replayRecordedSelfPlay(dir).filter(({ snapshot, evaluation }) => snapshot.preAction.boneyard.drawableCount === 0 && evaluation.candidates.length > 1 && buildHandUniverse(snapshot) !== null);
const ends = locked.map(({ snapshot }) => evaluateBoundedExact(snapshot)!.boundedSearch!.stopReason);
say(`\nLocked yards (${locked.length} decisions, exhaustive to the hand's end, 1,000,000-node cap): complete ${ends.filter((e) => e === 'complete').length}, cap ${ends.filter((e) => e === 'node-cap').length}, other ${ends.filter((e) => e !== 'complete' && e !== 'node-cap').length}.`);

// ---- agreement against the deterministic reference (full enumeration of the same decision, same seed)
say('\n## Agreement of the shipping bounded path with the full enumeration of the same decision (same seed: a deterministic reference)\n');
say('Non-Best = the REFERENCE grade is not Best. Bootstrap 95% intervals.\n');
say('| set | decisions / non-Best | top move, all | grade, all | top move, non-Best | grade, non-Best | kappa, non-Best |\n|---|---|---|---|---|---|---|');
const table = (label: string, set: Row[], a: 'B1' | 'B2' | 'P1' | 'P2' | 'F1' | 'F2', ref: 'F1' | 'F2' | 'P1' | 'B1') => {
  const nonBest = set.filter((r) => r[ref].grade !== 'best');
  const kappa = cohensKappa(nonBest.map((r) => r[ref].grade), nonBest.map((r) => r[a].grade));
  say(`| ${label} | ${set.length} / ${nonBest.length} | ${pct(set.map((r) => r[a].top === r[ref].top))} | ${pct(set.map((r) => r[a].grade === r[ref].grade))} | ${pct(nonBest.map((r) => r[a].top === r[ref].top))} | ${pct(nonBest.map((r) => r[a].grade === r[ref].grade))} | ${kappa === null ? 'n/a' : kappa.toFixed(2)} |`);
};
for (const [name, set] of [['all', rows], ['held-out', rows.filter((r) => r.split === 'heldout')], ['tuning', rows.filter((r) => r.split === 'tuning')]] as const) {
  table(`${name}: bounded seed 1 vs full enumeration seed 1`, set, 'B1', 'F1');
  table(`${name}: bounded seed 2 vs full enumeration seed 2`, set, 'B2', 'F2');
}
say('\n## The same bounded path against a full enumeration with ANOTHER seed (different boneyard orders): the figures of #502\n');
say('| set | decisions / non-Best (by the reference) | top move, all | grade, all | top move, non-Best | grade, non-Best | kappa, non-Best |\n|---|---|---|---|---|---|---|');
table('all: bounded seed 1 vs full enumeration seed 2', rows, 'B1', 'F2');
table('all: bounded seed 2 vs full enumeration seed 1', rows, 'B2', 'F1');
table('all: full enumeration seed 1 vs full enumeration seed 2 (the floor)', rows, 'F1', 'F2');

// ---- item 2: production's self-agreement
say('\n## Production today (C draws with replacement, 3 plies): the same decision, two seeds\n');
say('Non-Best is defined by seed 1 (the first run); the second set of rows defines it as "either run non-Best".\n');
say('| set | decisions / non-Best | top move, all | grade, all | top move, non-Best | grade, non-Best | kappa, non-Best |\n|---|---|---|---|---|---|---|');
for (const [name, set] of [['all', rows], ['held-out', rows.filter((r) => r.split === 'heldout')], ['tuning', rows.filter((r) => r.split === 'tuning')]] as const) {
  table(`${name}: production seed 2 vs seed 1`, set, 'P2', 'P1');
}
const either = rows.filter((r) => r.P1.grade !== 'best' || r.P2.grade !== 'best');
say(`\nEither-run non-Best (${either.length} decisions): top move ${pct(either.map((r) => r.P1.top === r.P2.top))}, grade ${pct(either.map((r) => r.P1.grade === r.P2.grade))}.`);
say('\nFor comparison, the same self-agreement of the other methods (non-Best by the first run):\n');
say('| set | decisions / non-Best | top move, all | grade, all | top move, non-Best | grade, non-Best | kappa, non-Best |\n|---|---|---|---|---|---|---|');
table('all: bounded seed 2 vs seed 1', rows, 'B2', 'B1');
table('all: full enumeration seed 2 vs seed 1', rows, 'F2', 'F1');
