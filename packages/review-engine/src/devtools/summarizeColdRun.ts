/**
 * Summarises the JSONL written by reviewColdCorpusRun.ts (Phase A1): tier histogram, time distribution, the share of total time in the most expensive decisions, the
 * exact-enumeration path (a hidden-hand space of 8,000 or fewer skips the tier ladder), decisions killed by the server's 180 s per-position limit, ceiling hits and
 * incomplete searches. Bot play only.
 *   npx tsx packages/review-engine/src/devtools/summarizeColdRun.ts <jsonl> [<jsonl> ...]
 */
import { readFileSync } from 'node:fs';
import { meanOf, quantile } from './reviewSamplingStudyLib';

type Row = {
  index: number; killed: boolean; ms: number; split?: string; tier?: number | null; lifecycle?: string; source?: string; estimatedStateSpace?: number; convergence?: string | null;
  samples?: number; nodes?: number; coverage?: number; complete?: boolean; ceilingHit?: boolean; drawable?: number; legalActions?: number; handSize?: number; opponentTiles?: number;
};
const rows = process.argv.slice(2).flatMap((path) => readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as Row)).sort((a, b) => a.index - b.index);
const say = (line = '') => process.stdout.write(`${line}\n`);
const fmt = (value: number | null, digits = 0) => (value === null ? 'n/a' : value.toFixed(digits));

const finished = rows.filter((row) => !row.killed);
const killed = rows.filter((row) => row.killed);
const msAll = rows.map((row) => row.ms);
const total = msAll.reduce((s, x) => s + x, 0);
say(`${rows.length} non-forced decisions: ${finished.length} finished, ${killed.length} killed at the per-position limit`);
say(`time per decision (finished, killed counted at their kill time): mean ${fmt(meanOf(msAll))} ms, median ${fmt(quantile(msAll, 0.5))}, p90 ${fmt(quantile(msAll, 0.9))}, p99 ${fmt(quantile(msAll, 0.99))}, max ${fmt(Math.max(...msAll))}`);
say(`total ${(total / 1000).toFixed(0)} s for ${rows.length} decisions; a 60-decision game at the mean: ${((meanOf(msAll) ?? 0) * 60 / 1000).toFixed(1)} s`);
const sorted = [...msAll].sort((a, b) => b - a);
const top5 = sorted.slice(0, Math.ceil(rows.length * 0.05)).reduce((s, x) => s + x, 0);
const top1 = sorted.slice(0, Math.ceil(rows.length * 0.01)).reduce((s, x) => s + x, 0);
say(`share of total time: top 1% of decisions ${((top1 / total) * 100).toFixed(0)}%, top 5% ${((top5 / total) * 100).toFixed(0)}%`);

say('\ntier reached (tier 1 includes the exact-enumeration path, which skips the ladder):');
const byTier = new Map<string, Row[]>();
for (const row of finished) byTier.set(String(row.tier), [...(byTier.get(String(row.tier)) ?? []), row]);
for (const [tier, items] of [...byTier.entries()].sort()) {
  const ms = items.map((r) => r.ms);
  say(`  tier ${tier}: ${items.length} (${((items.length / finished.length) * 100).toFixed(1)}%), mean ${fmt(meanOf(ms))} ms, median ${fmt(quantile(ms, 0.5))}, p90 ${fmt(quantile(ms, 0.9))}, max ${fmt(Math.max(...ms))}; mean samples ${fmt(meanOf(items.map((r) => r.samples ?? 0)))}, mean nodes ${fmt(meanOf(items.map((r) => r.nodes ?? 0)))}`);
}

const exactPath = finished.filter((r) => (r.estimatedStateSpace ?? 0) > 0 && (r.estimatedStateSpace ?? 0) <= 8000);
const ladder = finished.filter((r) => !((r.estimatedStateSpace ?? 0) > 0 && (r.estimatedStateSpace ?? 0) <= 8000));
say('\nsolver path (adaptiveEvaluateReviewPosition.ts:239): hidden-hand space C(n,k) <= 8,000 -> every hand at 3 plies, 100M nodes, 30 min ceiling; otherwise the tier ladder');
for (const [label, items] of [['exact-enumeration path', exactPath], ['tier ladder', ladder]] as const) {
  const ms = items.map((r) => r.ms);
  say(`  ${label}: ${items.length} decisions, ${((items.reduce((s, r) => s + r.ms, 0) / total) * 100).toFixed(0)}% of total time; mean ${fmt(meanOf(ms))} ms, median ${fmt(quantile(ms, 0.5))}, p90 ${fmt(quantile(ms, 0.9))}, max ${fmt(ms.length ? Math.max(...ms) : null)}`);
}

say('\nlifecycle / evidence / convergence of finished decisions:');
const count = (key: (r: Row) => string) => {
  const map = new Map<string, number>();
  for (const r of finished) map.set(key(r), (map.get(key(r)) ?? 0) + 1);
  return [...map.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`).join(', ');
};
say(`  lifecycle  ${count((r) => String(r.lifecycle))}`);
say(`  evidence   ${count((r) => String(r.source))}`);
say(`  converged  ${count((r) => String(r.convergence))}`);
say(`  search.complete = false: ${finished.filter((r) => r.complete === false).length}; wall-clock ceiling hit: ${finished.filter((r) => r.ceilingHit).length}`);

say('\nby tiles left to draw (drawable) - the hidden-hand case is drawable > 0:');
for (const drawable of [...new Set(finished.map((r) => r.drawable ?? 0))].sort((a, b) => a - b)) {
  const items = finished.filter((r) => (r.drawable ?? 0) === drawable);
  say(`  drawable ${String(drawable).padStart(2)}: ${String(items.length).padStart(3)} decisions, mean ${fmt(meanOf(items.map((r) => r.ms))).padStart(6)} ms, max ${fmt(Math.max(...items.map((r) => r.ms))).padStart(6)}`);
}
say('\nslowest 8:');
for (const r of rows.filter((row) => !row.killed).sort((a, b) => b.ms - a.ms).slice(0, 8)) {
  say(`  ${fmt(r.ms)} ms  tier ${r.tier}  samples ${r.samples}  nodes ${r.nodes}  C(n,k)=${r.estimatedStateSpace}  drawable ${r.drawable}  legal ${r.legalActions}  hand ${r.handSize}`);
}
for (const r of killed) say(`  KILLED at ${fmt(r.ms)} ms (decision index ${r.index})`);
for (const split of ['tuning', 'heldout']) {
  const items = finished.filter((r) => r.split === split);
  say(`${split}: ${items.length} finished decisions, mean ${fmt(meanOf(items.map((r) => r.ms)))} ms`);
}
