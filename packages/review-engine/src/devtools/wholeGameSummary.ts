/**
 * Summary of wholeGameRun.ts output (docs/review-single-depth-design-2026-11-08.md).
 *   npx tsx packages/review-engine/src/devtools/wholeGameSummary.ts <label> <slow> <run.jsonl>... [-- <baselineRun.jsonl>...]
 * Prints: whole-game ms across the games (mean, p90, p99, min, max) for both seats together and for one seat (what a review covers), the same projected onto a slower machine,
 * per-decision cost by kind, the lifecycle / tier / ceiling mix, what a ceiling-hit result looks like to the player (label, confidence, grade), and, with a baseline run (the same
 * decisions on the unscaled laptop), how often the verdict of a decision cut by a ceiling differs from the unscaled one.
 */
import { readFileSync } from 'node:fs';
import { bootstrapInterval, formatInterval, fraction, meanOf, quantile } from './reviewSamplingStudyLib';

type Row = {
  gameId: string; seat: string; move: number; ms: number; lifecycle: string; tier: number | null; reason: string | null; space: number; source: string; confidence: string; label: string;
  samples: number; coverage: number; complete: boolean; depth: number; ceiling: boolean; failure: string | null; loss: number; grade: string; top: string; legal: number; drawable: number;
  second: string | null; bounded: { stop: string; partial: boolean; hands: number; total: number } | null; fallback: string | null;
};
const args = process.argv.slice(2);
const label = args[0]!;
const slow = Number(args[1]);
const sep = args.indexOf('--');
const load = (files: string[]) => files.flatMap((f) => readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Row));
const rows = load(args.slice(2, sep === -1 ? undefined : sep));
const base = sep === -1 ? [] : load(args.slice(sep + 1));
const say = (line = '') => process.stdout.write(`${line}\n`);
const fmt = (v: number | null, d = 0) => (v === null ? 'n/a' : v.toFixed(d));
const sec = (ms: number | null) => (ms === null ? 'n/a' : `${(ms / 1000).toFixed(1)} s`);

const kindOf = (r: Row): string => (r.lifecycle === 'FORCED' ? 'forced' : r.drawable === 0 ? 'locked yard' : r.space <= 8000 ? 'exact path' : 'ladder');
const SLOWS = [1, 45];

say(`## ${label}\n`);
say(`${rows.length} decisions over ${new Set(rows.map((r) => r.gameId)).size} games (emulated machine slowdown: ${slow}x)\n`);

const gameTotals = (set: Row[], by: (r: Row) => string) => {
  const m = new Map<string, number>();
  for (const r of set) m.set(by(r), (m.get(by(r)) ?? 0) + r.ms);
  return [...m.values()];
};
say('**Whole-game laptop time through this path (sum of the decisions of one game):**\n');
say('| unit | n | mean | p90 | p99 | min | max |\n|---|---|---|---|---|---|---|');
for (const [name, totals] of [
  ['game, both seats (all decisions)', gameTotals(rows, (r) => r.gameId)],
  ['one seat of a game (what a review covers: one player\'s decisions)', gameTotals(rows, (r) => `${r.gameId}|${r.seat}`)],
] as const) {
  say(`| ${name} | ${totals.length} | ${sec(meanOf(totals))} | ${sec(quantile(totals, 0.9))} | ${sec(quantile(totals, 0.99))} | ${sec(Math.min(...totals))} | ${sec(Math.max(...totals))} |`);
}
say('\n(p90 and p99 of 10 games or 20 seat-games are the second-largest and the largest value: read them as "worst games", not as stable percentiles.)\n');

say('**Per decision, laptop ms, by kind:**\n');
say('| kind | decisions | share of the time | mean | median | p90 | p99 | max |\n|---|---|---|---|---|---|---|---|');
const totalMs = rows.reduce((s, r) => s + r.ms, 0);
for (const kind of ['forced', 'locked yard', 'exact path', 'ladder']) {
  const set = rows.filter((r) => kindOf(r) === kind);
  const ms = set.map((r) => r.ms);
  say(`| ${kind} | ${set.length} | ${((ms.reduce((s, x) => s + x, 0) / totalMs) * 100).toFixed(0)}% | ${fmt(meanOf(ms), 1)} | ${fmt(quantile(ms, 0.5), 1)} | ${fmt(quantile(ms, 0.9))} | ${fmt(quantile(ms, 0.99))} | ${fmt(ms.length ? Math.max(...ms) : null)} |`);
}
const all = rows.map((r) => r.ms);
say(`| all | ${rows.length} | 100% | ${fmt(meanOf(all), 1)} | ${fmt(quantile(all, 0.5), 1)} | ${fmt(quantile(all, 0.9))} | ${fmt(quantile(all, 0.99))} | ${fmt(Math.max(...all))} |`);

say('\n**Projection of those whole-game times onto a slower machine (linear in CPU speed; the factors are the measured production ratio and a guess for phones):**\n');
say('| unit | laptop | phone x2 (guess) | phone x5 (guess) | Render free instance x45 (measured ratio) |\n|---|---|---|---|---|');
for (const [name, totals] of [
  ['game, mean', gameTotals(rows, (r) => r.gameId)],
  ['one seat, mean', gameTotals(rows, (r) => `${r.gameId}|${r.seat}`)],
] as const) {
  const m = meanOf(totals)!;
  const p = quantile(totals, 0.9)!;
  say(`| ${name} | ${sec(m)} | ${sec(m * 2)} | ${sec(m * 5)} | ${sec(m * 45)} |`);
  say(`| ${name.replace('mean', 'p90')} | ${sec(p)} | ${sec(p * 2)} | ${sec(p * 5)} | ${sec(p * 45)} |`);
}

