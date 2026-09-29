// @vitest-environment jsdom
/**
 * Progressive Game Review UX: review is usable while background completion
 * continues. Final hand/game % appear only when every non-forced decision is
 * SCORED — never a blocking Tier 3/4 loading screen.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReviewEvaluationV1 } from '@racehorse/game-core/review';
import type { AnalyzedMove, GameAnalysis } from '../../analyzer/moveAnalyzer';
import { applyCalibratedHandAccuracies } from '../../modules/review/applyCalibratedHandAccuracies';
import { PostGameReviewPrompt } from './PostGameReviewPrompt';
import { HandTimeline } from './HandTimeline';
import type { HandAnalysis } from '../../analyzer/analysisTypes';

function searchEval(loss: number): ReviewEvaluationV1 {
  const played = {
    action: { kind: 'play' as const, tile: { low: 1, high: 5 }, position: 'left' as const },
    value: { expectedPointDifferential: -loss, winProbability: null },
    immediatePoints: 0,
    principalVariation: [],
  };
  const best = {
    action: { kind: 'play' as const, tile: { low: 3, high: 4 }, position: 'left' as const },
    value: { expectedPointDifferential: 0, winProbability: null },
    immediatePoints: 0,
    principalVariation: [],
  };
  return {
    evaluationVersion: 1,
    snapshotId: 'x',
    rulesVersion: 1,
    reviewEngineVersion: 'review-engine-v1',
    evidence: { source: 'search', confidence: 'medium', displayLabel: 'Review Engine search' },
    played,
    best,
    candidates: [best, played],
    loss: { expectedPointDifferential: loss, winProbability: null },
    search: { nodes: 10, depth: 2, hiddenStateSamples: 100, coverage: 0.05, complete: true },
    diagnostics: [],
    evaluationProvenance: { phase: 'live', lifecycle: 'SCORED', escalationTier: 1 },
  };
}

function forcedEval(): ReviewEvaluationV1 {
  const only = {
    action: { kind: 'play' as const, tile: { low: 0, high: 0 }, position: 'left' as const },
    value: { expectedPointDifferential: 0, winProbability: null },
    immediatePoints: 0,
    principalVariation: [],
  };
  return {
    ...searchEval(0),
    candidates: [only],
    played: only,
    best: only,
    evaluationProvenance: { phase: 'live', lifecycle: 'FORCED', escalationTier: 1 },
  };
}

function stubMove(moveNumber: number): AnalyzedMove {
  return {
    moveNumber,
    action: 'place',
    playedTile: [1, 2],
    score: 50,
    rating: 'Good',
    explanation: '',
    handBefore: [],
    validMoves: [],
    boardEnds: [0, 0],
    boardState: [],
    boardRenderState: null,
    boardRenderStateAfterMove: null,
    handSnapshot: [],
    engineBestMove: null,
  };
}

function hand(handNumber: number, moveNumbers: number[], handAccuracy: number | null): HandAnalysis {
  return {
    handNumber,
    startingScores: { you: 0, opponent: 0 },
    endingScores: { you: 0, opponent: 0 },
    analyzedMoves: moveNumbers.map(stubMove),
    handAccuracy,
    pivotalMoments: [],
    verdict: { winner: 'tie', pointsYou: 0, pointsOpponent: 0, margin: 0 },
    consequenceChains: [],
  };
}

function baseAnalysis(hands: HandAnalysis[]): GameAnalysis {
  return {
    accuracy: 80,
    grade: 'B',
    analyzedAt: 0,
    analyzedMoves: hands.flatMap((h) => h.analyzedMoves),
    timeline: [],
    hands,
    oracleMode: 'tier',
    tierPlayed: 'standard',
    oracleLabel: 'Fritz',
    worstHandNumber: null,
    consequenceByMoveNumber: {},
  };
}

describe('progressive Game Review accuracy gating', () => {
  it('37 decisions, 34 complete: prompt shows Analyzing N / M, Review Game enabled, no final %', () => {
    const onReviewGame = vi.fn();
    render(
      <PostGameReviewPrompt
        open
        modeLabel="Play vs Fritz"
        resultLabel="Victory"
        won
        youScore={60}
        opponentScore={40}
        opponentLabel="Fritz"
        analysis={baseAnalysis([hand(1, [1, 2], 92), hand(2, [3], null)])}
        accuracyModelPending
        decisionLedger={{
          scoredCount: 30,
          estimateCount: 0,
          forcedCount: 4,
          unavailableCount: 0,
          pendingCount: 3,
          totalDecisions: 37,
          entries: [],
        }}
        onReviewGame={onReviewGame}
        onSkip={vi.fn()}
      />,
    );

    expect(screen.getByText(/Analyzing 30 \/ 33 decisions/i)).toBeInTheDocument();
    expect(screen.queryByText('80%')).not.toBeInTheDocument();
    expect(screen.queryByText(/Scored accuracy/)).not.toBeInTheDocument();
    const reviewBtn = screen.getByRole('button', { name: /Review Game/i });
    expect(reviewBtn).toBeEnabled();
    reviewBtn.click();
    expect(onReviewGame).toHaveBeenCalledOnce();
  });

  it('hand with a pending non-forced decision has no final %; completed hand can show %', () => {
    // Hand 1: 3 scored → accuracy shown. Hand 2: 2 scored + 1 pending → null.
    const decisionIdByMoveNumber = new Map([
      [1, 'd1'],
      [2, 'd2'],
      [3, 'd3'],
      [4, 'd4'],
      [5, 'd5'],
      [6, 'd6'],
    ]);
    const results = new Map<string, ReviewEvaluationV1>([
      ['d1', searchEval(0)],
      ['d2', searchEval(0)],
      ['d3', searchEval(0)],
      ['d4', searchEval(0)],
      ['d5', searchEval(1)],
      // d6 pending — absent
    ]);
    const analysis = baseAnalysis([
      hand(1, [1, 2, 3], 50),
      hand(2, [4, 5, 6], 50),
    ]);
    const next = applyCalibratedHandAccuracies(analysis, {
      decisionIdByMoveNumber,
      resultsByDecisionId: results,
      pendingDecisionIds: new Set(['d6']),
    });
    expect(next.hands[0].handAccuracy).not.toBeNull();
    expect(next.hands[1].handAccuracy).toBeNull();

    render(
      <HandTimeline
        hands={next.hands}
        worstHandNumber={null}
        opponentLabel="Fritz"
        onSelectHand={vi.fn()}
      />,
    );
    // Completed hand shows a percent; pending hand shows em dash.
    expect(screen.getByText(/^\d+%$/)).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('when the last pending decision scores, hand and game accuracy appear without reload', () => {
    const decisionIdByMoveNumber = new Map([
      [1, 'd1'],
      [2, 'd2'],
    ]);
    let results = new Map<string, ReviewEvaluationV1>([['d1', searchEval(0)]]);
    const analysis = baseAnalysis([hand(1, [1, 2], null)]);

    const partial = applyCalibratedHandAccuracies(analysis, {
      decisionIdByMoveNumber,
      resultsByDecisionId: results,
      pendingDecisionIds: new Set(['d2']),
    });
    expect(partial.hands[0].handAccuracy).toBeNull();

    results = new Map([
      ['d1', searchEval(0)],
      ['d2', searchEval(0)],
    ]);
    const complete = applyCalibratedHandAccuracies(analysis, {
      decisionIdByMoveNumber,
      resultsByDecisionId: results,
      pendingDecisionIds: new Set(),
    });
    expect(complete.hands[0].handAccuracy).not.toBeNull();

    const { rerender } = render(
      <PostGameReviewPrompt
        open
        modeLabel="Play vs Fritz"
        resultLabel="Victory"
        won
        youScore={60}
        opponentScore={40}
        opponentLabel="Fritz"
        analysis={{ ...complete, accuracyModel: undefined }}
        accuracyModelPending
        decisionLedger={{
          scoredCount: 1,
          estimateCount: 0,
          forcedCount: 0,
          unavailableCount: 0,
          pendingCount: 1,
          totalDecisions: 2,
          entries: [],
        }}
        onReviewGame={vi.fn()}
        onSkip={vi.fn()}
      />,
    );
    expect(screen.getByText(/Analyzing 1 \/ 2 decisions/i)).toBeInTheDocument();

    rerender(
      <PostGameReviewPrompt
        open
        modeLabel="Play vs Fritz"
        resultLabel="Victory"
        won
        youScore={60}
        opponentScore={40}
        opponentLabel="Fritz"
        analysis={{
          ...complete,
          accuracyModel: {
            status: 'complete',
            accuracyModelVersion: 'accuracy-model-v5-action-forced-2026-09-22',
            accuracy: 100,
            grade: 'S',
            heuristicMoveCount: 0,
            totalNonForcedMoveCount: 2,
            coverageFraction: 1,
          },
        }}
        accuracyModelPending={false}
        decisionLedger={{
          scoredCount: 2,
          estimateCount: 0,
          forcedCount: 0,
          unavailableCount: 0,
          pendingCount: 0,
          totalDecisions: 2,
          entries: [],
        }}
        onReviewGame={vi.fn()}
        onSkip={vi.fn()}
      />,
    );
    expect(screen.getByText('100.0%')).toBeInTheDocument();
    expect(screen.queryByText(/Analyzing/i)).not.toBeInTheDocument();
  });

  it('all-forced hand never invents a percentage', () => {
    const decisionIdByMoveNumber = new Map([[1, 'd1']]);
    const results = new Map([['d1', forcedEval()]]);
    const next = applyCalibratedHandAccuracies(baseAnalysis([hand(1, [1], 99)]), {
      decisionIdByMoveNumber,
      resultsByDecisionId: results,
      pendingDecisionIds: new Set(),
    });
    expect(next.hands[0].handAccuracy).toBeNull();
  });
});
