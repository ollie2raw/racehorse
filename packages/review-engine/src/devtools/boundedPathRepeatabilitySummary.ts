/**
 * Summary of boundedPathRepeatability.ts: how often two runs of the same method with different seeds agree with each other, and how often different methods agree.
 *   npx tsx packages/review-engine/src/devtools/boundedPathRepeatabilitySummary.ts <rep.jsonl>...
 */
import { readFileSync } from 'node:fs';
import { bootstrapInterval, cohensKappa, formatInterval, fraction, meanOf, quantile, type Grade } from './reviewSamplingStudyLib';

type Run = { top: string; grade: Grade; loss: number; ms: number; hands?: number; reason?: string };
type Row = { split: 'tuning' | 'heldout'; C: number; P1: Run; P2: Run; B1: Run; B2: Run; F1: Run; F2: Run };
const rows = process.argv.slice(2).flatMap((f) => readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Row));
const say = (line = '') => process.stdout.write(`${line}\n`);
const fmt = (v: number | null, d = 0) => (v === null ? 'n/a' : v.toFixed(d));
type Name = 'P1' | 'P2' | 'B1' | 'B2' | 'F1' | 'F2';

say(`${rows.length} exact-path midgame decisions (tuning ${rows.filter((r) => r.split === 'tuning').length}, held-out ${rows.filter((r) => r.split === 'heldout').length}); bot play; 3 plies\n`);
say('Methods: P = production today (C draws with replacement), B = the bounded path (tuned defaults), F = the bounded engine run to completion (every distinct hand once). Each ran twice with different seeds (1, 2).\n');
say('**Cost per decision (ms, laptop, cold):**\n');
say('| method | mean | median | p90 | p99 | max |\n|---|---|---|---|---|---|');
for (const name of ['P1', 'B1', 'F1'] as const) {
  const ms = rows.map((r) => r[name].ms);
  say(`| ${name === 'P1' ? 'P production today' : name === 'B1' ? 'B bounded (tuned)' : 'F full enumeration'} | ${fmt(meanOf(ms))} | ${fmt(quantile(ms, 0.5))} | ${fmt(quantile(ms, 0.9))} | ${fmt(quantile(ms, 0.99))} | ${fmt(Math.max(...ms))} |`);
}
const hands = rows.map((r) => (r.B1.hands ?? 0) / Math.max(1, r.C));
say(`\nThe bounded path visits a mean ${fmt((meanOf(hands) ?? 0) * 100)}% of the distinct hands (stop reasons: ${[...new Set(rows.map((r) => r.B1.reason))].map((k) => `${k} ${rows.filter((r) => r.B1.reason === k).length}`).join(', ')}).\n`);

const pairs: Array<[Name, Name, string]> = [
  ['F1', 'F2', 'full enumeration vs itself, other seed (the NOISE FLOOR: one boneyard order per hand)'],
  ['P1', 'P2', 'production vs itself, other seed'],
  ['B1', 'B2', 'bounded vs itself, other seed'],
  ['B1', 'F1', 'bounded vs the full enumeration under the SAME seed'],
  ['B1', 'F2', 'bounded vs the full enumeration under the OTHER seed'],
  ['B2', 'F1', 'bounded (seed 2) vs the full enumeration (seed 1)'],
  ['P1', 'F1', 'production vs a full enumeration (seed 1)'],
  ['P1', 'F2', 'production vs a full enumeration (seed 2)'],
  ['P2', 'F1', 'production (seed 2) vs a full enumeration (seed 1)'],
];
for (const split of ['all', 'heldout', 'tuning'] as const) {
  const set = rows.filter((r) => split === 'all' || r.split === split);
  say(`### ${split === 'all' ? 'All decisions' : split === 'heldout' ? 'Held-out games' : 'Tuning games'} (${set.length})\n`);
  say('| pair | top-move (all) | grade (all) | decisions where either run is non-Best | top-move (non-Best) | grade (non-Best) | kappa (non-Best) |\n|---|---|---|---|---|---|---|');
  for (const [a, b, label] of pairs) {
    const nonBest = set.filter((r) => r[a].grade !== 'best' || r[b].grade !== 'best');
    const stat = (rs: Row[], f: (r: Row) => boolean) => formatInterval(bootstrapInterval(rs, (x) => fraction(x.map(f))));
    const kappa = cohensKappa(nonBest.map((r) => r[a].grade), nonBest.map((r) => r[b].grade));
    say(`| ${a} vs ${b}: ${label} | ${stat(set, (r) => r[a].top === r[b].top)} | ${stat(set, (r) => r[a].grade === r[b].grade)} | ${nonBest.length} | ${stat(nonBest, (r) => r[a].top === r[b].top)} | ${stat(nonBest, (r) => r[a].grade === r[b].grade)} | ${fmt(kappa, 2)} |`);
  }
  say();
}
