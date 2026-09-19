import { describe, expect, it } from 'vitest';
import type { ReviewCandidateEvaluationV1, ReviewEvaluationV1 } from '@racehorse/game-core/review';
import { computeGameAccuracyModel, MINIMUM_COVERAGE_FLOOR, type GameAccuracyModelResult } from '../gameAccuracyModel';

const EXACT: ReviewEvaluationV1['evidence'] = { source: 'exact', confidence: 'high', displayLabel: 'Exact analysis' };
const HEURISTIC: ReviewEvaluationV1['evidence'] = { source: 'heuristic', confidence: 'low', displayLabel: 'Heuristic estimate' };

function candidate(tileLow: number, tileHigh: number, expectedPointDifferential = 0): ReviewCandidateEvaluationV1 {
  return {
    action: { kind: 'play', tile: { low: tileLow, high: tileHigh }, position: 'left' },
    value: { expectedPointDifferential, winProbability: null },
    immediatePoints: 0,
    principalVariation: [],
  };
}

/** A scorable (non-forced) decision with the given moveLoss and evidence source. */
function decision(
  moveLoss: number,
  evidence: ReviewEvaluationV1['evidence'] = EXACT,
): ReviewEvaluationV1 {
  const best = candidate(5, 6, moveLoss);
  const played = candidate(0, 1, 0);
  return {
    evaluationVersion: 1,
    snapshotId: 'x',
    rulesVersion: 1,
    reviewEngineVersion: 'review-engine-v1',
    evidence,
    played,
    best,
    candidates: [played, best],
    loss: { expectedPointDifferential: moveLoss, winProbability: null },
    search: { nodes: 2, depth: 1, hiddenStateSamples: 0, coverage: 1, complete: true },
    diagnostics: [],
  };
}

/** A forced decision (single real candidate) -- excluded from every check regardless of loss/evidence. */
function forcedDecision(evidence: ReviewEvaluationV1['evidence'] = EXACT): ReviewEvaluationV1 {
  const only = candidate(2, 2, 0);
  return {
    evaluationVersion: 1,
    snapshotId: 'x',
    rulesVersion: 1,
    reviewEngineVersion: 'review-engine-v1',
    evidence,
    played: only,
    best: only,
    candidates: [only],
    loss: { expectedPointDifferential: 0, winProbability: null },
    search: { nodes: 1, depth: 1, hiddenStateSamples: 0, coverage: 1, complete: true },
    diagnostics: [],
  };
}

// GameAccuracyModelResult is a flat type (status no longer gates which
// fields are present -- see the C4 follow-up coverage-floor revision), so
// these are now plain status assertions, not type-narrowing helpers.
function expectComplete(result: GameAccuracyModelResult): void {
  expect(result.status).toBe('complete');
}

function expectPartial(result: GameAccuracyModelResult): void {
  expect(result.status).toBe('partial');
}

describe('computeGameAccuracyModel -- cutover trigger (spec section 6)', () => {
  it('a fully-precise-tier game (all exact/search, no heuristic) is complete', () => {
    const evaluations = [decision(0), decision(1), decision(2)];
    const result = computeGameAccuracyModel(evaluations);
    expectComplete(result);
    expect(result.accuracy).toBeGreaterThan(0);
    expect(result.accuracy).toBeLessThanOrEqual(100);
    expect(['S', 'A', 'B', 'C', 'D']).toContain(result.grade);
    expect(typeof result.accuracyModelVersion).toBe('string');
    expect(result.accuracyModelVersion.length).toBeGreaterThan(0);
  });

  it('one heuristic-tier non-forced decision makes status partial, with correct counts -- coverage (2/3) clears the floor, so accuracy still populates', () => {
    const evaluations = [decision(0, EXACT), decision(1, EXACT), decision(2, HEURISTIC)];
    const result = computeGameAccuracyModel(evaluations);
    expectPartial(result);
    expect(result.heuristicMoveCount).toBe(1);
    expect(result.totalNonForcedMoveCount).toBe(3);
    // Coverage-floor revision: status:'partial' no longer implies a null
    // accuracy -- 2/3 scorable clears MINIMUM_COVERAGE_FLOOR, so both
    // populate here. See the dedicated coverage-floor describe block below
    // for the case where coverage does NOT clear the floor.
    expect(result.accuracy).toBeGreaterThan(0);
    expect(result.grade).not.toBeNull();
  });

  it('multiple heuristic-tier decisions are all counted', () => {
    const evaluations = [decision(0, EXACT), decision(1, HEURISTIC), decision(2, HEURISTIC), decision(3, HEURISTIC)];
    const result = computeGameAccuracyModel(evaluations);
    expectPartial(result);
    expect(result.heuristicMoveCount).toBe(3);
    expect(result.totalNonForcedMoveCount).toBe(4);
  });

  it('forced decisions present but nothing else heuristic is still complete -- forced decisions never affect the trigger', () => {
    const evaluations = [forcedDecision(EXACT), decision(0, EXACT), decision(1, EXACT), forcedDecision(HEURISTIC)];
    const result = computeGameAccuracyModel(evaluations);
    // The forced HEURISTIC-evidence decision must NOT trip the trigger --
    // only non-forced heuristic decisions count, per spec section 6.
    expectComplete(result);
    expect(result.accuracy).toBeGreaterThan(0);
  });

  it('forced decisions do not inflate totalNonForcedMoveCount when the result is partial', () => {
    const evaluations = [forcedDecision(EXACT), decision(0, EXACT), decision(1, HEURISTIC), forcedDecision(EXACT)];
    const result = computeGameAccuracyModel(evaluations);
    expectPartial(result);
    expect(result.totalNonForcedMoveCount).toBe(2);
    expect(result.heuristicMoveCount).toBe(1);
  });

  it('a scope of ONLY forced decisions (no real choices anywhere) is partial with 0-of-0 counts, not a fabricated complete', () => {
    const evaluations = [forcedDecision(EXACT), forcedDecision(EXACT)];
    const result = computeGameAccuracyModel(evaluations);
    expectPartial(result);
    expect(result.heuristicMoveCount).toBe(0);
    expect(result.totalNonForcedMoveCount).toBe(0);
  });

  it('an empty evaluation set is partial with 0-of-0 counts', () => {
    const result = computeGameAccuracyModel([]);
    expectPartial(result);
    expect(result.heuristicMoveCount).toBe(0);
    expect(result.totalNonForcedMoveCount).toBe(0);
  });
});

