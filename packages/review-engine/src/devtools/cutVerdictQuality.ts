/**
 * What is a verdict cut by a wall-clock ceiling worth? Reads recordLadderCutPass.ts output (2-ply, the production tier-1 and tier-2 sample streams, and an independent pooled
 * reference) and reports agreement of a PREFIX of each stream (what a ceiling hit keeps) with the reference. docs/review-single-depth-design-2026-11-08.md, items (b) and (c).
 *   npx tsx packages/review-engine/src/devtools/cutVerdictQuality.ts <cut.jsonl>...
 */
import { readFileSync } from 'node:fs';
import { bootstrapInterval, cohensKappa, formatInterval, fraction, meanOf, verdictAtSamples, type SamplePass } from './reviewSamplingStudyLib';

type Row = { gameId: string; move: number; tier1: SamplePass | null; tier2: SamplePass | null; refA2: SamplePass | null; refB2: SamplePass | null };
const rows = process.argv.slice(2).flatMap((f) => readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Row)).filter((r) => r.tier1 && r.tier2 && r.refA2 && r.refB2);
const say = (line = '') => process.stdout.write(`${line}\n`);
const pct = (hits: boolean[]) => formatInterval(bootstrapInterval(hits, (s) => fraction(s)));
const pool = (a: SamplePass, b: SamplePass): SamplePass => ({ ...a, perSample: [...a.perSample, ...b.perSample], cumNodes: [], msPerSample: [] });

say(`${rows.length} ladder decisions; 2 plies (the ladder's depth); reference = pooled 2 x ${rows[0]!.refA2!.perSample.length} independent samples, node budget lifted\n`);
say('| stream | samples kept | decisions / non-Best | top move, all | grade, all | top move, non-Best | grade, non-Best | kappa, non-Best | mean abs loss error, non-Best |\n|---|---|---|---|---|---|---|---|---|');
const cases: Array<[string, 'tier1' | 'tier2', number[]]> = [
  ['tier 1 (a ceiling hit keeps a prefix of 100)', 'tier1', [8, 16, 32, 45, 64, 98, 100]],
  ['tier 2 (a ceiling hit keeps a prefix of 2,500)', 'tier2', [100, 300, 600, 1000, 1800, 2500]],
];
for (const [label, stream, ns] of cases) {
  for (const n of ns) {
    const pairs = rows.map((r) => {
      const ref = verdictAtSamples(pool(r.refA2!, r.refB2!), 1_000_000);
      const v = verdictAtSamples(r[stream]!, n);
      return { top: v.topIndex === ref.topIndex, grade: v.grade === ref.grade, refGrade: ref.grade, runGrade: v.grade, err: Math.abs(v.loss - ref.loss) };
    });
    const nonBest = pairs.filter((p) => p.refGrade !== 'best');
    const kappa = cohensKappa(nonBest.map((p) => p.refGrade), nonBest.map((p) => p.runGrade));
    const err = meanOf(nonBest.map((p) => p.err));
    say(`| ${label} | ${n} | ${pairs.length} / ${nonBest.length} | ${pct(pairs.map((p) => p.top))} | ${pct(pairs.map((p) => p.grade))} | ${pct(nonBest.map((p) => p.top))} | ${pct(nonBest.map((p) => p.grade))} | ${kappa === null ? 'n/a' : kappa.toFixed(2)} | ${err === null ? 'n/a' : err.toFixed(3)} |`);
  }
}
