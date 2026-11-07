import { describe, expect, it } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { solveMidgameDeterminization } from '../solveMidgameDeterminization';
import { replayRecordedSelfPlay } from './replayRecordedSelfPlay';
import {
  BAND_EDGES,
  NODES_PER_SAMPLE,
  bootstrapInterval,
  canonicalActionKey,
  cohensKappa,
  fraction,
  gradeOfLoss,
  runSamplePass,
  solvedAt,
  verdictAtBudget,
} from './reviewSamplingStudyLib';

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/recorded-self-play');
const SEED = 'study-lib-test';

/** A few real hidden-hand decisions (tiles still to draw, more than one action) spread across the corpus. */
const decisions = replayRecordedSelfPlay(dir)
  .filter(({ snapshot, evaluation }) => snapshot.preAction.boneyard.drawableCount > 0 && evaluation.candidates.length > 1)
  .filter((_, index) => index % 97 === 0)
  .slice(0, 6);

describe('runSamplePass reproduces the production solver exactly (so the offline study is about what production computes)', () => {
  it('has real decisions to check', () => {
    expect(decisions.length).toBeGreaterThanOrEqual(4);
  });

  for (const n of [25, 100]) {
    it(`the first ${n} samples of one pass equal solveMidgameDeterminization at ${n} samples: same samples solved, same best action, same expected values`, { timeout: 120_000 }, () => {
      for (const { snapshot } of decisions) {
        const pass = runSamplePass(snapshot, SEED, 200);
        const real = solveMidgameDeterminization(snapshot, { maxNodes: n * NODES_PER_SAMPLE, maxHiddenStateSamples: n }, SEED, 2);
        expect(pass).not.toBeNull();
        expect(real).not.toBeNull();
        const mine = verdictAtBudget(pass!, n);
        expect(mine.samples).toBe(real!.hiddenStateSamples);
        expect(pass!.actionKeys[mine.topIndex]).toBe(canonicalActionKey(real!.best.action));
        // every action's mean equals the solver's candidate value (to floating-point exactness: the same integer sums over the same count)
        const solved = solvedAt(pass!, n);
        pass!.actionKeys.forEach((key, action) => {
          const mean = pass!.perSample.slice(0, solved).reduce((sum, sample) => sum + sample[action]!, 0) / Math.max(1, solved);
          const candidate = real!.candidates.find((c) => canonicalActionKey(c.action) === key)!;
          expect(mean).toBeCloseTo(candidate.value.expectedPointDifferential, 9);
        });
      }
    });
  }
});

describe('study statistics', () => {
  it('grades a loss with the calibrated band edges', () => {
    expect(gradeOfLoss(0)).toBe('best');
    expect(gradeOfLoss(BAND_EDGES[0])).toBe('best');
    expect(gradeOfLoss(BAND_EDGES[0] + 0.01)).toBe('inaccuracy');
    expect(gradeOfLoss(BAND_EDGES[1] + 0.01)).toBe('mistake');
    expect(gradeOfLoss(BAND_EDGES[2] + 0.01)).toBe('blunder');
  });

  it("Cohen's kappa is 1 for identical labels, near 0 for chance agreement, and null when one label dominates both", () => {
    expect(cohensKappa(['best', 'mistake', 'best', 'blunder'], ['best', 'mistake', 'best', 'blunder'])).toBe(1);
    expect(cohensKappa(['best', 'best'], ['best', 'best'])).toBeNull();
    const k = cohensKappa(['best', 'best', 'mistake', 'mistake'], ['best', 'mistake', 'best', 'mistake']);
    expect(k).toBeCloseTo(0, 9);
  });

  it('a bootstrap interval is reproducible and contains the point estimate', () => {
    const hits = [true, true, true, false, true, false, true, true, true, true];
    const a = bootstrapInterval(hits, fraction);
    const b = bootstrapInterval(hits, fraction);
    expect(a).toEqual(b);
    expect(a.point).toBeCloseTo(0.8, 9);
    expect(a.lo!).toBeLessThanOrEqual(a.point!);
    expect(a.hi!).toBeGreaterThanOrEqual(a.point!);
  });
});
