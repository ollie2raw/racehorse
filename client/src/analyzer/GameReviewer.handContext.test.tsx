import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ReviewEvaluationV1 } from '@racehorse/game-core/review';
import GameReviewer from './GameReviewer';
import { analyzeMoveLog } from './moveAnalyzer';
import type { AnalyzedMove, GameAnalysis } from './moveAnalyzer';
import { buildGameReviewReplayArtifact } from '../modules/review/gameReviewReplayArtifact';
import { hydrateHistoricalGameReview } from '../modules/review/hydrateHistoricalGameReview';
import { createReviewCoachingFactsStore } from '../modules/review/reviewCoachingFactsStore';
import type { ReviewCoachingFacts } from './reviewCoachingFacts';

vi.mock('./reviewCoachingFacts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./reviewCoachingFacts')>();
  return {
    ...actual,
    buildReviewCoachingFacts: vi.fn(actual.buildReviewCoachingFacts),
  };
});

vi.mock('./reviewFritzSecondOpinion', () => ({
  computeFritzReferenceMove: () => {
    throw new Error('Fritz must not run for historical hand context');
  },
  ENDGAME_MINIMAX_TILE_THRESHOLD: 16,
}));

function analyzedMove(overrides: Partial<AnalyzedMove> = {}): AnalyzedMove {
  return {
    moveNumber: 1,
    action: 'place',
    playedTile: [3, 4],
    score: 10,
    rating: 'Inaccuracy',
    explanation: 'test move',
    handBefore: [
      [0, 1],
      [3, 4],
      [5, 6],
    ],
    validMoves: [
      [3, 4],
      [5, 6],
    ],
    boardEnds: [3, 5],
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

function handStrip() {
  return screen.getByTestId('gr-your-hand');
}

function tileRoles(): Array<{ tile: string; role: string | null }> {
  return [...handStrip().querySelectorAll<HTMLElement>('[data-tile]')].map((el) => ({
    tile: el.dataset.tile ?? '',
    role: el.dataset.role ?? null,
  }));
}

function evaluation(snapshotId: string): ReviewEvaluationV1 {
  const action = { kind: 'play' as const, tile: { low: 3, high: 4 }, position: 'left' as const };
  const cand = {
    action,
    value: { expectedPointDifferential: 0, winProbability: null },
    immediatePoints: 0,
    principalVariation: [],
  };
  return {
    evaluationVersion: 1,
    snapshotId,
    rulesVersion: 1,
    reviewEngineVersion: 'review-engine-v1',
    evidence: { source: 'search', confidence: 'medium', displayLabel: 'Review Engine search' },
    played: cand,
    best: { ...cand, value: { expectedPointDifferential: 3, winProbability: null } },
    candidates: [cand],
    loss: { expectedPointDifferential: 3, winProbability: null },
    search: { nodes: 2, depth: 1, hiddenStateSamples: 0, coverage: 1, complete: true },
    diagnostics: [],
  };
}

describe('GameReviewer Your hand decision context', () => {
  it('A/B/C: renders full pre-move hand with Played, Playable, and held tiles', () => {
    render(
      <GameReviewer
        open
        onClose={vi.fn()}
        analysis={analysisWithMoves([analyzedMove()])}
      />,
    );

    expect(screen.getByText('Your hand')).toBeInTheDocument();
    const roles = tileRoles();
    expect(roles).toEqual([
      { tile: '0-1', role: 'held' },
      { tile: '3-4', role: 'played' },
      { tile: '5-6', role: 'playable' },
    ]);
    expect(within(handStrip()).getByText('Played')).toBeInTheDocument();
    expect(within(handStrip()).getByText('Playable')).toBeInTheDocument();
    // Non-playable remains visible (not removed) and is not labeled Playable.
    expect(handStrip().querySelector('[data-tile="0-1"]')?.textContent).not.toMatch(/Playable/);
  });

  it('D: same tile with multiple legal ends appears once', () => {
    render(
      <GameReviewer
        open
        onClose={vi.fn()}
        analysis={analysisWithMoves([
          analyzedMove({
            playedTile: [2, 2],
            handBefore: [
              [2, 2],
              [0, 5],
            ],
            // Two legal actions for the same tile identity (left + right).
            validMoves: [
              [2, 2],
              [2, 2],
            ],
          }),
        ])}
      />,
    );
    const doubles = handStrip().querySelectorAll('[data-tile="2-2"]');
    expect(doubles).toHaveLength(1);
    expect(doubles[0].getAttribute('data-role')).toBe('played');
  });

  it('E/F: cursor A→B→A restores the original pre-move hand', async () => {
    const user = userEvent.setup();
    const moves = [
      analyzedMove({
        moveNumber: 1,
        playedTile: [1, 1],
        handBefore: [
          [1, 1],
          [4, 5],
        ],
        validMoves: [[1, 1]],
      }),
      analyzedMove({
        moveNumber: 2,
        playedTile: [0, 6],
        handBefore: [
          [0, 6],
          [2, 3],
          [4, 4],
        ],
        validMoves: [
          [0, 6],
          [2, 3],
        ],
      }),
    ];
    render(<GameReviewer open onClose={vi.fn()} analysis={analysisWithMoves(moves)} />);

    expect(tileRoles().map((r) => r.tile)).toEqual(['1-1', '4-5']);

    await user.click(screen.getByLabelText('Next move'));
    expect(tileRoles().map((r) => r.tile)).toEqual(['0-6', '2-3', '4-4']);
    expect(tileRoles().find((r) => r.tile === '0-6')?.role).toBe('played');

    await user.click(screen.getByLabelText('Previous move'));
    expect(tileRoles()).toEqual([
      { tile: '1-1', role: 'played' },
      { tile: '4-5', role: 'held' },
    ]);
  });

  it('G/H: historical reopen preserves the hand and canonicalizes legacy coaching without Fritz/worker', () => {
    const analysis = analysisWithMoves([
      analyzedMove({
        handBefore: [
          [1, 2],
          [3, 4],
          [5, 5],
        ],
        validMoves: [
          [3, 4],
          [5, 5],
        ],
        playedTile: [3, 4],
      }),
    ]);
    const eval1 = evaluation('d-hand');
    const store = createReviewCoachingFactsStore<ReviewCoachingFacts>('hand-hist');
    const artifact = buildGameReviewReplayArtifact({
      analysis,
      evaluationsByDecisionId: new Map([['d-hand', eval1]]),
      decisionIdByMoveNumber: new Map([[1, 'd-hand']]),
      coachingFactsStore: store,
      buildFacts: () => ({
        played: { action: eval1.played.action, immediatePoints: 0 },
        best: { action: eval1.best.action, immediatePoints: 0 },
        missKind: 'better_tile',
        deltas: {
          immediatePoints: 0,
          expectedPointDifferential: 3,
          referenceExpectedPointDifferential: 3,
        },
        evidence: eval1.evidence,
        principalVariation: [],
        referenceSource: 'oracle',
        agreement: { oracleVsFritz: 'disagree', playedMatch: 'neither', contested: true },
      }),
      buildProse: () => ({
        headline: 'Contested: hand reopen',
        detail: 'detail',
        takeaway: 'takeaway',
      }),
    });

    // Artifact already carries actor hand via analysis.analyzedMoves[].handBefore.
    expect(artifact.analysis.analyzedMoves[0].handBefore).toEqual(analysis.analyzedMoves[0].handBefore);
    expect(artifact.analysis.analyzedMoves[0].validMoves).toEqual(analysis.analyzedMoves[0].validMoves);

    const hydrated = hydrateHistoricalGameReview({
      id: 'r-hand',
      evaluations: [eval1],
      accuracyModelResult: {},
      replayArtifact: artifact,
      source: 'client-asserted',
    });

    expect(hydrated.analysis.analyzedMoves[0].handBefore).toEqual(analysis.analyzedMoves[0].handBefore);

    // Historical batch is frozen — launching a live worker would mutate pendingDecisionIds.
    expect(hydrated.reviewWorkerBatch.pendingDecisionIds.size).toBe(0);
    expect(hydrated.reviewWorkerBatch.done).toBe(true);

    render(
      <GameReviewer
        open
        onClose={vi.fn()}
        analysis={hydrated.analysis}
        reviewWorkerBatch={hydrated.reviewWorkerBatch}
        decisionIdByMoveNumber={hydrated.decisionIdByMoveNumber}
        historicalCoachingByDecisionId={hydrated.historicalCoachingByDecisionId}
      />,
    );

    expect(tileRoles()).toEqual([
      { tile: '1-2', role: 'held' },
      { tile: '3-4', role: 'played' },
      { tile: '5-5', role: 'playable' },
    ]);
    expect(screen.queryByText(/Contested|Fritz prefers|engines disagree/i)).not.toBeInTheDocument();
  });

  it('I: pass and draw show the hand with no Played badge', () => {
    const { rerender } = render(
      <GameReviewer
        open
        onClose={vi.fn()}
        analysis={analysisWithMoves([
          analyzedMove({
            action: 'pass',
            playedTile: undefined,
            handBefore: [
              [1, 2],
              [3, 4],
            ],
            validMoves: [],
          }),
        ])}
      />,
    );
    expect(tileRoles().every((r) => r.role === 'held')).toBe(true);
    expect(within(handStrip()).queryByText('Played')).not.toBeInTheDocument();

    rerender(
      <GameReviewer
        open
        onClose={vi.fn()}
        analysis={analysisWithMoves([
          analyzedMove({
            action: 'draw',
            playedTile: undefined,
            handBefore: [[0, 0]],
            validMoves: [],
          }),
        ])}
      />,
    );
    expect(tileRoles()).toEqual([{ tile: '0-0', role: 'held' }]);
    expect(within(handStrip()).queryByText('Played')).not.toBeInTheDocument();
  });

  it('J: does not render opponent private hand fields', () => {
    const analysis = analysisWithMoves([analyzedMove()]);
    // Sanity: analysis shape has no opponent hand array to leak into the strip.
    expect(Object.keys(analysis.analyzedMoves[0])).not.toContain('opponentHand');
    render(<GameReviewer open onClose={vi.fn()} analysis={analysis} />);
    expect(handStrip().querySelectorAll('[data-tile]')).toHaveLength(3);
    expect(document.body.textContent).not.toMatch(/opponent hand/i);
  });
});
