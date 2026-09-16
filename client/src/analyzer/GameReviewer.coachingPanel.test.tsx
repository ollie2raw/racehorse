import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReviewCandidateEvaluationV1, ReviewEvaluationV1 } from '@racehorse/game-core/review';
import type { PlacementPosition } from '@racehorse/game-core/types';
import type { ReviewBatchState } from '../modules/review/useReviewWorkerBatch';
import GameReviewer from './GameReviewer';
import { analyzeMoveLog } from './moveAnalyzer';
import type { AnalyzedMove, GameAnalysis } from './moveAnalyzer';

function candidate(
  low: number,
  high: number,
  overrides: Partial<ReviewCandidateEvaluationV1> = {},
  position: PlacementPosition = 'left',
): ReviewCandidateEvaluationV1 {
  return {
    action: { kind: 'play', tile: { low, high }, position },
    value: { expectedPointDifferential: 0, winProbability: null },
    immediatePoints: 0,
    principalVariation: [],
    ...overrides,
  };
}

function evaluation(args: {
  candidates: readonly ReviewCandidateEvaluationV1[];
  playedAction: ReviewCandidateEvaluationV1['action'];
  bestAction?: ReviewCandidateEvaluationV1['action'];
  evidence: ReviewEvaluationV1['evidence'];
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
    evidence: args.evidence,
    played,
    best,
    candidates: args.candidates,
    loss: {
      expectedPointDifferential: best.value.expectedPointDifferential - played.value.expectedPointDifferential,
      winProbability: null,
    },
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
  return {
    ...analyzeMoveLog([]),
    analyzedMoves: moves,
    hands: [],
  };
}

const EXACT: ReviewEvaluationV1['evidence'] = { source: 'exact', confidence: 'high', displayLabel: 'Exact analysis' };

function renderReviewer(evalOut: ReviewEvaluationV1 | null, batchOverrides: Partial<ReviewBatchState> = {}) {
  const analysis = analysisWithMoves([analyzedMove({ moveNumber: 1, rating: 'Inaccuracy' })]);
  const reviewWorkerBatch = batchState({
    resultsByDecisionId: evalOut ? new Map([['d1', evalOut]]) : new Map(),
    ...batchOverrides,
  });
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

describe('GameReviewer D2 coaching panel -- resolved prose per missKind', () => {
  it('correct: renders real prose, not blank', () => {
    const action = candidate(5, 6, { immediatePoints: 15 }).action;
    const evalOut = evaluation({
      candidates: [candidate(5, 6, { immediatePoints: 15 }), candidate(0, 1, { value: { expectedPointDifferential: -2, winProbability: null } })],
      playedAction: action,
      bestAction: action,
      evidence: EXACT,
    });
    renderReviewer(evalOut);
    expect(screen.getByText('What happened')).toBeInTheDocument();
    expect(document.body.querySelector('.gr-advice-headline')?.textContent).toContain('5-6');
  });

  it('forced: renders real, non-blank, non-corrective prose', () => {
    const action = candidate(4, 5).action;
    const evalOut = evaluation({ candidates: [candidate(4, 5)], playedAction: action, evidence: EXACT });
    renderReviewer(evalOut);
    const headline = document.body.querySelector('.gr-advice-headline')?.textContent ?? '';
    expect(headline.length).toBeGreaterThan(0);
    expect(headline.toLowerCase()).toMatch(/only legal/);
  });

  it('same_tile_wrong_end: renders real prose framed around the end, not the tile', () => {
    const played = candidate(2, 2, {}, 'right').action;
    const best = candidate(2, 2, { value: { expectedPointDifferential: 5, winProbability: null } }, 'left').action;
    const evalOut = evaluation({
      candidates: [
        candidate(2, 2, {}, 'right'),
        candidate(2, 2, { value: { expectedPointDifferential: 5, winProbability: null } }, 'left'),
        candidate(5, 6, { value: { expectedPointDifferential: -3, winProbability: null } }),
      ],
      playedAction: played,
      bestAction: best,
      evidence: EXACT,
    });
    renderReviewer(evalOut);
    const headline = document.body.querySelector('.gr-advice-headline')?.textContent ?? '';
    expect(headline).toContain('2-2');
    expect(headline.toLowerCase()).not.toMatch(/should have played/);
  });

  it('missed_score: renders real prose citing the point gap', () => {
    const played = candidate(0, 1, { immediatePoints: 0 }).action;
    const best = candidate(5, 6, { immediatePoints: 20, value: { expectedPointDifferential: 20, winProbability: null } }).action;
    const evalOut = evaluation({
      candidates: [candidate(0, 1, { immediatePoints: 0 }), candidate(5, 6, { immediatePoints: 20, value: { expectedPointDifferential: 20, winProbability: null } })],
      playedAction: played,
      bestAction: best,
      evidence: EXACT,
    });
    renderReviewer(evalOut);
    const headline = document.body.querySelector('.gr-advice-headline')?.textContent ?? '';
    expect(headline).toMatch(/20/);
  });

  it('unknown: renders real, non-blank, uncertainty-honest prose', () => {
    const played = candidate(0, 4, { rawScore: -15.77 }).action;
    const best = candidate(3, 6, { rawScore: 30.53 }).action;
    const evalOut = evaluation({
      candidates: [candidate(0, 4, { rawScore: -15.77 }), candidate(3, 6, { rawScore: 30.53 })],
      playedAction: played,
      bestAction: best,
      evidence: { source: 'heuristic', confidence: 'low', displayLabel: 'Heuristic estimate' },
    });
    renderReviewer(evalOut);
    const headline = document.body.querySelector('.gr-advice-headline')?.textContent ?? '';
    expect(headline.length).toBeGreaterThan(0);
    expect(headline.toLowerCase()).toMatch(/too early/);
  });
});

describe('GameReviewer D2 coaching panel -- unresolved states, never a fabricated placeholder', () => {
  it('pending: shows an explicit analyzing message, not blank or a fabricated result', () => {
    renderReviewer(null, { pendingDecisionIds: new Set(['d1']) });
    expect(screen.getByText(/Analyzing this move/i)).toBeInTheDocument();
    expect(document.body.querySelector('.gr-advice-headline')).toBeNull();
  });

  it('error: shows an explicit could-not-analyze message', () => {
    renderReviewer(null, { errorsByDecisionId: new Map([['d1', 'solver timeout']]) });
    expect(screen.getByText(/couldn't be analyzed/i)).toBeInTheDocument();
  });

  it('unavailable: no reviewWorkerBatch/decisionId at all shows an explicit not-available message', () => {
    const analysis = analysisWithMoves([analyzedMove({ moveNumber: 1, rating: 'Inaccuracy' })]);
    render(<GameReviewer open onClose={vi.fn()} analysis={analysis} />);
    expect(screen.getByText(/Review data not available for this move/i)).toBeInTheDocument();
  });

  it('unavailable: batch done, but this decision never resolved (no pending, no error, no result)', () => {
    renderReviewer(null, { done: true });
    expect(screen.getByText(/Review data not available for this move/i)).toBeInTheDocument();
  });

  it('no move selected shows the pre-existing "select a move" message unchanged', () => {
    const analysis = analysisWithMoves([]);
    render(<GameReviewer open onClose={vi.fn()} analysis={analysis} />);
    expect(screen.getByText('Select a move to review.')).toBeInTheDocument();
  });
});

describe('GameReviewer D2 coaching panel -- legacy paths are fully gone, no fallback remaining', () => {
  it('never renders the legacy "select a blunder or mistake" muted message for a real move', () => {
    const evalOut = evaluation({ candidates: [candidate(4, 5)], playedAction: candidate(4, 5).action, evidence: EXACT });
    renderReviewer(evalOut);
    expect(screen.queryByText(/Select a blunder or mistake/i)).not.toBeInTheDocument();
  });

  it('never renders the legacy .gr-coaching-praise or .gr-advice-consequence classes for any resolved case', () => {
    const action = candidate(5, 6, { immediatePoints: 15 }).action;
    const evalOut = evaluation({
      candidates: [candidate(5, 6, { immediatePoints: 15 })],
      playedAction: action,
      bestAction: action,
      evidence: EXACT,
    });
    renderReviewer(evalOut);
    expect(document.body.querySelector('.gr-coaching-praise')).toBeNull();
    expect(document.body.querySelector('.gr-advice-consequence')).toBeNull();
  });
});
