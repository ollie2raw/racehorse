import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReviewCandidateEvaluationV1, ReviewEvaluationV1 } from '@racehorse/game-core/review';
import type { PlacementPosition } from '@racehorse/game-core/types';
import type { ReviewBatchState } from '../modules/review/useReviewWorkerBatch';
import GameReviewer from './GameReviewer';
import { analyzeMoveLog } from './moveAnalyzer';
import type { AnalyzedMove, GameAnalysis } from './moveAnalyzer';
import type { ReviewCoachingFacts, ReviewCoachingProse } from './reviewCoachingFacts';

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
    playedTile: [2, 4],
    score: 0,
    rating: 'Mistake',
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

const SEARCH: ReviewEvaluationV1['evidence'] = {
  source: 'search',
  confidence: 'medium',
  displayLabel: 'Review Engine search',
};

describe('GameReviewer Gate 4 positional enable prop', () => {
  it('E: defaults fail-closed — local review keeps non-positional same-tile prose', async () => {
    const played = candidate(2, 4, {}, 'right').action;
    const best = candidate(2, 4, { value: { expectedPointDifferential: 1.2, winProbability: null } }, 'left').action;
    const evalOut = evaluation({
      candidates: [
        candidate(2, 4, {}, 'right'),
        candidate(2, 4, { value: { expectedPointDifferential: 1.2, winProbability: null } }, 'left'),
      ],
      playedAction: played,
      bestAction: best,
      evidence: SEARCH,
    });
    render(
      <GameReviewer
        open
        onClose={vi.fn()}
        analysis={analysisWithMoves([analyzedMove()])}
        reviewWorkerBatch={batchState({ resultsByDecisionId: new Map([['d1', evalOut]]) })}
        decisionIdByMoveNumber={new Map([[1, 'd1']])}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/Right tile, wrong end/i)).toBeTruthy();
    });
    expect(screen.queryByText(/matching replies/i)).toBeNull();
  });

  it('F: historical review derives coaching from the canonical evaluation, never stored dual-authority prose', async () => {
    const facts = {
      played: {
        action: { kind: 'play', tile: { low: 0, high: 2 }, position: 'right' },
        immediatePoints: 0,
      },
      best: {
        action: { kind: 'play', tile: { low: 0, high: 2 }, position: 'left' },
        immediatePoints: 0,
      },
      referenceSource: 'fritz',
      missKind: 'same_tile_wrong_end',
      deltas: { immediatePoints: 0, expectedPointDifferential: 0 },
      evidence: { source: 'heuristic', confidence: 'low', displayLabel: 'Heuristic estimate' },
      principalVariation: [],
      agreement: { oracleVsFritz: 'disagree', playedMatch: 'neither', contested: true },
      featureDeltas: [
        { feature: 'opponentOutsLeft', playedValue: 4, referenceValue: 9, delta: 5 },
      ],
    } as ReviewCoachingFacts;
    const prose: ReviewCoachingProse = {
      headline: 'The engines disagree here.',
      detail: 'The measured positional features favor the right end, but Fritz prefers the left end.',
      takeaway: '',
    };
    const evalOut = evaluation({
      candidates: [candidate(0, 2, {}, 'right'), candidate(0, 2, {}, 'left')],
      playedAction: candidate(0, 2, {}, 'right').action,
      bestAction: candidate(0, 2, {}, 'left').action,
      evidence: SEARCH,
    });
    render(
      <GameReviewer
        open
        onClose={vi.fn()}
        analysis={analysisWithMoves([analyzedMove({ playedTile: [0, 2] })])}
        reviewWorkerBatch={batchState({ resultsByDecisionId: new Map([['d1', evalOut]]) })}
        decisionIdByMoveNumber={new Map([[1, 'd1']])}
        historicalCoachingByDecisionId={new Map([['d1', { facts, prose }]])}
        enablePositionalExplanations={false}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText('Right tile, wrong end.')).toBeTruthy();
    });
    expect(screen.queryByText(/engines disagree|Fritz prefers/i)).toBeNull();
  });
});
