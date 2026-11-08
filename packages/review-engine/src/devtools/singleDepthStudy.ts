/**
 * Measures the single-depth prototype (singleDepthPrototype.ts) for docs/review-single-depth-design-2026-11-08.md. For every decision with tiles to draw and more than one legal
 * action (the 501 exact-path decisions and the 320 ladder decisions of the recorded corpus), 3 plies, bot play:
 *   S1, S2  two runs of N = 400 units with different seed keys; the verdict and the cumulative wall ms at N = 100, 200, 400 (so cost and repeatability at each N)
 *   ref     exact-path decisions only: a reference of 2 x 1,000 units (seed keys R1, R2) pooled, i.e. an estimate over hands AND boneyard orders (the ladder decisions use the
 *           pooled 2 x 2,500 3-ply passes of recordLadderPass.ts)
 *   resume  whether stats(0..100) + stats(100..400) equals stats(0..400) exactly
 *   npx tsx packages/review-engine/src/devtools/singleDepthStudy.ts <out.jsonl> <shard> <shards>
 */
import { appendFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { splitOf } from './corpusSplit';
import { replayRecordedSelfPlay } from './replayRecordedSelfPlay';
import { addUnit, mergeStats, newStats, runRange, unitRunner, verdictOf, type Stats } from './singleDepthPrototype';

const out = resolve(process.argv[2] ?? '/tmp/single-depth.jsonl');
const shard = Number(process.argv[3] ?? '0');
const shards = Number(process.argv[4] ?? '1');
const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/recorded-self-play');
const CHECKPOINTS = [100, 200, 400] as const;

writeFileSync(out, '');
const positions = replayRecordedSelfPlay(dir).filter(({ snapshot, evaluation }) => snapshot.preAction.boneyard.drawableCount > 0 && evaluation.candidates.length > 1);
positions.forEach(({ snapshot }, index) => {
  if (index % shards !== shard) return;
  const run = (salt: string) => {
    const runner = unitRunner(snapshot, `${snapshot.identifiers.decisionId}:${salt}`);
    const stats = newStats(runner.actions);
    const started = performance.now();
    const at: Record<number, { top: string; grade: string; loss: number; ms: number; lo: number; hi: number }> = {};
    for (let i = 0; i < 400; i += 1) {
      addUnit(stats, runner.unit(i));
      if ((CHECKPOINTS as readonly number[]).includes(i + 1)) {
        const v = verdictOf(stats, runner.playedIndex, runner.actionKeys);
        at[i + 1] = { top: v.top, grade: v.grade, loss: v.loss, ms: performance.now() - started, lo: v.interval[0], hi: v.interval[1] };
      }
    }
    return { runner, at, stats };
  };
  const s1 = run('s1');
  const s2 = run('s2');

  // resumability: units 0..99 and 100..399 computed separately add up to units 0..399
  const split = mergeStats(runRange(s1.runner, 0, 100), runRange(s1.runner, 100, 400));
  const same = (x: Stats, y: Stats) => JSON.stringify(x) === JSON.stringify(y);
  const resumeOk = same(split, s1.stats);

  let ref: { top: string; grade: string; loss: number } | null = null;
  const distinct = s1.runner.distinctHands;
  if (distinct !== null) {
    const r1 = unitRunner(snapshot, `${snapshot.identifiers.decisionId}:r1`);
    const r2 = unitRunner(snapshot, `${snapshot.identifiers.decisionId}:r2`);
    const pooled = mergeStats(runRange(r1, 0, 1000), runRange(r2, 0, 1000));
    const v = verdictOf(pooled, r1.playedIndex, r1.actionKeys);
    ref = { top: v.top, grade: v.grade, loss: v.loss };
  }
  appendFileSync(out, `${JSON.stringify({
    index, gameId: snapshot.identifiers.gameId, seat: snapshot.identifiers.actorId, move: snapshot.identifiers.actionNumber, split: splitOf(snapshot.identifiers.gameId),
    path: distinct !== null ? 'exact' : 'ladder', distinct, legal: snapshot.legalActions.length, S1: s1.at, S2: s2.at, ref, resumeOk,
  })}\n`);
});
process.stdout.write(`shard ${shard} done\n`);
