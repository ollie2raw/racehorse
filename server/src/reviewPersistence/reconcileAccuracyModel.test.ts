import { describe, expect, it } from 'vitest';
import type { ReviewEvaluationV1, ReviewCandidateEvaluationV1 } from '@racehorse/game-core/review';
import type { GameAccuracyModelResult } from '@racehorse/review-engine';
import { computeGameAccuracyModel } from '@racehorse/review-engine';
import { reconcileAccuracyModelResult } from './reconcileAccuracyModel';

const EXACT: ReviewEvaluationV1['evidence'] = {
  source: 'exact',
  confidence: 'high',
  displayLabel: 'Exact analysis',
};

function candidate(
  tileLow: number,
  tileHigh: number,
  expectedPointDifferential = 0,
): ReviewCandidateEvaluationV1 {
  return {
    action: { kind: 'play', tile: { low: tileLow, high: tileHigh }, position: 'left' },
    value: { expectedPointDifferential, winProbability: null },
    immediatePoints: 0,
    principalVariation: [],
  };
}

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

const REAL_EVALUATIONS = [decision(0), decision(0.5), decision(1)];

function realAccuracyModelResult(): GameAccuracyModelResult {
  return computeGameAccuracyModel(REAL_EVALUATIONS);
}

describe('reconcileAccuracyModelResult', () => {
  it('E2: finds zero mismatches when the client-asserted result matches the server-derived one exactly', () => {
    const clientAsserted = realAccuracyModelResult();
    const { mismatches, serverDerived } = reconcileAccuracyModelResult(
      REAL_EVALUATIONS,
      clientAsserted,
    );
    expect(mismatches).toEqual([]);
    expect(serverDerived).toEqual(clientAsserted);
  });

  it('E2: finds a mismatch on a single differing field (accuracy)', () => {
    const serverTruth = realAccuracyModelResult();
    const clientAsserted: GameAccuracyModelResult = {
      ...serverTruth,
      accuracy: (serverTruth.accuracy ?? 0) + 5,
    };
    const { mismatches } = reconcileAccuracyModelResult(REAL_EVALUATIONS, clientAsserted);
    expect(mismatches).toEqual([
      {
        field: 'accuracy',
        clientAsserted: clientAsserted.accuracy,
        serverDerived: serverTruth.accuracy,
      },
    ]);
  });

  it('E2: finds every differing field, not just the first', () => {
    const serverTruth = realAccuracyModelResult();
    const clientAsserted: GameAccuracyModelResult = {
      ...serverTruth,
      accuracy: (serverTruth.accuracy ?? 0) + 5,
      grade: serverTruth.grade === 'S' ? 'A' : 'S',
    };
    const { mismatches } = reconcileAccuracyModelResult(REAL_EVALUATIONS, clientAsserted);
    const fields = mismatches.map((m) => m.field).sort();
    expect(fields).toEqual(['accuracy', 'grade']);
  });

  it('E2: a client-asserted accuracyModelVersion drift is caught like any other field', () => {
    const serverTruth = realAccuracyModelResult();
    const clientAsserted: GameAccuracyModelResult = {
      ...serverTruth,
      accuracyModelVersion: 'stale-version',
    };
    const { mismatches } = reconcileAccuracyModelResult(REAL_EVALUATIONS, clientAsserted);
    expect(mismatches).toEqual([
      {
        field: 'accuracyModelVersion',
        clientAsserted: 'stale-version',
        serverDerived: serverTruth.accuracyModelVersion,
      },
    ]);
  });

  it('E2: malformed evaluations never throw -- returns a reconciliationError instead, no mismatches fabricated', () => {
    const malformed = [{ not: 'a real evaluation' }] as unknown as readonly ReviewEvaluationV1[];
    const clientAsserted = realAccuracyModelResult();
    const result = reconcileAccuracyModelResult(malformed, clientAsserted);
    expect(result.mismatches).toEqual([]);
    expect(result.reconciliationError).toBeDefined();
  });
});
