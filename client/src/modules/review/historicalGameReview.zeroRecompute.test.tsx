import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReviewEvaluationV1 } from '@racehorse/game-core/review';
import GameReviewer from '../../analyzer/GameReviewer';
import type { GameAnalysis } from '../../analyzer/moveAnalyzer';
import { hydrateHistoricalGameReview } from './hydrateHistoricalGameReview';
import { buildGameReviewReplayArtifact } from './gameReviewReplayArtifact';
import { createReviewCoachingFactsStore } from './reviewCoachingFactsStore';
import type { ReviewCoachingFacts } from '../../analyzer/reviewCoachingFacts';

vi.mock('../../analyzer/reviewCoachingFacts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../analyzer/reviewCoachingFacts')>();
  return {
    ...actual,
    buildReviewCoachingFacts: vi.fn(() => {
      throw new Error('buildReviewCoachingFacts must not run in historical replay');
    }),
  };
});

vi.mock('../../analyzer/reviewFritzSecondOpinion', () => ({
  computeFritzReferenceMove: () => {
    throw new Error('Fritz must not run in historical replay');
  },
  ENDGAME_MINIMAX_TILE_THRESHOLD: 16,
}));

function evaluation(snapshotId: string): ReviewEvaluationV1 {
  const action = { kind: 'play' as const, tile: { low: 2, high: 4 }, position: 'left' as const };
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
    candidates: [cand, { ...cand, value: { expectedPointDifferential: 3, winProbability: null } }],
    loss: { expectedPointDifferential: 3, winProbability: null },
    search: { nodes: 2, depth: 1, hiddenStateSamples: 0, coverage: 1, complete: true },
    diagnostics: [],
  };
}

const analysis: GameAnalysis = {
  accuracy: 88,
  grade: 'A',
  analyzedAt: 42,
  analyzedMoves: [
    {
      moveNumber: 1,
      action: 'place',
      playedTile: [2, 4],
      score: 0,
      rating: 'Mistake',
      explanation: 'x',
      handBefore: [],
      validMoves: [],
      boardEnds: [0, 0],
      boardState: [],
      boardRenderState: null,
      boardRenderStateAfterMove: null,
      handSnapshot: [],
      engineBestMove: null,
    },
  ],
  timeline: [],
  hands: [],
  oracleMode: 'tier',
  tierPlayed: 'standard',
  oracleLabel: 't',
  worstHandNumber: null,
  consequenceByMoveNumber: {},
};

describe('F1e-5 historical GameReviewer zero-recompute', () => {
  it('renders persisted coaching without invoking Fritz, facts builder, or worker', () => {
    const eval1 = evaluation('d1');
    const store = createReviewCoachingFactsStore<ReviewCoachingFacts>('hist');
    const artifact = buildGameReviewReplayArtifact({
      analysis,
      evaluationsByDecisionId: new Map([['d1', eval1]]),
      decisionIdByMoveNumber: new Map([[1, 'd1']]),
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
        headline: 'Contested: persisted headline',
        detail: 'persisted detail',
        takeaway: 'persisted takeaway',
      }),
    });

    const hydrated = hydrateHistoricalGameReview({
      id: 'r1',
      evaluations: [eval1],
      accuracyModelResult: {},
      replayArtifact: artifact,
      source: 'client-asserted',
    });

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

    expect(screen.getByText('Contested: persisted headline')).toBeInTheDocument();
    expect(screen.getByText(/persisted detail/)).toBeInTheDocument();
  });
});
