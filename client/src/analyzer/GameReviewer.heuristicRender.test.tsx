import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReviewCandidateEvaluationV1, ReviewEvaluationV1 } from '@racehorse/game-core/review';
import type { ReviewBatchState } from '../modules/review/useReviewWorkerBatch';
import GameReviewer from './GameReviewer';
import { analyzeMoveLog } from './moveAnalyzer';
import type { AnalyzedMove, GameAnalysis } from './moveAnalyzer';

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
    rating: 'Blunder',
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

describe('GameReviewer heuristic-classification render wiring', () => {
  it('renders the adapted heuristic label and badge when a move has a resolved heuristic classification', () => {
    const analysis = analysisWithMoves([analyzedMove({ moveNumber: 1, rating: 'Blunder' })]);
    // played (candidates[0]) is the worst-scoring candidate, so this
    // classifies as a heuristic Blunder -- matches the move's legacy
    // 'Blunder' rating so the badge is the only thing distinguishing it.
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
  });

  it('renders identically to legacy behavior for a move with no resolved data (pending batch)', () => {
    // GameReviewer renders through GameOverlayPortal (createPortal to
    // document.body), so RTL's own `container` -- a sibling div, not an
    // ancestor of the portaled content -- never contains it; querying it
    // directly would make these assertions pass vacuously (null === null)
    // regardless of what actually rendered. Unmounting between renders and
    // querying document.body instead makes this a real comparison.
    const analysis = analysisWithMoves([analyzedMove({ moveNumber: 1, rating: 'Blunder' })]);
    const reviewWorkerBatch = batchState({ pendingDecisionIds: new Set(['d1']) });
    const decisionIdByMoveNumber = new Map([[1, 'd1']]);

    const withBatchRender = render(
      <GameReviewer
        open
        onClose={vi.fn()}
        analysis={analysis}
        reviewWorkerBatch={reviewWorkerBatch}
        decisionIdByMoveNumber={decisionIdByMoveNumber}
      />,
    );
    const withBatchHtml = document.body.querySelector('.gr-move-row')?.outerHTML;
    expect(withBatchHtml).toContain('Blunder');
    withBatchRender.unmount();

    const legacyRender = render(<GameReviewer open onClose={vi.fn()} analysis={analysis} />);
    const legacyHtml = document.body.querySelector('.gr-move-row')?.outerHTML;
    legacyRender.unmount();

    expect(withBatchHtml).toEqual(legacyHtml);
  });

  it('renders identically to legacy behavior for a resolved exact/search-source result', () => {
    const analysis = analysisWithMoves([analyzedMove({ moveNumber: 1, rating: 'Blunder' })]);
    const candidates = [candidate(0, 4, 30.53), candidate(3, 6, -15.77)];
    const exactResult: ReviewEvaluationV1 = {
      ...heuristicEvaluation(candidates),
      evidence: { source: 'exact', confidence: 'high', displayLabel: 'Exact analysis' },
    };
    const reviewWorkerBatch = batchState({
      resultsByDecisionId: new Map([['d1', exactResult]]),
    });
    const decisionIdByMoveNumber = new Map([[1, 'd1']]);

    const withBatchRender = render(
      <GameReviewer
        open
        onClose={vi.fn()}
        analysis={analysis}
        reviewWorkerBatch={reviewWorkerBatch}
        decisionIdByMoveNumber={decisionIdByMoveNumber}
      />,
    );
    const withBatchHtml = document.body.querySelector('.gr-move-row')?.outerHTML;
    expect(withBatchHtml).toContain('Blunder');
    withBatchRender.unmount();

    const legacyRender = render(<GameReviewer open onClose={vi.fn()} analysis={analysis} />);
    const legacyHtml = document.body.querySelector('.gr-move-row')?.outerHTML;
    legacyRender.unmount();

    expect(withBatchHtml).toEqual(legacyHtml);
  });
});
