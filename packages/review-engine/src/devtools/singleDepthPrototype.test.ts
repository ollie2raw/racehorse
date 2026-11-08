import { describe, expect, it } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildHandUniverse } from '../boundedExactSearch';
import { replayRecordedSelfPlay } from './replayRecordedSelfPlay';
import { addUnit, mergeStats, newStats, runRange, SINGLE_DEPTH_ENGINE, unitRunner, verdictOf } from './singleDepthPrototype';

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/recorded-self-play');
const corpus = replayRecordedSelfPlay(dir).filter(({ snapshot, evaluation }) => snapshot.preAction.boneyard.drawableCount > 0 && evaluation.candidates.length > 1);
const withUniverse = corpus.map(({ snapshot }) => ({ snapshot, universe: buildHandUniverse(snapshot) }));
const small = withUniverse.find((p) => p.universe !== null && p.universe.combinations.length >= 12 && p.universe.combinations.length <= 40)!.snapshot;
const large = withUniverse.find((p) => p.universe === null)!.snapshot;

describe('single-depth prototype: units and statistics', () => {
  it('a unit is a pure function of (decision, seed key, index): the same value in any order, whatever else has run', { timeout: 120_000 }, () => {
    for (const snapshot of [small, large]) {
      const a = unitRunner(snapshot, 'k');
      const b = unitRunner(snapshot, 'k');
      const forward = [0, 1, 2, 3, 40, 41].map((i) => a.unit(i));
      const backward = [41, 40, 3, 2, 1, 0].map((i) => b.unit(i)).reverse();
      expect(backward).toEqual(forward);
      expect(unitRunner(snapshot, 'other').unit(0)).not.toEqual(undefined);
      expect(a.engine).toBe(SINGLE_DEPTH_ENGINE);
      expect(a.plyDepth).toBe(3);
    }
  });

  it('statistics of disjoint ranges ADD: stats(0..40) + stats(40..120) equals stats(0..120) exactly', { timeout: 120_000 }, () => {
    for (const snapshot of [small, large]) {
      const runner = unitRunner(snapshot, 'merge');
      const direct = runRange(runner, 0, 120);
      const merged = mergeStats(runRange(runner, 0, 40), runRange(unitRunner(snapshot, 'merge'), 40, 120));
      expect(merged).toEqual(direct);
      expect(direct.n).toBe(120);
    }
  });

  it('a position with few distinct hands cycles its permutation with a NEW boneyard order each cycle (N units are N independent boneyard draws)', { timeout: 120_000 }, () => {
    const runner = unitRunner(small, 'cycle');
    const count = runner.distinctHands!;
    expect(count).toBeLessThan(50);
    // unit i and unit i + count use the same opponent hand; their values need not match because the boneyard order differs
    const cycles = Array.from({ length: 6 }, (_, c) => JSON.stringify(runner.unit(3 + c * count)));
    expect(new Set(cycles).size).toBeGreaterThan(1);
  });

  it('the verdict comes from the statistics alone and equals the direct mean computation', { timeout: 120_000 }, () => {
    const runner = unitRunner(small, 'verdict');
    const stats = newStats(runner.actions);
    const sums = new Array<number>(runner.actions).fill(0);
    for (let i = 0; i < 60; i += 1) {
      const d = runner.unit(i);
      addUnit(stats, d);
      d.forEach((x, a) => { sums[a]! += x; });
    }
    const v = verdictOf(stats, runner.playedIndex, runner.actionKeys);
    const means = sums.map((s) => s / 60);
    v.means.forEach((m, a) => expect(m).toBe(means[a]));
    expect(v.loss).toBe(Math.max(...means) - means[runner.playedIndex]!);
    expect(v.interval[0]).toBeLessThanOrEqual(v.loss);
    expect(v.interval[1]).toBeGreaterThanOrEqual(v.loss);
  });
});
