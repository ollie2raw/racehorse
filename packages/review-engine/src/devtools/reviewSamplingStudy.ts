/**
 * Phase B of docs/review-performance-measurement-2026-11-07.md. All of it is BOT play (two recorded policies, 5 games each), on the corpus's hidden-hand decisions
 * (tiles still to draw, more than one legal action); endgames with a locked yard take the exact solver and are out of scope here.
 *
 * Per decision two passes at the 2,500-sample cap: REFERENCE (seed 'B-ref') and ALT (seed 'B-alt'). From them:
 *   B1  top-move agreement, grade agreement, Cohen's kappa for grade and mean absolute loss error of an N-sample verdict (N = 25..400) against the 2,500-sample
 *       reference, two ways: "prefix" (the N samples are the first N of the reference pass: a cheap run that resumes later) and "independent" (the N samples come
 *       from the ALT pass: what a device result versus a server result would differ by). Each on (a) all decisions, (b) the non-Best subset (reference grade is
 *       not Best), (c) decisions whose reference loss is within 0.25 points of a band edge; bootstrap 95% intervals; tuning and held-out games separately.
 *   B2  a standard-error sequential stopping rule on the ALT pass (so it is judged out of sample against the REFERENCE): after 20 samples, every 10, stop when the
 *       95% interval of (best - played) lies inside one grade band or has half-width < 0.25 points (and, in the stricter variant, the top move is resolved: the
 *       interval of (top1 - top2) excludes 0 or has half-width < 0.25), or at the cap (400 device, 2,500 server). The coverage gate is not involved (this prototype
 *       never goes through the dispatcher). Production behaviour is untouched.
 *
 *   npx tsx packages/review-engine/src/devtools/reviewSamplingStudy.ts <outJsonl> [maxDecisions] [shard=0] [shards=1]
 *   npx tsx packages/review-engine/src/devtools/reviewSamplingStudy.ts --report <outJsonl> [<outJsonl> ...]
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitOf, type CorpusSplit } from './corpusSplit';
import { replayRecordedSelfPlay } from './replayRecordedSelfPlay';
import {
  BAND_EDGES,
  bootstrapInterval,
  cohensKappa,
  formatInterval,
  fraction,
  meanOf,
  quantile,
  runSamplePass,
  solvedAt,
  verdictAtBudget,
  verdictAtSamples,
  type Grade,
  type SamplePass,
  type Verdict,
} from './reviewSamplingStudyLib';

const COUNTS = [25, 50, 100, 200, 400] as const;
const REF_CAP = 2500;
const DEVICE_CAP = 400;
const Z = 1.96;
const MIN_N = 20;
const STEP = 10;
const HALF_WIDTH = 0.25;

type V = { top: string; loss: number; grade: Grade; samples: number };
type Stop = { n: number; top: string; loss: number; grade: Grade; ms: number };
type Rec = {
  split: CorpusSplit;
  gameId: string;
  move: number;
  legal: number;
  ref: V;
  refMs: number;
  prefix: Record<number, V>;
  indep: Record<number, V>;
  indepMs: Record<number, number>;
  se: Record<'deviceLoss' | 'deviceLossTop' | 'serverLoss' | 'serverLossTop', Stop>;
};

const brief = (pass: SamplePass, verdict: Verdict): V => ({ top: pass.actionKeys[verdict.topIndex]!, loss: verdict.loss, grade: verdict.grade, samples: verdict.samples });

function paired(pass: SamplePass, n: number, a: number, b: number): { mean: number; half: number } {
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < n; i += 1) {
    const d = pass.perSample[i]![a]! - pass.perSample[i]![b]!;
    sum += d;
    sumSq += d * d;
  }
  const mean = sum / n;
  const variance = n > 1 ? Math.max(0, (sumSq - n * mean * mean) / (n - 1)) : 0;
  return { mean, half: Z * Math.sqrt(variance / n) };
}

const bandIndex = (value: number): number => (value <= BAND_EDGES[0] ? 0 : value <= BAND_EDGES[1] ? 1 : value <= BAND_EDGES[2] ? 2 : 3);

/** The sequential standard-error stopping rule (see the header). Returns the sample count it stopped at and the verdict there. */
function sePrefix(pass: SamplePass, cap: number, requireTop: boolean): Stop {
  const limit = solvedAt(pass, cap);
  let n = Math.min(MIN_N, limit);
  for (; n <= limit; n += STEP) {
    const verdict = verdictAtSamples(pass, n);
    const loss = paired(pass, n, verdict.topIndex, pass.playedIndex);
    const lo = loss.mean - loss.half;
    const hi = loss.mean + loss.half;
    const lossResolved = loss.half < HALF_WIDTH || bandIndex(lo) === bandIndex(hi);
    let topResolved = true;
    if (requireTop && verdict.secondIndex !== null) {
      const gap = paired(pass, n, verdict.topIndex, verdict.secondIndex);
      topResolved = gap.half < HALF_WIDTH || gap.mean - gap.half > 0;
    }
    if ((lossResolved && topResolved) || n + STEP > limit) break;
  }
  n = Math.min(Math.max(n, 1), limit);
  const verdict = verdictAtSamples(pass, n);
  let ms = 0;
  for (let i = 0; i < n; i += 1) ms += pass.msPerSample[i]!;
  return { n, top: pass.actionKeys[verdict.topIndex]!, loss: verdict.loss, grade: verdict.grade, ms };
}

