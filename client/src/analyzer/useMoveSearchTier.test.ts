import { describe, expect, it } from 'vitest';
import type { ReviewCandidateEvaluationV1, ReviewEvaluationV1 } from '@racehorse/game-core/review';
import type { ReviewBatchState } from '../modules/review/useReviewWorkerBatch';
import { selectMoveSearchTier } from './useMoveSearchTier';

function candidate(low: number, high: number): ReviewCandidateEvaluationV1 {
  return {
    action: { kind: 'play', tile: { low, high }, position: 'left' },
    value: { expectedPointDifferential: 0, winProbability: null },
    immediatePoints: 0,
    principalVariation: [],
  };
}

function evaluationWithEvidence(evidence: ReviewEvaluationV1['evidence']): ReviewEvaluationV1 {
  const candidates = [candidate(1, 2)];
  return {
    evaluationVersion: 1,
    snapshotId: 'x',
    rulesVersion: 1,
    reviewEngineVersion: 'review-engine-v1',
    evidence,
    played: candidates[0],
    best: candidates[0],
    candidates,
    loss: { expectedPointDifferential: 0, winProbability: null },
    search: { nodes: 1, depth: 0, hiddenStateSamples: 0, coverage: 1, complete: true },
    diagnostics: [],
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

describe('selectMoveSearchTier', () => {
  it('returns "search" for a resolved search-sourced result', () => {
    const batch = batchState({
      resultsByDecisionId: new Map([
        ['d1', evaluationWithEvidence({ source: 'search', confidence: 'medium', displayLabel: 'Review Engine search' })],
      ]),
    });
    expect(selectMoveSearchTier('d1', batch)).toBe('search');
  });

  it('returns "search" for a search-sourced result at any confidence level, not just medium', () => {
    const batch = batchState({
      resultsByDecisionId: new Map([
        ['d1', evaluationWithEvidence({ source: 'search', confidence: 'high', displayLabel: 'Review Engine search' })],
        ['d2', evaluationWithEvidence({ source: 'search', confidence: 'low', displayLabel: 'Review Engine search' })],
      ]),
    });
    expect(selectMoveSearchTier('d1', batch)).toBe('search');
    expect(selectMoveSearchTier('d2', batch)).toBe('search');
  });

  it('returns null for a resolved exact/high-confidence result', () => {
    const batch = batchState({
      resultsByDecisionId: new Map([
        ['d1', evaluationWithEvidence({ source: 'exact', confidence: 'high', displayLabel: 'Exact analysis' })],
      ]),
    });
    expect(selectMoveSearchTier('d1', batch)).toBeNull();
  });

  it('returns null for a resolved heuristic result -- that is a separate, unrelated badge path', () => {
    const batch = batchState({
      resultsByDecisionId: new Map([
        ['d1', evaluationWithEvidence({ source: 'heuristic', confidence: 'low', displayLabel: 'Heuristic estimate' })],
      ]),
    });
    expect(selectMoveSearchTier('d1', batch)).toBeNull();
  });

  it('returns null when the decisionId has not resolved yet (still pending)', () => {
    const batch = batchState({ pendingDecisionIds: new Set(['d1']) });
    expect(selectMoveSearchTier('d1', batch)).toBeNull();
  });

  it('returns null when decisionId is null or undefined', () => {
    const batch = batchState({
      resultsByDecisionId: new Map([
        ['d1', evaluationWithEvidence({ source: 'search', confidence: 'medium', displayLabel: 'Review Engine search' })],
      ]),
    });
    expect(selectMoveSearchTier(null, batch)).toBeNull();
    expect(selectMoveSearchTier(undefined, batch)).toBeNull();
  });
});
