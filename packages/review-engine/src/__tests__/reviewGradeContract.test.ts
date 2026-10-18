/**
 * Accuracy, letter grade and coverage-floor contract, against INDEPENDENT literals (nothing here imports the calibration
 * constants: they are restated, so a silent change to a threshold fails this file).
 *
 *   accuracy = clamp(100 * exp(-k * mean loss over scorable decisions), 0, 100)       k = 0.20094184929012865
 *   letter   = S >= 92, A >= 82, B >= 72, C >= 60, else D                             (inclusive on the better side)
 *   accuracy/grade appear only when scorable / non-forced >= 22/47 (= 0.46808510638297873)
 */
import { describe, expect, it } from 'vitest';
import type { ReviewEvaluationV1 } from '@racehorse/game-core/review';
import { gradeFromAccuracy } from '../accuracyGrade';
import { computeGameAccuracyModel, MINIMUM_COVERAGE_FLOOR } from '../gameAccuracyModel';
import { accuracyFromEvaluations } from '../reviewAccuracy';

const K = 0.20094184929012865;
const FLOOR = 22 / 47;

const next = (x: number): number => {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  buf.setBigUint64(0, buf.getBigUint64(0) + 1n);
  return buf.getFloat64(0);
};
const prev = (x: number): number => {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  buf.setBigUint64(0, buf.getBigUint64(0) - 1n);
  return buf.getFloat64(0);
};

const A = { kind: 'play', tile: { low: 0, high: 1 }, position: 'left' } as const;
const B = { kind: 'play', tile: { low: 0, high: 1 }, position: 'right' } as const;
const cand = (action: typeof A | typeof B, v: number) => ({ action, value: { expectedPointDifferential: v, winProbability: null }, immediatePoints: 0, principalVariation: [] });

function evaluation(loss: number, source: 'exact' | 'search' | 'heuristic' = 'exact', forced = false): ReviewEvaluationV1 {
  const candidates = forced ? [cand(A, 0)] : [cand(A, loss), cand(B, 0)];
  return {
    evaluationVersion: 1, snapshotId: `d-${loss}-${source}`, rulesVersion: 1 as never, reviewEngineVersion: 'review-engine-v1',
    evidence: source === 'heuristic' ? { source, confidence: 'low', displayLabel: 'Heuristic estimate' } : source === 'exact'
      ? { source, confidence: 'high', displayLabel: 'Exact analysis' } : { source, confidence: 'medium', displayLabel: 'Review Engine search' },
    played: candidates[0]!, best: candidates[candidates.length - 1]!, candidates,
    loss: { expectedPointDifferential: loss, winProbability: null },
    search: { nodes: 1, depth: 0, hiddenStateSamples: 1, coverage: 1, complete: true }, diagnostics: [],
  } as unknown as ReviewEvaluationV1;
}

