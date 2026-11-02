/**
 * Measures what the PRODUCTION review path actually produces: every decision of a recorded corpus is replayed to its position and run through
 * `completeReviewEvaluations` (the durable server job's escalation, tiers 100 / 2,500 / 12,000 / 50,000 sampled hidden states), starting from the evaluation
 * that was recorded (the cheap live pass). Reports the final tier mix, the time per decision and how both vary with how much of the hand is left.
 *
 * The recorded corpora were written by the older single-budget dispatcher (`evaluateReviewPosition`), so their stored tier mix is NOT the production mix;
 * this tool measures the production one. Manually invoked:
 *   npx tsx src/devtools/reviewProductionTierMix.ts [corpusDir] [maxDecisions] [outPath]
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { completeReviewEvaluations } from '../completeReviewEvaluations';
import { replayRecordedSelfPlay } from './replayRecordedSelfPlay';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const dir = resolve(process.argv[2] ?? resolve(ROOT, 'packages/review-engine/fixtures/recorded-self-play'));
const maxDecisions = Number(process.argv[3] ?? '200');
const outPath = process.argv[4] ? resolve(process.argv[4]) : null;

type Row = {
  recordedSource: string;
  finalSource: string;
  lifecycle: string;
  ms: number;
  handSize: number;
  drawable: number;
  forced: boolean;
  fallbackReason: string | null;
  tier: string | null;
};

const positions = replayRecordedSelfPlay(dir).slice(0, maxDecisions);
const rows: Row[] = [];
let done = 0;
for (const { snapshot, evaluation } of positions) {
  const id = snapshot.identifiers.decisionId;
  const started = performance.now();
  const result = completeReviewEvaluations({ snapshots: [snapshot], liveResultsByDecisionId: new Map([[id, evaluation]]) });
  const ms = performance.now() - started;
  const final = result.resultsByDecisionId.get(id) ?? evaluation;
  const lifecycle = Object.entries(result.lifecycleCounts).find(([, n]) => n > 0)?.[0] ?? 'UNKNOWN';
  rows.push({
    recordedSource: evaluation.evidence.source,
    finalSource: final.evidence.source,
    lifecycle,
    ms,
    handSize: snapshot.preAction.actorHand.length,
    drawable: snapshot.preAction.boneyard.drawableCount,
    forced: lifecycle === 'FORCED',
    fallbackReason: final.heuristicFallbackReason ?? null,
    tier: (final.evaluationProvenance as { tier?: string } | undefined)?.tier ?? null,
  });
  done += 1;
  if (done % 25 === 0) process.stderr.write(`${done}/${positions.length}\n`);
}

const pct = (n: number, d: number) => (d === 0 ? '—' : `${((n / d) * 100).toFixed(1)}%`);
const quantile = (sorted: number[], q: number) => (sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!);
const scored = rows.filter((r) => !r.forced);
const table = (title: string, groups: Array<[string, Row[]]>) => [
  `### ${title}`,
  '',
  '| group | decisions | exact | search | heuristic | median ms | p90 ms | max ms |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ...groups.map(([name, rs]) => {
    const t = rs.map((r) => r.ms).sort((a, b) => a - b);
    const n = rs.length;
    const c = (s: string) => rs.filter((r) => r.finalSource === s).length;
    return `| ${name} | ${n} | ${pct(c('exact'), n)} | ${pct(c('search'), n)} | ${pct(c('heuristic'), n)} | ${quantile(t, 0.5).toFixed(0)} | ${quantile(t, 0.9).toFixed(0)} | ${Math.max(0, ...t).toFixed(0)} |`;
  }),
  '',
].join('\n');

const bySize = (lo: number, hi: number) => scored.filter((r) => r.handSize >= lo && r.handSize <= hi);
const report = [
  '# Review production tier mix',
  '',
  `Corpus: \`${dir.replace(ROOT + '/', '')}\`; ${positions.length} decisions replayed, ${rows.filter((r) => r.forced).length} forced, ${scored.length} non-forced.`,
  'Each non-forced decision was run through `completeReviewEvaluations` (the production escalation) starting from its recorded live evaluation.',
  '',
  table('Recorded (old dispatcher) vs production result, non-forced', [
    ['recorded by the old dispatcher', scored.map((r) => ({ ...r, finalSource: r.recordedSource }))],
    ['after the production completion pass', scored],
  ]),
  table('By how many tiles the player still holds (more tiles = earlier in the hand)', [
    ['1-2 tiles (endgame)', bySize(1, 2)],
    ['3-4 tiles', bySize(3, 4)],
    ['5-6 tiles', bySize(5, 6)],
    ['7+ tiles (opening)', bySize(7, 99)],
  ]),
  table('By whether tiles remain to draw', [
    ['boneyard locked (exact solver applies)', scored.filter((r) => r.drawable === 0)],
    ['tiles still drawable (hidden-hand search)', scored.filter((r) => r.drawable > 0)],
  ]),
  '### Lifecycle of non-forced decisions',
  '',
  ...Object.entries(scored.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.lifecycle]: (acc[r.lifecycle] ?? 0) + 1 }), {})).map(([k, v]) => `- ${k}: ${v}`),
  '',
  `Total wall time for the non-forced decisions: ${(scored.reduce((s, r) => s + r.ms, 0) / 1000).toFixed(1)} s (${(scored.reduce((s, r) => s + r.ms, 0) / Math.max(1, scored.length)).toFixed(0)} ms each on average, one thread).`,
  '',
].join('\n');

if (outPath) writeFileSync(outPath, report);
console.log(report);
