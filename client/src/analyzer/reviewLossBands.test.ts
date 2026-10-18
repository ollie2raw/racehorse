/**
 * Move-quality label thresholds, exact boundaries, against INDEPENDENT literals (not imported from the calibration module).
 *
 *   loss <= 0.12999999999999995  -> Best          (boundaries are inclusive on the better side)
 *   loss <= 0.79                 -> Inaccuracy
 *   loss <= 5.98                 -> Mistake
 *   otherwise                    -> Blunder
 *
 * Each boundary is probed at the previous double, the boundary itself, and the next double, so a `<=` that became `<`
 * (or a boundary nudged by one ulp) fails here. Forced and heuristic decisions never carry a band.
 */
import { describe, expect, it } from 'vitest';
import type { ReviewEvaluationV1 } from '@racehorse/game-core/review';
import { LOSS_BAND_BOUNDARIES } from '@racehorse/review-engine';
import { lossBandLabel, lossBandLabelForEvaluation, type LossBandLabel } from './gameAccuracyModel';

const BEST = 0.12999999999999995;
const INACCURACY = 0.79;
const MISTAKE = 5.98;

const step = (x: number, direction: 1 | -1): number => {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  view.setBigUint64(0, view.getBigUint64(0) + BigInt(direction));
  return view.getFloat64(0);
};

describe('loss band boundaries', () => {
  it('the calibrated boundaries are the documented literals', () => {
    expect(LOSS_BAND_BOUNDARIES).toEqual({ bestTolerance: BEST, inaccuracyToMistake: INACCURACY, mistakeToBlunder: MISTAKE });
  });

  const probes: Array<[string, number, LossBandLabel]> = [
    ['zero', 0, 'Best'],
    ['a small gain (negative loss)', -3, 'Best'],
    ['just below the Best tolerance', step(BEST, -1), 'Best'],
    ['exactly the Best tolerance', BEST, 'Best'],
    ['just above the Best tolerance', step(BEST, 1), 'Inaccuracy'],
    ['0.13 (a loss one ulp-neighbour above the tolerance)', 0.13, 'Inaccuracy'],
    ['just below the Inaccuracy boundary', step(INACCURACY, -1), 'Inaccuracy'],
    ['exactly the Inaccuracy boundary', INACCURACY, 'Inaccuracy'],
    ['just above the Inaccuracy boundary', step(INACCURACY, 1), 'Mistake'],
    ['just below the Mistake boundary', step(MISTAKE, -1), 'Mistake'],
    ['exactly the Mistake boundary', MISTAKE, 'Mistake'],
    ['just above the Mistake boundary', step(MISTAKE, 1), 'Blunder'],
    ['a large loss', 40, 'Blunder'],
    ['infinite loss', Number.POSITIVE_INFINITY, 'Blunder'],
  ];
  for (const [name, loss, label] of probes) {
    it(`${name} (${loss}) -> ${label}`, () => {
      expect(lossBandLabel(loss)).toBe(label);
    });
  }

  it('is a pure function: the same loss gives the same label every time', () => {
    for (const loss of [0.0001, 0.13, 0.5, 0.79, 1, 5.98, 6]) {
      expect(new Set(Array.from({ length: 20 }, () => lossBandLabel(loss))).size).toBe(1);
    }
  });
});

describe('which decisions carry a band at all', () => {
  const a = { kind: 'play', tile: { low: 0, high: 1 }, position: 'left' } as const;
  const b = { kind: 'play', tile: { low: 0, high: 1 }, position: 'right' } as const;
  const cand = (action: typeof a | typeof b) => ({ action, value: { expectedPointDifferential: 0, winProbability: null }, immediatePoints: 0, principalVariation: [] });
  const evaluation = (loss: number, source: 'exact' | 'search' | 'heuristic', candidates: ReturnType<typeof cand>[]): ReviewEvaluationV1 => ({
    evaluationVersion: 1, snapshotId: 'x', rulesVersion: 1, reviewEngineVersion: 'review-engine-v1',
    evidence: source === 'heuristic' ? { source, confidence: 'low', displayLabel: 'Heuristic estimate' } : source === 'exact'
      ? { source, confidence: 'high', displayLabel: 'Exact analysis' } : { source, confidence: 'medium', displayLabel: 'Review Engine search' },
    played: candidates[0]!, best: candidates[0]!, candidates, loss: { expectedPointDifferential: loss, winProbability: null },
    search: { nodes: 1, depth: 0, hiddenStateSamples: 1, coverage: 1, complete: true }, diagnostics: [],
  }) as unknown as ReviewEvaluationV1;

  it('exact and search decisions with a real choice are banded by their loss', () => {
    expect(lossBandLabelForEvaluation(evaluation(0.5, 'exact', [cand(a), cand(b)]))).toBe('Inaccuracy');
    expect(lossBandLabelForEvaluation(evaluation(7, 'search', [cand(a), cand(b)]))).toBe('Blunder');
  });

  it('a forced decision (one legal action) and a heuristic estimate carry no band', () => {
    expect(lossBandLabelForEvaluation(evaluation(7, 'exact', [cand(a)]))).toBeNull();
    expect(lossBandLabelForEvaluation(evaluation(7, 'heuristic', [cand(a), cand(b)]))).toBeNull();
  });

  it('one tile on two ends is a real choice, not a forced decision', () => {
    expect(lossBandLabelForEvaluation(evaluation(0, 'exact', [cand(a), cand(b)]))).toBe('Best');
  });
});
