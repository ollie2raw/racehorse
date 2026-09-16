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

describe('GameReviewer search-tier badge render wiring', () => {
  it('renders the legacy label/class unchanged plus a search badge for a resolved search-tier result', () => {
    const analysis = analysisWithMoves([analyzedMove({ moveNumber: 1, rating: 'Inaccuracy' })]);
    const reviewWorkerBatch = batchState({
      resultsByDecisionId: new Map([
        ['d1', evaluationWithEvidence({ source: 'search', confidence: 'medium', displayLabel: 'Review Engine search' })],
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
  });

  it("legacy label/class strings are byte-identical to pre-badge output for a search-tier move", () => {
    // GameReviewer renders through GameOverlayPortal (createPortal to
    // document.body), so RTL's own `container` -- a sibling div, not an
    // ancestor of the portaled content -- never contains it. Assertions
    // here query `document.body` directly so they actually inspect the
    // rendered DOM rather than passing vacuously against an empty container.
    const analysis = analysisWithMoves([analyzedMove({ moveNumber: 1, rating: 'Inaccuracy' })]);
    const reviewWorkerBatch = batchState({
      resultsByDecisionId: new Map([
        ['d1', evaluationWithEvidence({ source: 'search', confidence: 'high', displayLabel: 'Review Engine search' })],
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

    const legacyRatingEl = document.body.querySelector('.gr-move-row-rating');
    expect(legacyRatingEl?.textContent).toBe('Inaccuracy');
    expect(legacyRatingEl?.className).toBe('gr-move-row-rating is-inaccuracy');
    expect(document.body.querySelector('.gr-move-row')?.className).toBe('gr-move-row is-inaccuracy is-active');
  });

  it('renders no badge for a resolved exact/high-confidence result (legacy unchanged)', () => {
    const analysis = analysisWithMoves([analyzedMove({ moveNumber: 1, rating: 'Inaccuracy' })]);
    const reviewWorkerBatch = batchState({
      resultsByDecisionId: new Map([
        ['d1', evaluationWithEvidence({ source: 'exact', confidence: 'high', displayLabel: 'Exact analysis' })],
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

    expect(document.body.querySelector('.gr-move-row-badge')).toBeNull();
  });

  it('renders no badge for a pending/unresolved decision (legacy unchanged)', () => {
    const analysis = analysisWithMoves([analyzedMove({ moveNumber: 1, rating: 'Inaccuracy' })]);
    const reviewWorkerBatch = batchState({ pendingDecisionIds: new Set(['d1']) });
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

    expect(document.body.querySelector('.gr-move-row-badge')).toBeNull();
  });

  it('does not interfere with the existing heuristic badge path -- a heuristic-tier move renders exactly as before', () => {
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

    const ratingEl = screen.getByText('Blunder', { selector: '.gr-move-row-rating' });
    expect(ratingEl).toHaveClass('is-blunder');
    expect(screen.getByText('Est.')).toBeInTheDocument();
    expect(screen.getByText('Est.')).toHaveClass('gr-move-row-badge', 'is-heuristic');
    expect(screen.queryByText('Search')).not.toBeInTheDocument();
  });
});
