import { describe, expect, it } from 'vitest';
import type { ReviewCandidateEvaluationV1, ReviewEvaluationV1 } from '@racehorse/game-core/review';
import type { ReviewBatchState } from '../modules/review/useReviewWorkerBatch';
import { selectMoveHeuristicClassification } from './useMoveHeuristicClassification';

function candidate(low: number, high: number, rawScore: number | undefined): ReviewCandidateEvaluationV1 {
  return {
    action: { kind: 'play', tile: { low, high }, position: 'left' },
    value: { expectedPointDifferential: 0, winProbability: null },
    immediatePoints: 0,
    principalVariation: [],
    rawScore,
  };
}

function heuristicEvaluation(candidates: readonly ReviewCandidateEvaluationV1[]): ReviewEvaluationV1 {
  return {
    evaluationVersion: 1,
    snapshotId: 'x',
    rulesVersion: 1,
    reviewEngineVersion: 'review-engine-v1',
    evidence: { source: 'heuristic', confidence: 'low', displayLabel: 'Heuristic estimate' },
    played: candidates[0],
    best: candidates[0],
    candidates,
    loss: { expectedPointDifferential: 0, winProbability: null },
    search: { nodes: candidates.length, depth: 0, hiddenStateSamples: 0, coverage: 0, complete: true },
    diagnostics: [],
  };
}

function exactEvaluation(candidates: readonly ReviewCandidateEvaluationV1[]): ReviewEvaluationV1 {
  return {
    ...heuristicEvaluation(candidates),
    evidence: { source: 'exact', confidence: 'high', displayLabel: 'Exact analysis' },
  };
}

function batchState(overrides: Partial<ReviewBatchState> = {}): ReviewBatchState {
  return {
    resultsByDecisionId: new Map(),
    errorsByDecisionId: new Map(),
    pendingDecisionIds: new Set(),
    done: false,
    ...overrides,
  };
}

describe('selectMoveHeuristicClassification', () => {
  it('returns null when decisionId is null or undefined -- render legacy unchanged', () => {
    const batch = batchState({ resultsByDecisionId: new Map([['d1', heuristicEvaluation([candidate(1, 2, 10)])]]) });
    expect(selectMoveHeuristicClassification(null, batch)).toBeNull();
    expect(selectMoveHeuristicClassification(undefined, batch)).toBeNull();
  });

  it('returns null when the decisionId has no resolved result yet (still pending) -- render legacy unchanged', () => {
    const batch = batchState({ pendingDecisionIds: new Set(['d1']) });
    expect(selectMoveHeuristicClassification('d1', batch)).toBeNull();
  });

  it('returns null when the resolved result is exact/search-sourced, not heuristic -- render legacy unchanged', () => {
    const batch = batchState({
      resultsByDecisionId: new Map([['d1', exactEvaluation([candidate(1, 2, 10)])]]),
    });
    expect(selectMoveHeuristicClassification('d1', batch)).toBeNull();
  });

  it('classifies a resolved heuristic result via classifyHeuristicResult -- a single candidate produces forced', () => {
    const batch = batchState({
      resultsByDecisionId: new Map([['d1', heuristicEvaluation([candidate(1, 2, 10)])]]),
    });
    expect(selectMoveHeuristicClassification('d1', batch)).toEqual({ kind: 'forced' });
  });

  it('classifies a resolved heuristic result with real differentiated candidates into a real bucket', () => {
    const candidates = [candidate(0, 4, 30.53), candidate(3, 6, -15.77), candidate(0, 1, -51.7)];
    const batch = batchState({
      resultsByDecisionId: new Map([
        [
          'd1',
          {
            ...heuristicEvaluation(candidates),
            played: candidates[1],
          },
        ],
      ]),
    });
    // Same real numbers/expected outcome as classifyHeuristicResult's own
    // ambiguous-midgame fixture test -- this test is about the selector's
    // lookup/routing, not re-deriving classification correctness.
    expect(selectMoveHeuristicClassification('d1', batch)).toEqual({ kind: 'bucket', bucket: 'Inaccuracy' });
  });
});