describe('accuracy = 100 * exp(-k * mean loss)', () => {
  it('matches the independent formula on assorted loss sets', () => {
    const sets = [[0], [0, 0, 0], [1], [0.5, 0.5], [3, 0, 0.13, 7.25, 0.79], [12.5, 0.01], [20, 20, 20]];
    for (const losses of sets) {
      const mean = losses.reduce((s, x) => s + x, 0) / losses.length;
      const expected = Math.min(100, Math.max(0, 100 * Math.exp(-K * mean)));
      const got = accuracyFromEvaluations(losses.map((l) => evaluation(l)));
      expect(got.status).toBe('computed');
      if (got.status === 'computed') expect(got.accuracy, JSON.stringify(losses)).toBeCloseTo(expected, 12);
    }
  });

  it('perfect play is exactly 100, and the value is clamped to [0, 100]', () => {
    const perfect = accuracyFromEvaluations([evaluation(0), evaluation(0)]);
    expect(perfect.status === 'computed' && perfect.accuracy).toBe(100);
    const negative = accuracyFromEvaluations([evaluation(-5)]);
    expect(negative.status === 'computed' && negative.accuracy).toBe(100);
    const huge = accuracyFromEvaluations([evaluation(1e6)]);
    expect(huge.status === 'computed' && huge.accuracy).toBeGreaterThanOrEqual(0);
  });

  it('forced and heuristic decisions never enter the mean', () => {
    const mixed = accuracyFromEvaluations([evaluation(2), evaluation(40, 'exact', true), evaluation(40, 'heuristic')]);
    const only = accuracyFromEvaluations([evaluation(2)]);
    expect(mixed).toEqual(only);
    expect(accuracyFromEvaluations([evaluation(1, 'exact', true), evaluation(1, 'heuristic')]).status).toBe('no-scorable-decisions');
  });

  it('is independent of the order the evaluations arrive in, to the last bit', () => {
    // 41 losses spanning several magnitudes so floating-point addition order would show if it mattered.
    const losses = Array.from({ length: 41 }, (_, i) => (i % 7 === 0 ? 0 : [0.01, 0.13, 0.4, 0.79, 1.7, 5.98, 9.3][i % 7]! * (1 + (i % 5) * 0.37) + i * 1e-9));
    const base = accuracyFromEvaluations(losses.map((l) => evaluation(l)));
    expect(base.status).toBe('computed');
    let state = 12345;
    const rand = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
    const seen = new Set<number>();
    for (let round = 0; round < 300; round += 1) {
      const order = [...losses];
      for (let i = order.length - 1; i > 0; i -= 1) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j]!, order[i]!]; }
      const got = accuracyFromEvaluations(order.map((l) => evaluation(l)));
      if (got.status === 'computed') seen.add(got.accuracy);
    }
    expect([...seen], 'the same decisions in a different arrival order must give the identical accuracy').toHaveLength(1);
    if (base.status === 'computed') expect([...seen][0]).toBe(base.accuracy);
  });
});

describe('letter grades', () => {
  const cases: Array<[number, 'S' | 'A' | 'B' | 'C' | 'D']> = [];
  for (const [boundary, above, below] of [[92, 'S', 'A'], [82, 'A', 'B'], [72, 'B', 'C'], [60, 'C', 'D']] as const) {
    cases.push([prev(boundary), below], [boundary, above], [next(boundary), above]);
  }
  cases.push([100, 'S'], [0, 'D']);
  for (const [accuracy, grade] of cases) {
    it(`${accuracy} -> ${grade}`, () => { expect(gradeFromAccuracy(accuracy)).toBe(grade); });
  }
});

describe('coverage floor: accuracy and grade populate from 22 of 47 scorable non-forced decisions', () => {
  const set = (scorable: number, heuristic: number) => [
    ...Array.from({ length: scorable }, () => evaluation(0.2)),
    ...Array.from({ length: heuristic }, () => evaluation(0, 'heuristic')),
  ];

  it('the constant is 22/47', () => {
    expect(MINIMUM_COVERAGE_FLOOR).toBe(FLOOR);
  });

  it('exactly at the floor: populated; one decision below: null', () => {
    const at = computeGameAccuracyModel(set(22, 25));
    expect(at.totalNonForcedMoveCount).toBe(47);
    expect(at.coverageFraction).toBe(FLOOR);
    expect(at.accuracy, 'at the floor').not.toBeNull();
    const below = computeGameAccuracyModel(set(21, 26));
    expect(below.coverageFraction).toBeLessThan(FLOOR);
    expect(below.accuracy, 'one below the floor').toBeNull();
    expect(below.grade).toBeNull();
  });

  it('a whole-game letter needs every non-forced decision calibrated; forced decisions do not count against it', () => {
    const all = computeGameAccuracyModel([...set(10, 0), evaluation(0, 'exact', true), evaluation(0, 'exact', true)]);
    expect(all.status).toBe('complete');
    expect(all.grade).not.toBeNull();
    expect(all.totalNonForcedMoveCount).toBe(10);
    const partial = computeGameAccuracyModel(set(30, 5));
    expect(partial.status).toBe('partial');
    expect(partial.accuracy).not.toBeNull();
    expect(partial.grade, 'estimates remain: no whole-game letter').toBeNull();
  });

  it('an empty review has coverage 0, never NaN', () => {
    const empty = computeGameAccuracyModel([]);
    expect(empty.coverageFraction).toBe(0);
    expect(empty.accuracy).toBeNull();
  });
});