function collect(outPath: string, maxDecisions: number, shard: number, shards: number): void {
  const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/recorded-self-play');
  const population = replayRecordedSelfPlay(dir).filter(({ snapshot, evaluation }) => snapshot.preAction.boneyard.drawableCount > 0 && evaluation.candidates.length > 1);
  writeFileSync(outPath, '');
  let done = 0;
  population.forEach(({ snapshot }, index) => {
    if (index % shards !== shard || done >= maxDecisions) return;
    const ref = runSamplePass(snapshot, 'B-ref', REF_CAP);
    const alt = runSamplePass(snapshot, 'B-alt', REF_CAP);
    if (!ref || !alt) return;
    const refVerdict = verdictAtBudget(ref, REF_CAP);
    const rec: Rec = {
      split: splitOf(snapshot.identifiers.gameId),
      gameId: snapshot.identifiers.gameId,
      move: snapshot.identifiers.actionNumber,
      legal: snapshot.legalActions.length,
      ref: brief(ref, refVerdict),
      refMs: ref.msPerSample.reduce((s, x) => s + x, 0),
      prefix: {},
      indep: {},
      indepMs: {},
      se: {
        deviceLoss: sePrefix(alt, DEVICE_CAP, false),
        deviceLossTop: sePrefix(alt, DEVICE_CAP, true),
        serverLoss: sePrefix(alt, REF_CAP, false),
        serverLossTop: sePrefix(alt, REF_CAP, true),
      },
    };
    for (const n of COUNTS) {
      rec.prefix[n] = brief(ref, verdictAtBudget(ref, n));
      rec.indep[n] = brief(alt, verdictAtBudget(alt, n));
      let ms = 0;
      for (let i = 0; i < solvedAt(alt, n); i += 1) ms += alt.msPerSample[i]!;
      rec.indepMs[n] = ms;
    }
    appendFileSync(outPath, `${JSON.stringify(rec)}\n`);
    done += 1;
    if (done % 25 === 0) process.stderr.write(`shard ${shard}: ${done} decisions\n`);
  });
  process.stdout.write(`shard ${shard}/${shards}: ${done} decisions -> ${outPath}\n`);
}

// ---- report -------------------------------------------------------------------------------------------------------------

const nearEdge = (loss: number): boolean => BAND_EDGES.some((edge) => Math.abs(loss - edge) <= 0.25);
const pct = (r: { point: number | null; lo: number | null; hi: number | null }) => formatInterval(r);

