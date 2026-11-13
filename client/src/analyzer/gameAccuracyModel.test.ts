import { describe, expect, it } from 'vitest';
import type { ReviewCandidateEvaluationV1, ReviewEvaluationV1 } from '@racehorse/game-core/review';
import { LOSS_BAND_BOUNDARIES } from '@racehorse/review-engine';
import { lossBandLabel, lossBandLabelForEvaluation } from './gameAccuracyModel';
import { assertPresentationConsistency, buildReviewPresentationRecord, presentationLabel } from './reviewPresentationRecord';

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

describe('lossBandLabelForEvaluation -- partial bounded-search results', () => {
  const SEARCH: ReviewEvaluationV1['evidence'] = { source: 'search', confidence: 'medium', displayLabel: 'Review Engine search' };
  const bounded = (partial: boolean, lossInterval: readonly [number, number]): ReviewEvaluationV1['boundedSearch'] => ({
    stopReason: partial ? 'cap' : 'resolved', partial, handsVisited: 12, totalHands: 300, plyDepth: 3, orderSeed: 'bounded-exact-v1:x', lossInterval, confidence: 0.95,
  });

  it('shows the badge of a partial result whose interval lies inside one band', () => {
    expect(lossBandLabelForEvaluation({ ...decision(1.5, SEARCH), boundedSearch: bounded(true, [1.0, 2.5]) })).toBe('Mistake');
    expect(lossBandLabelForEvaluation({ ...decision(0.05, SEARCH), boundedSearch: bounded(true, [0, 0.1]) })).toBe('Best');
  });

  it('shows no badge for a partial result whose interval spans two bands', () => {
    expect(lossBandLabelForEvaluation({ ...decision(0.5, SEARCH), boundedSearch: bounded(true, [0.2, 1.4]) })).toBeNull();
    expect(lossBandLabelForEvaluation({ ...decision(0.05, SEARCH), boundedSearch: bounded(true, [0, 1_000_000]) })).toBeNull();
  });

  it('never holds back a result that finished or resolved, or one without the bounded field', () => {
    expect(lossBandLabelForEvaluation({ ...decision(0.5, SEARCH), boundedSearch: bounded(false, [0.2, 1.4]) })).toBe('Inaccuracy');
    expect(lossBandLabelForEvaluation(decision(0.5, SEARCH))).toBe('Inaccuracy');
  });
});

describe('lossBandLabelForEvaluation -- sampled results cut short by the ceiling or a node budget (partialSearch)', () => {
  const SEARCH: ReviewEvaluationV1['evidence'] = { source: 'search', confidence: 'medium', displayLabel: 'Review Engine search' };
  const cut = (lossInterval: readonly [number, number]): ReviewEvaluationV1['partialSearch'] => ({
    partial: true, reason: 'wall-clock', samplesSolved: 45, samplesRequested: 100, lossInterval, confidence: 0.95,
  });

  it('shows no badge, not even Best, for a cut result whose interval spans two bands', () => {
    expect(lossBandLabelForEvaluation({ ...decision(1.0, SEARCH), partialSearch: cut([0.4, 1.6]) })).toBeNull();
    expect(lossBandLabelForEvaluation({ ...decision(0.0, SEARCH), partialSearch: cut([0, 0.62]) })).toBeNull();
    expect(lossBandLabelForEvaluation({ ...decision(0.05, SEARCH), partialSearch: cut([0, 1_000_000]) })).toBeNull();
  });

  it('keeps the badge of a cut result whose interval lies inside one band', () => {
    expect(lossBandLabelForEvaluation({ ...decision(1.5, SEARCH), partialSearch: cut([1.0, 2.5]) })).toBe('Mistake');
    expect(lossBandLabelForEvaluation({ ...decision(0.0, SEARCH), partialSearch: cut([0, 0]) })).toBe('Best');
  });

  it('never holds back a result without the field (every result from before the flag, and every uncut one)', () => {
    expect(lossBandLabelForEvaluation(decision(1.0, SEARCH))).toBe('Mistake');
    expect(lossBandLabelForEvaluation(decision(0.0, SEARCH))).toBe('Best');
  });

  it('presents a cut result with no badge as qualitative: no loss figure and no severity word, and the presentation checks hold', () => {
    const evaluation = { ...decision(1.0, SEARCH), partialSearch: cut([0.4, 1.6]) };
    const record = buildReviewPresentationRecord(evaluation, null);
    expect(record.classification).toEqual({ kind: 'forced' });
    expect(record.lossVsPrimary).toBeNull();
    expect(assertPresentationConsistency(record, 'Best move.')).toEqual([]);
    expect(presentationLabel(record) ?? '').not.toMatch(/Mistake|Blunder|Inaccuracy/);
  });
});