describe('computeGameAccuracyModel -- coverage-floor decoupling (C4 follow-up, spec section 6 revision)', () => {
  function evaluationsWithRatio(scorableCount: number, heuristicCount: number): ReviewEvaluationV1[] {
    const evaluations: ReviewEvaluationV1[] = [];
    for (let i = 0; i < scorableCount; i += 1) evaluations.push(decision(1, EXACT));
    for (let i = 0; i < heuristicCount; i += 1) evaluations.push(decision(1, HEURISTIC));
    return evaluations;
  }

  it('MINIMUM_COVERAGE_FLOOR is the real, corpus-derived constant (5th percentile of per-game coverage across the 100-game recorded corpus), not a placeholder', () => {
    expect(MINIMUM_COVERAGE_FLOOR).toBeGreaterThan(0);
    expect(MINIMUM_COVERAGE_FLOOR).toBeLessThan(1);
    // Pinned to the exact derived value so an accidental future edit (e.g.
    // someone "simplifying" it to a round 0.5) is caught here rather than
    // silently drifting from the corpus it was fit against.
    expect(MINIMUM_COVERAGE_FLOOR).toBeCloseTo(0.46808510638297873, 10);
  });

  it('status:"partial" with coverage clearing the floor still populates accuracy/grade -- status no longer gates them', () => {
    // 60/100 scorable = 0.6 coverage, well above the 0.468 floor, but
    // heuristicCount > 0 keeps status partial.
    const evaluations = evaluationsWithRatio(60, 40);
    const result = computeGameAccuracyModel(evaluations);
    expectPartial(result);
    expect(result.coverageFraction).toBeCloseTo(0.6, 10);
    expect(result.accuracy).not.toBeNull();
    expect(result.grade).not.toBeNull();
  });

  it('status:"partial" with coverage below the floor keeps accuracy/grade null', () => {
    // 20/100 scorable = 0.2 coverage, below the 0.468 floor.
    const evaluations = evaluationsWithRatio(20, 80);
    const result = computeGameAccuracyModel(evaluations);
    expectPartial(result);
    expect(result.coverageFraction).toBeCloseTo(0.2, 10);
    expect(result.accuracy).toBeNull();
    expect(result.grade).toBeNull();
  });

  it('the floor is inclusive: coverage exactly at MINIMUM_COVERAGE_FLOOR populates accuracy', () => {
    // MINIMUM_COVERAGE_FLOOR is exactly 22/47 (the real corpus game it was
    // derived from) -- 22 scorable + 25 heuristic hits it with zero
    // floating-point rounding, unlike a /1000 ratio which can't represent
    // this exact value.
    const evaluations = evaluationsWithRatio(22, 25);
    const result = computeGameAccuracyModel(evaluations);
    expect(result.coverageFraction).toBe(MINIMUM_COVERAGE_FLOOR);
    expect(result.accuracy).not.toBeNull();
  });

  it('just below the floor keeps accuracy null (boundary is not fuzzy)', () => {
    // 21/47 is the next-lowest achievable ratio just under the floor.
    const evaluations = evaluationsWithRatio(21, 26);
    const result = computeGameAccuracyModel(evaluations);
    expect(result.coverageFraction).toBeLessThan(MINIMUM_COVERAGE_FLOOR);
    expect(result.accuracy).toBeNull();
  });

  it('coverageFraction runs the opposite direction from heuristicMoveCount -- high coverageFraction means MORE analyzed, not less', () => {
    const highCoverage = computeGameAccuracyModel(evaluationsWithRatio(90, 10));
    const lowCoverage = computeGameAccuracyModel(evaluationsWithRatio(10, 90));
    expect(highCoverage.coverageFraction).toBeGreaterThan(lowCoverage.coverageFraction);
    expect(highCoverage.heuristicMoveCount).toBeLessThan(lowCoverage.heuristicMoveCount);
  });

  it('coverageFraction is scorableNonForcedCount/totalNonForcedMoveCount exactly, derivable from the other two fields', () => {
    const result = computeGameAccuracyModel(evaluationsWithRatio(7, 3));
    const scorableNonForcedCount = result.totalNonForcedMoveCount - result.heuristicMoveCount;
    expect(result.coverageFraction).toBeCloseTo(scorableNonForcedCount / result.totalNonForcedMoveCount, 10);
  });

  it('coverageFraction is 0 (not NaN) when totalNonForcedMoveCount is 0', () => {
    const result = computeGameAccuracyModel([]);
    expect(result.coverageFraction).toBe(0);
    expect(Number.isNaN(result.coverageFraction)).toBe(false);
  });

  it('status:"complete" always has coverageFraction === 1 and always clears the floor', () => {
    const result = computeGameAccuracyModel([decision(0, EXACT), decision(1, EXACT)]);
    expectComplete(result);
    expect(result.coverageFraction).toBe(1);
    expect(result.accuracy).not.toBeNull();
  });
});
