import type { ReviewEvaluationV1 } from '@racehorse/game-core/review';
import type { AnalyzedMove, GameAnalysis } from '../../analyzer/moveAnalyzer';
import type { MoveEntry } from '../../game/moveLogger';

export function evaluation(moveNumber: number, loss: number): ReviewEvaluationV1 {
  const played = { action: { kind: 'play', tile: { low: 0, high: 1 }, position: 'left' }, value: { expectedPointDifferential: 0, winProbability: null }, immediatePoints: 2, principalVariation: [] } as const;
  const best = { action: { kind: 'play', tile: { low: 5, high: 6 }, position: 'right' }, value: { expectedPointDifferential: loss, winProbability: null }, immediatePoints: 5, principalVariation: [] } as const;
  return {
    evaluationVersion: 1, snapshotId: `decision-${moveNumber}`, rulesVersion: 1,
    reviewEngineVersion: 'review-engine-v1',
    evidence: { source: 'exact', confidence: 'high', displayLabel: 'Exact analysis' },
    played, best, candidates: [played, best],
    loss: { expectedPointDifferential: loss, winProbability: null },
    search: { nodes: 2, depth: 1, hiddenStateSamples: 0, coverage: 1, complete: true },
    diagnostics: [],
  };
}

export function matchFixture(losses: number[]) {
  const moveLog = losses.map((_, index) => ({
    moveNumber: index + 1, player: 'you', action: 'play', pointsScored: 0,
    boardState: [], validMoves: [],
  } as unknown as MoveEntry));
  const analyzedMoves = losses.map((_, index) => ({
    moveNumber: index + 1, rating: index === 0 ? 'Blunder' : 'Brilliant', score: 100,
    action: 'play', playedTile: [1, 1], bestTile: [6, 6], bestPosition: 'left',
    boardEnds: [1, 6], handSnapshot: [], validMoves: [],
  } as unknown as AnalyzedMove));
  const analysis: GameAnalysis = {
    accuracy: 77, grade: 'B', analyzedAt: 1, analyzedMoves, timeline: [], hands: [],
    oracleMode: 'tier', tierPlayed: 'standard', oracleLabel: 'Fritz',
    worstHandNumber: null, consequenceByMoveNumber: {},
  };
  const evaluationsByDecisionId = new Map(losses.map((loss, index) => [`decision-${index + 1}`, evaluation(index + 1, loss)]));
  const decisionIdByMoveNumber = new Map(losses.map((_, index) => [index + 1, `decision-${index + 1}`]));
  return { analysis, moveLog, evaluationsByDecisionId, decisionIdByMoveNumber };
}
