import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReviewCandidateEvaluationV1, ReviewEvaluationV1 } from '@racehorse/game-core/review';
import type { ReviewBatchState } from '../modules/review/useReviewWorkerBatch';
import GameReviewer from './GameReviewer';
import { analyzeMoveLog } from './moveAnalyzer';
import type { AnalyzedMove, GameAnalysis } from './moveAnalyzer';

function candidate(low: number, high: number, rawScore?: number): ReviewCandidateEvaluationV1 {
  return {
    action: { kind: 'play', tile: { low, high }, position: 'left' },
    value: { expectedPointDifferential: 0, winProbability: null },
    immediatePoints: 0,
    principalVariation: [],
    rawScore,
  };
}

function evaluationWithEvidence(
  evidence: ReviewEvaluationV1['evidence'],
  expectedPointDifferential = 0,
): ReviewEvaluationV1 {
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
    loss: { expectedPointDifferential, winProbability: null },
    search: { nodes: 1, depth: 0, hiddenStateSamples: 0, coverage: 1, complete: true },
    diagnostics: [],
  };
}

function heuristicEvaluation(candidates: readonly ReviewCandidateEvaluationV1[]): ReviewEvaluationV1 {
  return {
    ...evaluationWithEvidence({ source: 'heuristic', confidence: 'low', displayLabel: 'Heuristic estimate' }),
    played: candidates[0],
    best: candidates[0],
    candidates,
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

function analyzedMove(overrides: Partial<AnalyzedMove> = {}): AnalyzedMove {
  return {
    moveNumber: 1,
    action: 'place',
    playedTile: [3, 4],
    score: 10,
    rating: 'Inaccuracy',
    explanation: 'test move',
    handBefore: [],
    validMoves: [],
    boardEnds: [0, 0],
    boardState: [],
    boardRenderState: null,
    boardRenderStateAfterMove: null,
    handSnapshot: [],
    engineBestMove: null,
    ...overrides,
  };
}

function analysisWithMoves(moves: AnalyzedMove[]): GameAnalysis {
  return {
    ...analyzeMoveLog([]),
    analyzedMoves: moves,
    hands: [],
  };
}

describe('GameReviewer coaching-copy render wiring', () => {
  it('renders coaching copy citing the real score gap for a resolved exact-source move', () => {
    const analysis = analysisWithMoves([analyzedMove({ moveNumber: 1, rating: 'Inaccuracy' })]);
    const reviewWorkerBatch = batchState({
      resultsByDecisionId: new Map([
        ['d1', evaluationWithEvidence({ source: 'exact', confidence: 'high', displayLabel: 'Exact analysis' }, 3)],
      ]),
    });
    const decisionIdByMoveNumber = new Map([[1, 'd1']]);

    render(
      <GameReviewer
        open
        onClose={vi.fn()}
        analysis={analysis}
        reviewWorkerBatch={reviewWorkerBatch}
        decisionIdByMoveNumber={decisionIdByMoveNumber}
      />,
    );

    expect(screen.getByText(/Why this rating/i)).toBeInTheDocument();
    expect(screen.getByText(/3 points behind the best option/i)).toBeInTheDocument();
  });

  it('renders qualitative, number-free coaching copy for a resolved heuristic-tier move', () => {
    const analysis = analysisWithMoves([analyzedMove({ moveNumber: 1, rating: 'Blunder' })]);
    // played (candidates[0]) is the worst-scoring candidate -> heuristic Blunder bucket.
    const candidates = [candidate(3, 6, -51.7), candidate(0, 4, 30.53), candidate(0, 1, -15.77)];
    const reviewWorkerBatch = batchState({
      resultsByDecisionId: new Map([['d1', heuristicEvaluation(candidates)]]),
    });
    const decisionIdByMoveNumber = new Map([[1, 'd1']]);

    render(
      <GameReviewer
        open
        onClose={vi.fn()}
        analysis={analysis}
        reviewWorkerBatch={reviewWorkerBatch}
        decisionIdByMoveNumber={decisionIdByMoveNumber}
      />,
    );

    const copyEl = screen.getByText(/weakest option among the choices available/i);
    expect(copyEl).toBeInTheDocument();
    expect(copyEl.textContent).not.toMatch(/\d/);
  });

  it('renders no coaching copy for a forced (single-legal-tile) move', () => {
    const analysis = analysisWithMoves([analyzedMove({ moveNumber: 1, rating: 'Good' })]);
    const reviewWorkerBatch = batchState({
      resultsByDecisionId: new Map([['d1', heuristicEvaluation([candidate(1, 2, 10)])]]),
    });
    const decisionIdByMoveNumber = new Map([[1, 'd1']]);

    render(
      <GameReviewer
        open
        onClose={vi.fn()}
        analysis={analysis}
        reviewWorkerBatch={reviewWorkerBatch}
        decisionIdByMoveNumber={decisionIdByMoveNumber}
      />,
    );

    expect(screen.queryByText(/Why this rating/i)).not.toBeInTheDocument();
  });

  it('renders no coaching copy for an unclear result', () => {
    const analysis = analysisWithMoves([analyzedMove({ moveNumber: 1, rating: 'Blunder' })]);
    const flatCandidates = [candidate(0, 4, 10), candidate(3, 6, 8), candidate(0, 1, 6)];
    const reviewWorkerBatch = batchState({
      resultsByDecisionId: new Map([['d1', heuristicEvaluation(flatCandidates)]]),
    });
    const decisionIdByMoveNumber = new Map([[1, 'd1']]);

    render(
      <GameReviewer
        open
        onClose={vi.fn()}
        analysis={analysis}
        reviewWorkerBatch={reviewWorkerBatch}
        decisionIdByMoveNumber={decisionIdByMoveNumber}
      />,
    );

    expect(screen.queryByText(/Why this rating/i)).not.toBeInTheDocument();
  });

  it('does not disturb the existing legacy rating/badge rendering from #234/#235', () => {
    const analysis = analysisWithMoves([analyzedMove({ moveNumber: 1, rating: 'Inaccuracy' })]);
    const reviewWorkerBatch = batchState({
      resultsByDecisionId: new Map([
        ['d1', evaluationWithEvidence({ source: 'search', confidence: 'medium', displayLabel: 'Review Engine search' }, 1.2)],
      ]),
    });
    const decisionIdByMoveNumber = new Map([[1, 'd1']]);

    render(
      <GameReviewer
        open
        onClose={vi.fn()}
        analysis={analysis}
        reviewWorkerBatch={reviewWorkerBatch}
        decisionIdByMoveNumber={decisionIdByMoveNumber}
      />,
    );

    const ratingEl = screen.getByText('Inaccuracy', { selector: '.gr-move-row-rating' });
    expect(ratingEl).toHaveClass('is-inaccuracy');
    expect(screen.getByText('Search')).toBeInTheDocument();
    expect(screen.getByText('Search')).toHaveClass('gr-move-row-badge', 'is-search');
    expect(screen.getByText(/Why this rating/i)).toBeInTheDocument();
  });
});
