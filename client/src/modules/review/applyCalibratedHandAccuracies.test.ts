import { describe, expect, it } from 'vitest';
import { applyCalibratedHandAccuracies, calibratedHandAccuracy } from './applyCalibratedHandAccuracies';
import type { AnalyzedMove, GameAnalysis } from '../../analyzer/moveAnalyzer';
import { LEGACY_ANALYSIS_DISCLOSURE } from '../../analyzer/moveAnalyzer';
import type { ReviewCandidateEvaluationV1, ReviewEvaluationV1 } from '@racehorse/game-core/review';
import { computeGameAccuracyModel } from '@racehorse/review-engine';

function candidate(tileLow: number, tileHigh: number, expectedPointDifferential = 0): ReviewCandidateEvaluationV1 {
  return {
    action: { kind: 'play', tile: { low: tileLow, high: tileHigh }, position: 'left' },
    value: { expectedPointDifferential, winProbability: null },
    immediatePoints: 0,
    principalVariation: [],
  };
}

function searchEval(loss: number): ReviewEvaluationV1 {
  const played = candidate(1, 5, -loss);
  const best = candidate(3, 4, 0);
  return {
    evaluationVersion: 1,
    snapshotId: 'x',
    rulesVersion: 1,
    reviewEngineVersion: 'review-engine-v1',
    evidence: { source: 'search', confidence: 'medium', displayLabel: 'Review Engine search' },
    played,
    best,
    candidates: [best, played],
    loss: { expectedPointDifferential: loss, winProbability: null },
    search: { nodes: 10, depth: 2, hiddenStateSamples: 100, coverage: 0.05, complete: true },
    diagnostics: [],
  };
}

function stubMove(moveNumber: number): AnalyzedMove {
  return {
    moveNumber,
    action: 'place',
    playedTile: [1, 2],
    score: 73,
    rating: 'Good',
    explanation: '',
    handBefore: [],
    validMoves: [],
    boardEnds: [0, 0],
    boardState: [],
    boardRenderState: null,
    boardRenderStateAfterMove: null,
    handSnapshot: [],
    engineBestMove: null,
  };
}

function stubAnalysis(handMoveNumbers: number[]): GameAnalysis {
  const analyzedMoves = handMoveNumbers.map(stubMove);
  return {
    accuracy: 73,
    grade: 'C',
    analyzedAt: 0,
    analyzedMoves,
    timeline: [],
    hands: [
      {
        handNumber: 1,
        startingScores: { you: 0, opponent: 0 },
        endingScores: { you: 0, opponent: 0 },
        analyzedMoves,
        handAccuracy: 73,
        pivotalMoments: [],
        verdict: { winner: 'tie', pointsYou: 0, pointsOpponent: 0, margin: 0 },
        consequenceChains: [],
      },
    ],
    oracleMode: 'master',
    tierPlayed: 'master',
    oracleLabel: 'Fritz Master',
    worstHandNumber: 1,
    consequenceByMoveNumber: {},
    evidence: LEGACY_ANALYSIS_DISCLOSURE,
  };
}

describe('applyCalibratedHandAccuracies', () => {
  it('replaces legacy ~73% handAccuracy with calibrated model over SEARCH BEST moves', () => {
    const moveNumbers = [1, 2, 3, 4, 5, 6, 7];
    const analysis = stubAnalysis(moveNumbers);
    const results = new Map<string, ReviewEvaluationV1>();
    const decisionIdByMoveNumber = new Map<number, string>();
    for (const n of moveNumbers) {
      const id = `d${n}`;
      decisionIdByMoveNumber.set(n, id);
      results.set(id, { ...searchEval(0), snapshotId: id });
    }

    const next = applyCalibratedHandAccuracies(analysis, {
      decisionIdByMoveNumber,
      resultsByDecisionId: results,
    });

    expect(next.hands[0].handAccuracy).not.toBe(73);
    expect(next.hands[0].handAccuracy).toBe(calibratedHandAccuracy([...results.values()]));
    expect(next.hands[0].handAccuracy).toBe(computeGameAccuracyModel([...results.values()]).accuracy);
    expect(next.hands[0].handAccuracy!).toBeGreaterThan(99);
  });
});