say('\n**Outcome mix:**\n');
const count = (f: (r: Row) => boolean) => rows.filter(f).length;
const pctOf = (n: number) => `${n} (${((n / rows.length) * 100).toFixed(1)}%)`;
say(`- lifecycle: ${['SCORED', 'FORCED', 'FAILED_RETRYABLE', 'FAILED_FATAL'].map((l) => `${l} ${pctOf(count((r) => r.lifecycle === l))}`).join(', ')}`);
say(`- tier reached: ${[1, 2, 3, 4].map((t) => `tier ${t} ${pctOf(count((r) => r.tier === t && r.lifecycle !== 'FORCED' && !(r.drawable > 0 && r.space <= 8000) && r.drawable !== 0))}`).join(', ')} (ladder decisions); exact-branch ${pctOf(count((r) => kindOf(r) === 'exact path'))}; locked yard ${pctOf(count((r) => kindOf(r) === 'locked yard'))}; forced ${pctOf(count((r) => kindOf(r) === 'forced'))}`);
say(`- the wall-clock ceiling fired: ${pctOf(count((r) => r.ceiling))}; search incomplete (\`search.complete === false\`): ${pctOf(count((r) => !r.complete))}; failed (retryable) at the end of the pass: ${pctOf(count((r) => r.lifecycle === 'FAILED_RETRYABLE'))}`);
say(`- would exceed the 180 s worker kill on this machine (laptop ms x ${slow} > 180,000): ${pctOf(count((r) => r.ms * slow > 180_000))}`);
say(`- evidence shown: ${['exact', 'search', 'heuristic'].map((s) => `${s} ${pctOf(count((r) => r.source === s))}`).join(', ')}; confidence: ${['high', 'medium', 'low'].map((s) => `${s} ${pctOf(count((r) => r.confidence === s))}`).join(', ')}`);
if (rows.some((r) => r.bounded)) {
  const b = rows.filter((r) => r.bounded);
  say(`- bounded path: ${b.length} decisions; ${['complete', 'resolved', 'cap', 'node-cap', 'wall-clock'].map((s) => `${s} ${b.filter((r) => r.bounded!.stop === s).length}`).join(', ')}`);
}

const cut = rows.filter((r) => r.ceiling || !r.complete);
say(`\n**Decisions cut by a ceiling or incomplete (${cut.length}): what the player-facing record says**\n`);
if (cut.length > 0) {
  say('| tier | lifecycle | samples solved | complete | ceiling | evidence / confidence | grade | second opinion | ms (laptop) |\n|---|---|---|---|---|---|---|---|---|');
  for (const r of cut.slice(0, 40)) say(`| ${r.tier} | ${r.lifecycle} | ${r.samples} | ${r.complete} | ${r.ceiling} | ${r.source} / ${r.confidence} | ${r.grade} | ${r.second ?? '-'} | ${fmt(r.ms)} |`);
  if (cut.length > 40) say(`(${cut.length - 40} more)`);
  const shipped = cut.filter((r) => r.lifecycle === 'SCORED' && r.source !== 'heuristic');
  say(`\nOf these ${cut.length}: shipped as SCORED search evidence (a badge is drawn from the loss, nothing in the record the client reads marks it as cut): ${shipped.length}; fell back to the heuristic (no badge): ${cut.filter((r) => r.source === 'heuristic').length}; still retryable: ${cut.filter((r) => r.lifecycle === 'FAILED_RETRYABLE').length}.`);
  say(`Samples solved in the SCORED ones: ${shipped.map((r) => r.samples).sort((a, b) => a - b).join(', ')}.`);
}

if (base.length > 0) {
  const key = (r: Row) => `${r.gameId}#${r.move}`;
  const baseMap = new Map(base.map((r) => [key(r), r]));
  const pairs = rows.map((r) => ({ r, b: baseMap.get(key(r)) })).filter((p): p is { r: Row; b: Row } => p.b !== undefined && p.r.lifecycle !== 'FORCED');
  const cutPairs = pairs.filter((p) => p.r.ceiling || !p.r.complete);
  say('\n**Verdict of the machine-with-a-ceiling run against the unscaled laptop run of the same decision:**\n');
  say('| set | decisions | grade differs | top move differs | badge differs, non-Best on the laptop |\n|---|---|---|---|---|');
  const row = (name: string, set: typeof pairs) => {
    const nonBest = set.filter((p) => p.b.grade !== 'best');
    say(`| ${name} | ${set.length} | ${formatInterval(bootstrapInterval(set, (s) => fraction(s.map((p) => p.r.grade !== p.b.grade))))} | ${formatInterval(bootstrapInterval(set, (s) => fraction(s.map((p) => p.r.top !== p.b.top))))} | ${nonBest.length ? formatInterval(bootstrapInterval(nonBest, (s) => fraction(s.map((p) => p.r.grade !== p.b.grade)))) : 'n/a'} (of ${nonBest.length}) |`);
  };
  row('all non-forced decisions', pairs);
  row('decisions cut by a ceiling or incomplete', cutPairs);
  row('decisions not cut', pairs.filter((p) => !(p.r.ceiling || !p.r.complete)));
}
void SLOWS;
