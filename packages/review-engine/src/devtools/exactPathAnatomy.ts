/**
 * Step 1 of docs/review-bounded-exact-2026-11-07.md: the cost anatomy of the "exact-enumeration" path (a hidden-hand space C(n,k) of 8,000 or fewer: the branch at
 * adaptiveEvaluateReviewPosition.ts:239) from the cold corpus run (docs/review-performance-measurement-2026-11-07.cold-run.csv). Bot play only. Reports ms by buckets of
 * C(n,k), tiles in hand, legal actions and drawable tiles; the share of time in the top 5%; and which buckets the decisions that would exceed 180 s on a machine
 * `slowdown` times slower come from (default 40, i.e. decisions over 180000/40 = 4,500 ms).
 *   npx tsx packages/review-engine/src/devtools/exactPathAnatomy.ts [slowdown=40]
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { meanOf, quantile } from './reviewSamplingStudyLib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const slowdown = Number(process.argv[2] ?? '40');
const lines = readFileSync(resolve(ROOT, 'docs/review-performance-measurement-2026-11-07.cold-run.csv'), 'utf8').trim().split('\n');
const header = lines[0]!.split(',');
const rows = lines.slice(1).map((line) => {
  const cells = line.split(',');
  const row: Record<string, string> = {};
  header.forEach((name, i) => { row[name] = cells[i] ?? ''; });
  return row;
});
const num = (value: string | undefined): number => Number(value);

const exact = rows.filter((r) => num(r.estimatedStateSpace) > 0 && num(r.estimatedStateSpace) <= 8000);
const total = exact.reduce((s, r) => s + num(r.ms), 0);
const say = (line = '') => process.stdout.write(`${line}\n`);
const fmt = (v: number | null, d = 0) => (v === null ? 'n/a' : v.toFixed(d));
say(`${exact.length} exact-path decisions of ${rows.length}; ${(total / 1000).toFixed(0)} s total (${((total / rows.reduce((s, r) => s + num(r.ms), 0)) * 100).toFixed(0)}% of all cold time)`);
const msAll = exact.map((r) => num(r.ms));
const sorted = [...msAll].sort((a, b) => b - a);
const top5 = sorted.slice(0, Math.ceil(exact.length * 0.05)).reduce((s, x) => s + x, 0);
say(`mean ${fmt(meanOf(msAll))} ms, median ${fmt(quantile(msAll, 0.5))}, p90 ${fmt(quantile(msAll, 0.9))}, p99 ${fmt(quantile(msAll, 0.99))}, max ${fmt(sorted[0]!)}; top 5% of exact-path decisions hold ${((top5 / total) * 100).toFixed(0)}% of the exact-path time`);

const limit = 180000 / slowdown;
const slow = exact.filter((r) => num(r.ms) > limit);
say(`over the 180 s kill at ${slowdown}x (ms > ${limit}): ${slow.length} exact-path decisions (${((slow.length / rows.length) * 100).toFixed(1)}% of all decisions); all-path count ${rows.filter((r) => num(r.ms) > limit).length}`);

type Bucket = { label: string; test: (r: Record<string, string>) => boolean };
function table(title: string, buckets: Bucket[]): void {
  say(`\n${title}`);
  say('  bucket              | n   | mean ms | median | p90    | p99    | max    | share of exact time | over limit');
  for (const bucket of buckets) {
    const items = exact.filter(bucket.test);
    if (items.length === 0) continue;
    const ms = items.map((r) => num(r.ms));
    const sum = ms.reduce((s, x) => s + x, 0);
    say(`  ${bucket.label.padEnd(19)} | ${String(items.length).padStart(3)} | ${fmt(meanOf(ms)).padStart(7)} | ${fmt(quantile(ms, 0.5)).padStart(6)} | ${fmt(quantile(ms, 0.9)).padStart(6)} | ${fmt(quantile(ms, 0.99)).padStart(6)} | ${fmt(Math.max(...ms)).padStart(6)} | ${((sum / total) * 100).toFixed(0).padStart(3)}%                | ${items.filter((r) => num(r.ms) > limit).length}`);
  }
}
const c = (lo: number, hi: number, label: string): Bucket => ({ label, test: (r) => num(r.estimatedStateSpace) >= lo && num(r.estimatedStateSpace) <= hi });
table('by hidden hands C(n,k)', [c(1, 20, 'C 1-20'), c(21, 164, 'C 21-164'), c(165, 999, 'C 165-999'), c(1000, 2999, 'C 1000-2999'), c(3000, 4999, 'C 3000-4999'), c(5000, 8000, 'C 5000-8000')]);
const h = (lo: number, hi: number, label: string): Bucket => ({ label, test: (r) => num(r.handSize) >= lo && num(r.handSize) <= hi });
table('by tiles in the actor\'s hand', [h(1, 3, 'hand 1-3'), h(4, 6, 'hand 4-6'), h(7, 9, 'hand 7-9'), h(10, 14, 'hand 10-14')]);
const l = (lo: number, hi: number, label: string): Bucket => ({ label, test: (r) => num(r.legalActions) >= lo && num(r.legalActions) <= hi });
table('by legal actions', [l(2, 2, 'legal 2'), l(3, 3, 'legal 3'), l(4, 5, 'legal 4-5'), l(6, 8, 'legal 6-8'), l(9, 30, 'legal 9+')]);
const d = (lo: number, hi: number, label: string): Bucket => ({ label, test: (r) => num(r.drawable) >= lo && num(r.drawable) <= hi });
table('by drawable tiles', [d(1, 3, 'drawable 1-3'), d(4, 6, 'drawable 4-6'), d(7, 9, 'drawable 7-9'), d(10, 14, 'drawable 10+')]);
say('\nthe decisions over the limit, slowest first:');
for (const r of slow.sort((a, b) => num(b.ms) - num(a.ms)).slice(0, 40)) {
  say(`  ${fmt(num(r.ms)).padStart(6)} ms  C=${r.estimatedStateSpace.padStart(5)}  hand ${r.handSize}  legal ${r.legalActions}  drawable ${r.drawable}  nodes ${r.nodes}`);
}
// The cost is roughly (hidden hands visited) x (nodes per hand): report both.
const nodesPerHand = exact.map((r) => num(r.nodes) / Math.max(1, num(r.samples)));
say(`\nnodes per sampled hand on the exact path: mean ${fmt(meanOf(nodesPerHand))}, median ${fmt(quantile(nodesPerHand, 0.5))}, p90 ${fmt(quantile(nodesPerHand, 0.9))}, max ${fmt(Math.max(...nodesPerHand))}`);
const msPerNode = exact.map((r) => num(r.ms) / Math.max(1, num(r.nodes)));
say(`ms per node: median ${(quantile(msPerNode, 0.5)! * 1000).toFixed(2)} microseconds`);
