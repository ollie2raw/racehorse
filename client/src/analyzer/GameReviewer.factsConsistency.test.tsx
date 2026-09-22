import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type {
  ReviewAction,
  ReviewCandidateEvaluationV1,
  ReviewEvaluationV1,
  ReviewPositionSnapshotV2,
} from '@racehorse/game-core/review';
import type { PlacementPosition } from '@racehorse/game-core/types';
import type { ReviewBatchState } from '../modules/review/useReviewWorkerBatch';
import { createReviewCoachingFactsStore } from '../modules/review/reviewCoachingFactsStore';
import type { ReviewCoachingFacts } from './reviewCoachingFacts';
import GameReviewer from './GameReviewer';
import { analyzeMoveLog } from './moveAnalyzer';
import type { AnalyzedMove, GameAnalysis } from './moveAnalyzer';

const buildFactsSpy = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => ReviewCoachingFacts>(),
);

vi.mock('./reviewCoachingFacts', async () => {
  const actual = await vi.importActual<typeof import('./reviewCoachingFacts')>('./reviewCoachingFacts');
  return {
    ...actual,
    buildReviewCoachingFacts: (...args: unknown[]) => buildFactsSpy(...args),
  };
});

const play = (low: number, high: number, position: PlacementPosition = 'left'): ReviewAction => ({
  kind: 'play',
  tile: { low, high },
  position,
});

function candidate(
  action: ReviewAction,
  overrides: Partial<ReviewCandidateEvaluationV1> = {},
): ReviewCandidateEvaluationV1 {
  return {
    action,
    value: { expectedPointDifferential: -1, winProbability: null },
    immediatePoints: 0,
    principalVariation: [],
    ...overrides,
  };
}

function evaluation(args: {
  snapshotId: string;
  candidates: readonly ReviewCandidateEvaluationV1[];
  playedAction: ReviewAction;
  bestAction: ReviewAction;
}): ReviewEvaluationV1 {
  const played = args.candidates.find((c) => JSON.stringify(c.action) === JSON.stringify(args.playedAction))!;
  const best = args.candidates.find((c) => JSON.stringify(c.action) === JSON.stringify(args.bestAction))!;
  return {
    evaluationVersion: 1,
    snapshotId: args.snapshotId,
    rulesVersion: 1,
    reviewEngineVersion: 'review-engine-v1',
    evidence: { source: 'search', confidence: 'medium', displayLabel: 'Review Engine search' },
    played,
    best,
    candidates: args.candidates,
    loss: { expectedPointDifferential: 2, winProbability: null },
    search: { nodes: args.candidates.length, depth: 2, hiddenStateSamples: 4, coverage: 0.8, complete: false },
    diagnostics: [],
  };
}

function analyzedMove(overrides: Partial<AnalyzedMove> = {}): AnalyzedMove {
  return {
    moveNumber: 1,
    action: 'place',
    playedTile: [1, 2],
    score: 0,
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

function factsFor(label: string, played: ReviewAction, best: ReviewAction): ReviewCoachingFacts {
  return {
    played: { action: played, immediatePoints: 0 },
    best: { action: best, immediatePoints: 5 },
    missKind: 'better_tile',
    deltas: { immediatePoints: 5, expectedPointDifferential: 2, referenceExpectedPointDifferential: 2 },
    evidence: { source: 'search', confidence: 'medium', displayLabel: 'Review Engine search' },
    principalVariation: [],
    referenceSource: 'oracle',
    agreement: { oracleVsFritz: 'disagree', playedMatch: 'neither', contested: true },
    fritzMove: { action: best, immediatePoints: 5, isMinimaxEndgame: false },
    // Distinct marker so A→B→A can assert identity stability.
    oracleMove: { action: played, immediatePoints: label === 'A' ? 1 : 2 },
  };
}

describe('GameReviewer production path — canonical coaching facts', () => {
  it('cursor A → B → A constructs once per decision and restores identical coaching prose', async () => {
    const user = userEvent.setup();
    const actionA = play(1, 2);
    const actionB = play(3, 4);

    buildFactsSpy.mockReset();
    buildFactsSpy
      .mockImplementationOnce(() => factsFor('A', actionA, actionB))
      .mockImplementationOnce(() => factsFor('B', actionB, actionA))
      .mockImplementation(() => {
        throw new Error('unexpected third construction — cache should have served this decision');
      });

    const evalA = evaluation({
      snapshotId: 'a',
      candidates: [candidate(actionA), candidate(actionB)],
      playedAction: actionA,
      bestAction: actionB,
    });
    const evalB = evaluation({
      snapshotId: 'b',
      candidates: [candidate(actionA), candidate(actionB)],
      playedAction: actionB,
      bestAction: actionA,
    });

    const reviewWorkerBatch: ReviewBatchState = {
      resultsByDecisionId: new Map([
        ['d-a', evalA],
        ['d-b', evalB],
      ]),
      errorsByDecisionId: new Map(),
      pendingDecisionIds: new Set(),
      done: true,
    };
    const decisionIdByMoveNumber = new Map([
      [1, 'd-a'],
      [2, 'd-b'],
    ]);
    const snapshotsByDecisionId = new Map<string, ReviewPositionSnapshotV2>([
      ['d-a', { identifiers: { decisionId: 'd-a' } } as ReviewPositionSnapshotV2],
      ['d-b', { identifiers: { decisionId: 'd-b' } } as ReviewPositionSnapshotV2],
    ]);
    const coachingFactsStore = createReviewCoachingFactsStore<ReviewCoachingFacts>('integration-review');

    const analysis = analysisWithMoves([
      analyzedMove({ moveNumber: 1, playedTile: [1, 2] }),
      analyzedMove({ moveNumber: 2, playedTile: [3, 4] }),
    ]);

    render(
      <GameReviewer
        open
        onClose={vi.fn()}
        analysis={analysis}
        reviewWorkerBatch={reviewWorkerBatch}
        decisionIdByMoveNumber={decisionIdByMoveNumber}
        coachingFactsStore={coachingFactsStore}
        snapshotsByDecisionId={snapshotsByDecisionId}
      />,
    );

    expect(await screen.findByText('What happened')).toBeTruthy();
    const headlineA = document.body.querySelector('.gr-advice-headline')?.textContent ?? '';
    expect(headlineA.length).toBeGreaterThan(0);
    expect(buildFactsSpy).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Next move' }));
    const headlineB = document.body.querySelector('.gr-advice-headline')?.textContent ?? '';
    expect(headlineB.length).toBeGreaterThan(0);
    expect(headlineB).not.toEqual(headlineA);
    expect(buildFactsSpy).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole('button', { name: 'Previous move' }));
    expect(document.body.querySelector('.gr-advice-headline')?.textContent).toEqual(headlineA);
    expect(buildFactsSpy).toHaveBeenCalledTimes(2);
    expect(coachingFactsStore.byDecisionId.get('d-a')).toBe(coachingFactsStore.byDecisionId.get('d-a'));
    expect(coachingFactsStore.byDecisionId.size).toBe(2);
  });
});
