import { describe, expect, it } from 'vitest';
import type { ReviewCandidateEvaluationV1, ReviewEvaluationV1 } from '@racehorse/game-core/review';
import { LOSS_BAND_BOUNDARIES } from '@racehorse/review-engine';
import {
  computeGameAccuracyModel,
  lossBandLabel,
  lossBandLabelForEvaluation,
  type GameAccuracyModelResult,
} from './gameAccuracyModel';

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

function expectComplete(result: GameAccuracyModelResult): asserts result is Extract<GameAccuracyModelResult, { status: 'complete' }> {
  expect(result.status).toBe('complete');
}

function expectPartial(result: GameAccuracyModelResult): asserts result is Extract<GameAccuracyModelResult, { status: 'partial' }> {
  expect(result.status).toBe('partial');
}

describe('lossBandLabel -- against known boundary values', () => {
  const boundaries = { bestTolerance: 1, inaccuracyToMistake: 5, mistakeToBlunder: 10 };

  it('labels 0 (and anything <= bestTolerance) as Best', () => {
    expect(lossBandLabel(0, boundaries)).toBe('Best');
    expect(lossBandLabel(1, boundaries)).toBe('Best');
  });

  it('labels just above bestTolerance as Inaccuracy', () => {
    expect(lossBandLabel(1.01, boundaries)).toBe('Inaccuracy');
  });

  it('labels exactly at inaccuracyToMistake as Inaccuracy (lower-boundary-inclusive)', () => {
    expect(lossBandLabel(5, boundaries)).toBe('Inaccuracy');
  });

  it('labels just above inaccuracyToMistake as Mistake', () => {
    expect(lossBandLabel(5.01, boundaries)).toBe('Mistake');
  });

  it('labels exactly at mistakeToBlunder as Mistake (lower-boundary-inclusive)', () => {
    expect(lossBandLabel(10, boundaries)).toBe('Mistake');
  });

  it('labels anything above mistakeToBlunder as Blunder', () => {
    expect(lossBandLabel(10.01, boundaries)).toBe('Blunder');
    expect(lossBandLabel(1000, boundaries)).toBe('Blunder');
  });

  it('defaults to the real calibrated LOSS_BAND_BOUNDARIES when none is passed', () => {
    expect(lossBandLabel(0)).toBe('Best');
    expect(lossBandLabel(LOSS_BAND_BOUNDARIES.mistakeToBlunder + 1)).toBe('Blunder');
  });
});

describe('lossBandLabelForEvaluation -- scorable decisions only, per spec section 4a', () => {
  const boundaries = { bestTolerance: 1, inaccuracyToMistake: 5, mistakeToBlunder: 10 };

  it('returns null for a forced decision, regardless of loss', () => {
    expect(lossBandLabelForEvaluation(forcedDecision(), boundaries)).toBeNull();
  });

  it('returns null for a heuristic-only decision, regardless of loss', () => {
    expect(lossBandLabelForEvaluation(decision(20, HEURISTIC), boundaries)).toBeNull();
  });

  it('returns a real label for a scorable (non-forced, non-heuristic) decision', () => {
    expect(lossBandLabelForEvaluation(decision(0.5, EXACT), boundaries)).toBe('Best');
    expect(lossBandLabelForEvaluation(decision(20, EXACT), boundaries)).toBe('Blunder');
  });
});

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

  it('one heuristic-tier non-forced decision makes the whole result partial, with correct counts', () => {
    const evaluations = [decision(0, EXACT), decision(1, EXACT), decision(2, HEURISTIC)];
    const result = computeGameAccuracyModel(evaluations);
    expectPartial(result);
    expect(result.accuracy).toBeNull();
    expect(result.grade).toBeNull();
    expect(result.heuristicMoveCount).toBe(1);
    expect(result.totalNonForcedMoveCount).toBe(3);
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
