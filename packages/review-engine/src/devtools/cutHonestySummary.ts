/**
 * Summarises cutHonestyEmulation.ts output: how many corpus decisions change badge when honest labelling of cut verdicts is on, under the emulated slowdown.
 *   npx tsx packages/review-engine/src/devtools/cutHonestySummary.ts <out.md> <emulation.jsonl>...
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Row = {
  gameId: string; seat: string; move: number; tier: number | string; source: string; confidence: string; samples: number; complete: boolean; ceiling: boolean;
  convergence: string | null; loss: number; second: string | null;
  partial: { reason: string; solved: number; requested: number; interval: [number, number] } | null;
  today: string | null; honest: string | null;
};

const out = resolve(process.argv[2] ?? '/tmp/cut-honesty-summary.md');
const rows: Row[] = process.argv.slice(3).flatMap((file) => readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as Row));

const pct = (n: number, d: number) => (d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(1)}%`);
const label = (value: string | null) => value ?? 'no badge';

const scored = rows.filter((r) => r.today !== null);
const cut = rows.filter((r) => r.partial !== null);
const cutScored = cut.filter((r) => r.today !== null);
const lost = scored.filter((r) => r.honest === null);
const changed = scored.filter((r) => r.honest !== r.today);
const lowConfidence = rows.filter((r) => r.source === 'search' && r.confidence === 'low');
const vacuous = rows.filter((r) => r.convergence === 'eval-convergence:partial-interval');

const transitions = new Map<string, number>();
for (const r of scored) {
  const key = `${label(r.today)} -> ${label(r.honest)}`;
  transitions.set(key, (transitions.get(key) ?? 0) + 1);
}

const lines: string[] = [];
lines.push(`Decisions: ${rows.length}, with a badge today: ${scored.length}, games: ${new Set(rows.map((r) => r.gameId)).size}.`);
lines.push('');
lines.push('| measure | count | share |');
lines.push('|---|---:|---:|');
lines.push(`| decisions cut short (partialSearch present) | ${cut.length} | ${pct(cut.length, rows.length)} of all, ${pct(cutScored.length, scored.length)} of those with a badge |`);
lines.push(`|   cut by the wall-clock ceiling | ${cut.filter((r) => r.partial!.reason === 'wall-clock').length} | |`);
lines.push(`|   cut by a node budget | ${cut.filter((r) => r.partial!.reason === 'budget').length} | |`);
lines.push(`| **badges that disappear with the rule** (today a badge, then none) | ${lost.length} | **${pct(lost.length, scored.length)}** of badged decisions, ${pct(lost.length, cutScored.length)} of the cut ones |`);
lines.push(`| badges that change in any way | ${changed.length} | ${pct(changed.length, scored.length)} |`);
lines.push(`| results dropped to confidence low | ${lowConfidence.length} | ${pct(lowConfidence.length, rows.length)} |`);
lines.push(`| cut before the halfway sample, accepted as partial-interval (was "stability-converged" with no test) | ${vacuous.length} | |`);
lines.push(`| cut verdicts that still ship with a badge today, nothing marking them as cut | ${cutScored.length} | 100% of the cut ones |`);
lines.push('');
lines.push('Badge transitions (today -> with the rule), badged decisions only:');
lines.push('');
lines.push('| transition | decisions |');
lines.push('|---|---:|');
[...transitions.entries()].sort((a, b) => b[1] - a[1]).forEach(([key, count]) => lines.push(`| ${key} | ${count} |`));
lines.push('');
lines.push('Cut decisions by their badge today:');
lines.push('');
lines.push('| badge today | cut | lose the badge |');
lines.push('|---|---:|---:|');
for (const badge of ['Best', 'Good', 'Inaccuracy', 'Mistake', 'Blunder']) {
  const group = cutScored.filter((r) => r.today === badge);
  lines.push(`| ${badge} | ${group.length} | ${group.filter((r) => r.honest === null).length} |`);
}
lines.push('');
lines.push('First 5 examples of a lost badge:');
lines.push('');
lines.push('| decision | tier | hands solved of requested | reason | loss | 95% interval | today -> with the rule |');
lines.push('|---|---|---|---|---:|---|---|');
lost.slice(0, 5).forEach((r) => {
  lines.push(`| ${r.gameId.split(':').slice(-2).join(':')}#${r.move} | ${r.tier} | ${r.partial!.solved} of ${r.partial!.requested} | ${r.partial!.reason} | ${r.loss.toFixed(2)} | [${r.partial!.interval.map((v) => (v >= 1_000_000 ? 'unbounded' : v.toFixed(2))).join(', ')}] | ${label(r.today)} -> ${label(r.honest)} |`);
});
writeFileSync(out, `${lines.join('\n')}\n`);
process.stdout.write(`${lines.join('\n')}\n`);