function report(paths: string[]): void {
  const records = paths.flatMap((path) => readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as Rec));
  const out: string[] = [];
  const say = (line = '') => out.push(line);
  say(`${records.length} hidden-hand decisions (bot play); tuning ${records.filter((r) => r.split === 'tuning').length}, held-out ${records.filter((r) => r.split === 'heldout').length}`);
  for (const split of ['heldout', 'tuning'] as const) {
    const all = records.filter((r) => r.split === split);
    const nonBest = all.filter((r) => r.ref.grade !== 'best');
    const edge = all.filter((r) => nearEdge(r.ref.loss));
    say('');
    say(`=== ${split.toUpperCase()}: ${all.length} decisions, ${nonBest.length} non-Best (${((nonBest.length / Math.max(1, all.length)) * 100).toFixed(0)}%), ${edge.length} within 0.25 points of a band edge ===`);
    for (const kind of ['prefix', 'indep'] as const) {
      say(`-- B1 ${kind === 'prefix' ? 'PREFIX (the N samples are the first N of the reference pass)' : 'INDEPENDENT seed (N samples from a different seed)'}; 95% bootstrap intervals`);
      say('   N | top-move all | top-move non-Best | grade all | grade non-Best | grade near-edge | kappa all | kappa non-Best | MAE loss all | MAE loss non-Best | mean ms (indep)');
      for (const n of COUNTS) {
        const top = (items: Rec[]) => bootstrapInterval(items, (s) => fraction(s.map((r) => r[kind][n]!.top === r.ref.top)));
        const grade = (items: Rec[]) => bootstrapInterval(items, (s) => fraction(s.map((r) => r[kind][n]!.grade === r.ref.grade)));
        const kappa = (items: Rec[]) => bootstrapInterval(items, (s) => cohensKappa(s.map((r) => r[kind][n]!.grade), s.map((r) => r.ref.grade)));
        const mae = (items: Rec[]) => meanOf(items.map((r) => Math.abs(r[kind][n]!.loss - r.ref.loss)));
        const k = kappa(all);
        const kn = kappa(nonBest);
        say(
          `${String(n).padStart(4)} | ${pct(top(all))} | ${pct(top(nonBest))} | ${pct(grade(all))} | ${pct(grade(nonBest))} | ${pct(grade(edge))}`
          + ` | ${k.point === null ? 'n/a' : k.point.toFixed(2)} [${k.lo?.toFixed(2) ?? '?'}, ${k.hi?.toFixed(2) ?? '?'}] | ${kn.point === null ? 'n/a' : kn.point.toFixed(2)} [${kn.lo?.toFixed(2) ?? '?'}, ${kn.hi?.toFixed(2) ?? '?'}]`
          + ` | ${mae(all)?.toFixed(3) ?? 'n/a'} | ${mae(nonBest)?.toFixed(3) ?? 'n/a'} | ${kind === 'indep' ? (meanOf(all.map((r) => r.indepMs[n]!))?.toFixed(1) ?? 'n/a') : '-'}`,
        );
      }
    }
    say('-- B2 standard-error sequential stopping (on the ALT pass, judged against the 2,500-sample reference)');
    say('   rule | cap | mean N | median N | p90 N | mean ms | grade all | grade non-Best | top-move all | top-move non-Best | bar (grade >= 90%, top >= 95% on non-Best)');
    for (const [key, label, cap] of [
      ['deviceLoss', 'loss-only (as briefed)', 400], ['deviceLossTop', 'loss + top move', 400], ['serverLoss', 'loss-only (as briefed)', 2500], ['serverLossTop', 'loss + top move', 2500],
    ] as const) {
      const ns = all.map((r) => r.se[key].n);
      const g = (items: Rec[]) => bootstrapInterval(items, (s) => fraction(s.map((r) => r.se[key].grade === r.ref.grade)));
      const t = (items: Rec[]) => bootstrapInterval(items, (s) => fraction(s.map((r) => r.se[key].top === r.ref.top)));
      const gnb = g(nonBest);
      const tnb = t(nonBest);
      const meets = (gnb.point ?? 0) >= 0.9 && (tnb.point ?? 0) >= 0.95;
      say(
        `   ${label.padEnd(22)} | ${cap} | ${meanOf(ns)?.toFixed(0)} | ${quantile(ns, 0.5)} | ${quantile(ns, 0.9)} | ${meanOf(all.map((r) => r.se[key].ms))?.toFixed(1)}`
        + ` | ${pct(g(all))} | ${pct(gnb)} | ${pct(t(all))} | ${pct(tnb)} | ${meets ? 'MEETS' : 'below'}`,
      );
    }
    const refMean = meanOf(all.map((r) => r.refMs));
    say(`   (reference 2,500 samples costs a mean ${refMean?.toFixed(0)} ms per decision on this machine)`);
  }
  // B3: cost per game at each stopping rule, from the held-out decisions (a game here has about 60 hidden-hand decisions for the player)
  const held = records.filter((r) => r.split === 'heldout');
  say('');
  say('=== B3: laptop cost of a 60-decision game (mean ms per decision x 60), held-out decisions ===');
  say(`   reference 2,500 samples: ${(((meanOf(held.map((r) => r.refMs)) ?? 0) * 60) / 1000).toFixed(1)} s`);
  for (const n of COUNTS) say(`   fixed N = ${n}: ${(((meanOf(held.map((r) => r.indepMs[n]!)) ?? 0) * 60) / 1000).toFixed(2)} s`);
  for (const key of ['deviceLoss', 'deviceLossTop', 'serverLoss', 'serverLossTop'] as const) {
    say(`   SE rule ${key}: ${(((meanOf(held.map((r) => r.se[key].ms)) ?? 0) * 60) / 1000).toFixed(2)} s (mean N ${meanOf(held.map((r) => r.se[key].n))?.toFixed(0)})`);
  }
  process.stdout.write(`${out.join('\n')}\n`);
}

if (process.argv[2] === '--report') report(process.argv.slice(3));
else collect(resolve(process.argv[2] ?? '/tmp/review-sampling-study.jsonl'), Number(process.argv[3] ?? '100000'), Number(process.argv[4] ?? '0'), Number(process.argv[5] ?? '1'));
