import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReviewCandidateEvaluationV1, ReviewEvaluationV1, ReviewPrincipalVariationStep } from '@racehorse/game-core/review';
import type { ReviewBatchState } from '../modules/review/useReviewWorkerBatch';
import GameReviewer from './GameReviewer';
import { analyzeMoveLog } from './moveAnalyzer';
import type { AnalyzedMove, GameAnalysis } from './moveAnalyzer';

function candidate(
  low: number,
  high: number,
  overrides: Partial<ReviewCandidateEvaluationV1> = {},
): ReviewCandidateEvaluationV1 {
  return {
    action: { kind: 'play', tile: { low, high }, position: 'left' },
    value: { expectedPointDifferential: 0, winProbability: null },
    immediatePoints: 0,
    principalVariation: [],
    ...overrides,
  };
}

const EXACT: ReviewEvaluationV1['evidence'] = { source: 'exact', confidence: 'high', displayLabel: 'Exact analysis' };

function evaluation(args: {
  candidates: ReviewCandidateEvaluationV1[];
  playedAction: ReviewCandidateEvaluationV1['action'];
  bestAction?: ReviewCandidateEvaluationV1['action'];
}): ReviewEvaluationV1 {
  const played = args.candidates.find((c) => JSON.stringify(c.action) === JSON.stringify(args.playedAction))!;
  const best = args.bestAction
    ? args.candidates.find((c) => JSON.stringify(c.action) === JSON.stringify(args.bestAction))!
    : args.candidates[0];
  return {
    evaluationVersion: 1,
    snapshotId: 'x',
    rulesVersion: 1,
    reviewEngineVersion: 'review-engine-v1',
    evidence: EXACT,
    played,
    best,
    candidates: args.candidates,
    loss: { expectedPointDifferential: best.value.expectedPointDifferential - played.value.expectedPointDifferential, winProbability: null },
    search: { nodes: args.candidates.length, depth: 0, hiddenStateSamples: 0, coverage: 1, complete: true },
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
  return { ...analyzeMoveLog([]), analyzedMoves: moves, hands: [] };
}

function renderReviewer(evalOut: ReviewEvaluationV1) {
  const analysis = analysisWithMoves([analyzedMove({ moveNumber: 1, rating: 'Inaccuracy' })]);
  const reviewWorkerBatch = batchState({ resultsByDecisionId: new Map([['d1', evalOut]]) });
  const decisionIdByMoveNumber = new Map([[1, 'd1']]);
  return render(
    <GameReviewer
      open
      onClose={vi.fn()}
      analysis={analysis}
      reviewWorkerBatch={reviewWorkerBatch}
      decisionIdByMoveNumber={decisionIdByMoveNumber}
    />,
  );
}

describe('GameReviewer D3 principal-variation panel -- the honest empty-PV state', () => {
  it("shows the explicit 'no continuation recorded' message and a disabled toggle for a real, resolved move with empty PV (today's actual production reality on every tier)", () => {
    const action = candidate(0, 1).action;
    const evalOut = evaluation({ candidates: [candidate(0, 1), candidate(5, 6)], playedAction: action, bestAction: candidate(5, 6).action });
    renderReviewer(evalOut);

    expect(screen.getByText('Principal variation')).toBeInTheDocument();
    expect(screen.getByText('No continuation recorded for this move.')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Best' })).toBeDisabled();
    expect(screen.getByRole('tab', { name: 'Played' })).toBeDisabled();
    expect(document.body.querySelector('.gr-pv-board')).toBeNull();
  });

  it('does not render the PV panel at all when no move is selected', () => {
    const analysis = analysisWithMoves([]);
    render(<GameReviewer open onClose={vi.fn()} analysis={analysis} />);
    expect(screen.queryByText('Principal variation')).not.toBeInTheDocument();
  });
});

describe('GameReviewer D3 principal-variation panel -- synthetic non-empty fixture, stepping mechanics', () => {
  function pvStep(actor: ReviewPrincipalVariationStep['actor'], low: number, high: number, position = 'left'): ReviewPrincipalVariationStep {
    return { actor, action: { kind: 'play', tile: { low, high }, position: position as never }, immediatePoints: 0 };
  }

  it('enables the toggle and renders a working stepper when the best line has real PV steps', () => {
    const bestPv: ReviewPrincipalVariationStep[] = [pvStep('reviewed-player', 3, 4), pvStep('opponent', 4, 5, 'right')];
    const played = candidate(0, 1, { principalVariation: [] });
    const best = candidate(5, 6, { principalVariation: bestPv });
    const evalOut = evaluation({ candidates: [played, best], playedAction: played.action, bestAction: best.action });
    renderReviewer(evalOut);

    expect(screen.getByRole('tab', { name: 'Best' })).not.toBeDisabled();
    expect(screen.getByRole('tab', { name: 'Played' })).not.toBeDisabled();
    expect(document.body.querySelector('.gr-pv-board')).not.toBeNull();
    expect(screen.getByText(/Step 0 \/ 2/)).toBeInTheDocument();
    expect(screen.getByText(/Pre-move position/)).toBeInTheDocument();
  });

  it('steps forward through the line and updates the step label with real step data', () => {
    const bestPv: ReviewPrincipalVariationStep[] = [pvStep('reviewed-player', 3, 4), pvStep('opponent', 4, 5, 'right')];
    const played = candidate(0, 1, { principalVariation: [] });
    const best = candidate(5, 6, { principalVariation: bestPv });
    const evalOut = evaluation({ candidates: [played, best], playedAction: played.action, bestAction: best.action });
    renderReviewer(evalOut);

    fireEvent.click(screen.getByLabelText('Next principal variation step'));
    expect(screen.getByText(/Step 1 \/ 2/)).toBeInTheDocument();
    expect(screen.getByText(/You play 3-4 at left/)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Next principal variation step'));
    expect(screen.getByText(/Step 2 \/ 2/)).toBeInTheDocument();
    expect(screen.getByText(/Fritz play 4-5 at right/)).toBeInTheDocument();

    expect(screen.getByLabelText('Next principal variation step')).toBeDisabled();
  });

  it('toggling from best to played resets to the pre-move step and shows the played line', () => {
    const bestPv: ReviewPrincipalVariationStep[] = [pvStep('reviewed-player', 3, 4)];
    const playedPv: ReviewPrincipalVariationStep[] = [pvStep('reviewed-player', 0, 1), pvStep('opponent', 1, 1, 'right')];
    const played = candidate(0, 1, { principalVariation: playedPv });
    const best = candidate(5, 6, { principalVariation: bestPv });
    const evalOut = evaluation({ candidates: [played, best], playedAction: played.action, bestAction: best.action });
    renderReviewer(evalOut);

    // Step forward on the default 'best' line first.
    fireEvent.click(screen.getByLabelText('Next principal variation step'));
    expect(screen.getByText(/Step 1 \/ 1/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Played' }));
    expect(screen.getByText(/Step 0 \/ 2/)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Played' })).toHaveAttribute('aria-selected', 'true');
  });
});
