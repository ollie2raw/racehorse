/**
 * @vitest-environment jsdom
 *
 * Production-shaped multi-hand Game Review integrity fixture.
 * Exercises the actual GameReviewer presentation path with mixed tiers,
 * forced/unavailable decisions, contested heuristic, and sequential numbering.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReviewAction, ReviewCandidateEvaluationV1, ReviewEvaluationV1 } from '@racehorse/game-core/review';
import type { ReviewBatchState } from '../modules/review/useReviewWorkerBatch';
import GameReviewer from './GameReviewer';
import { analyzeMoveLog, deriveReviewEvidence } from './moveAnalyzer';
import type { AnalyzedMove, GameAnalysis } from './moveAnalyzer';
import { buildPlayerDecisionLedger, formatDecisionAccountingSummary } from './reviewDecisionAccounting';
import { buildReviewPresentationRecord, assertPresentationConsistency } from './reviewPresentationRecord';
import type { ReviewCoachingFacts } from './reviewCoachingFacts';
import { buildReviewCoachingProse } from './reviewCoachingProse';

function cand(action: ReviewAction, rawScore?: number): ReviewCandidateEvaluationV1 {
  return {
    action,
    value: { expectedPointDifferential: 0, winProbability: null },
    immediatePoints: 0,
    principalVariation: [],
    rawScore,
  };
}

function play(low: number, high: number, position = 'left'): ReviewAction {
  return { kind: 'play', tile: { low, high }, position } as ReviewAction;
}

function evalBase(
  evidence: ReviewEvaluationV1['evidence'],
  candidates: readonly ReviewCandidateEvaluationV1[],
  played: ReviewAction,
  best: ReviewAction,
  loss: number,
): ReviewEvaluationV1 {
  const playedCand = candidates.find((c) => JSON.stringify(c.action) === JSON.stringify(played)) ?? cand(played);
  const bestCand = candidates.find((c) => JSON.stringify(c.action) === JSON.stringify(best)) ?? cand(best);
  return {
    evaluationVersion: 1,
    snapshotId: 'x',
    rulesVersion: 1,
    reviewEngineVersion: 'review-engine-v1',
    evidence,
    played: playedCand,
    best: bestCand,
    candidates,
    loss: { expectedPointDifferential: loss, winProbability: null },
    search: { nodes: candidates.length, depth: 2, hiddenStateSamples: 4, coverage: 0.4, complete: false },
    diagnostics: [],
  };
}

function move(n: number, validMoves: Array<[number, number]>, rating: AnalyzedMove['rating'] = 'Good'): AnalyzedMove {
  return {
    moveNumber: n,
    action: 'place',
    playedTile: validMoves[0] ?? [0, 0],
    score: 50,
    rating,
    explanation: 'fixture',
    handBefore: [],
    validMoves,
    boardEnds: [1, 2],
    boardState: [],
    boardRenderState: null,
    boardRenderStateAfterMove: null,
    handSnapshot: [],
    engineBestMove: null,
  };
}

describe('GameReviewer production-shaped multi-hand integrity E2E', () => {
  it('sequential player-decision numbering, accounting identity, classification/prose consistency, modern provenance', () => {
    const fritzMatch = play(2, 2, 'left');
    const oracleMax = play(5, 6, 'right');
    const heuristicContested = evalBase(
      { source: 'heuristic', confidence: 'low', displayLabel: 'Heuristic estimate' },
      [cand(fritzMatch, -40), cand(oracleMax, 90), cand(play(0, 1), -70)],
      fritzMatch,
      oracleMax,
      0,
    );

    const searchMistake = evalBase(
      { source: 'search', confidence: 'medium', displayLabel: 'Review Engine search' },
      [cand(play(1, 2), undefined), cand(play(3, 4), undefined), cand(play(0, 6), undefined)],
      play(1, 2),
      play(3, 4),
      2, // Mistake band under LOSS_BAND_BOUNDARIES (0.79 < loss ≤ 5.98)
    );

    const searchBestEqual = evalBase(
      { source: 'search', confidence: 'medium', displayLabel: 'Review Engine search' },
      [cand(play(4, 4, 'left'), undefined), cand(play(4, 4, 'right'), undefined), cand(play(1, 5), undefined)],
      play(4, 4, 'left'),
      play(4, 4, 'right'),
      0,
    );

    const forced = evalBase(
      { source: 'exact', confidence: 'high', displayLabel: 'Exact analysis' },
      [cand(play(6, 6))],
      play(6, 6),
      play(6, 6),
      0,
    );

    const searchBlunder = evalBase(
      { source: 'search', confidence: 'medium', displayLabel: 'Review Engine search' },
      [cand(play(0, 3), undefined), cand(play(2, 5), undefined), cand(play(1, 1), undefined)],
      play(0, 3),
      play(2, 5),
      14,
    );

    const moves: AnalyzedMove[] = [
      move(3, [[6, 6]]), // forced — raw id 3
      move(8, [[2, 2], [5, 6]], 'Blunder'), // heuristic match Fritz
      move(12, [[1, 2], [3, 4]], 'Mistake'), // search mistake
      move(40, [[4, 4], [1, 5]], 'Good'), // equal placement
      move(55, [[0, 3], [2, 5]], 'Blunder'), // search blunder
      move(70, [[0, 0], [1, 1]], 'Good'), // unavailable
    ];

    const decisionIdByMoveNumber = new Map([
      [3, 'd-forced'],
      [8, 'd-heur'],
      [12, 'd-mist'],
      [40, 'd-eq'],
      [55, 'd-blun'],
    ]);

    const resultsByDecisionId = new Map<string, ReviewEvaluationV1>([
      ['d-forced', forced],
      ['d-heur', heuristicContested],
      ['d-mist', searchMistake],
      ['d-eq', searchBestEqual],
      ['d-blun', searchBlunder],
    ]);

    const accuracyModel = {
      status: 'partial' as const,
      accuracyModelVersion: 'accuracy-model-v4-calibrated-2026-09-17',
      accuracy: 90.9,
      grade: 'A' as const,
      heuristicMoveCount: 1,
      totalNonForcedMoveCount: 4,
      coverageFraction: 0.75,
    };
    const evidence = deriveReviewEvidence(accuracyModel);
    expect(evidence.displayLabel).toBe('Review Engine analysis');
    expect(evidence.displayLabel.toLowerCase()).not.toContain('legacy');

    const analysis: GameAnalysis = {
      ...analyzeMoveLog([]),
      analyzedMoves: moves,
      hands: [],
      accuracyModel,
      evidence,
    };

    const ledger = buildPlayerDecisionLedger({
      analyzedMoves: moves,
      decisionIdByMoveNumber,
      resultsByDecisionId,
      errorsByDecisionId: new Map(),
      pendingDecisionIds: new Set(),
      batchDone: true,
    });
    expect(ledger.totalDecisions).toBe(6);
    expect(ledger.forcedCount).toBe(1);
    expect(ledger.scoredCount).toBe(3);
    expect(ledger.estimateCount).toBe(1);
    expect(ledger.unavailableCount).toBe(1);
    expect(formatDecisionAccountingSummary(ledger)).toContain('unavailable');

    const heurFacts: ReviewCoachingFacts = {
      played: { action: fritzMatch, immediatePoints: 0 },
      best: { action: fritzMatch, immediatePoints: 0 },
      referenceSource: 'fritz',
      missKind: 'correct',
      deltas: { immediatePoints: 0, expectedPointDifferential: 0 },
      evidence: heuristicContested.evidence,
      principalVariation: [],
      agreement: { contested: true, oracleVsFritz: 'disagree', playedMatch: 'fritz' },
      fritzMove: { action: fritzMatch, immediatePoints: 0, isMinimaxEndgame: false },
      oracleMove: { action: oracleMax, immediatePoints: 0 },
    };
    const heurRecord = buildReviewPresentationRecord(heuristicContested, heurFacts);
    const heurProse = buildReviewCoachingProse(heurFacts, false);
    // Non-positional correct path uses "Solid pick" / "strongest option" —
    // must still be consistent with Good, never Blunder.
    expect(heurProse.headline.toLowerCase()).toMatch(/solid pick|strongest option|best move|top score/);
    expect(assertPresentationConsistency(heurRecord, heurProse.headline)).toEqual([]);
    expect(heurRecord.classification).toEqual({ kind: 'bucket', bucket: 'Good' });

    // Positional matched-reference path (production cohort) says Best move.
    const positionalProse = buildReviewCoachingProse(
      { ...heurFacts, featureDeltas: [] },
      true,
    );
    expect(positionalProse.headline).toMatch(/^Best move\./);
    expect(assertPresentationConsistency(heurRecord, positionalProse.headline)).toEqual([]);

    const batch: ReviewBatchState = {
      resultsByDecisionId,
      errorsByDecisionId: new Map(),
      pendingDecisionIds: new Set(),
      done: true,
    };

    render(
      <GameReviewer
        open
        onClose={vi.fn()}
        analysis={analysis}
        reviewWorkerBatch={batch}
        decisionIdByMoveNumber={decisionIdByMoveNumber}
        historicalCoachingByDecisionId={new Map([['d-heur', { facts: heurFacts, prose: positionalProse }]])}
        title="Game review"
      />,
    );

    expect(screen.getByText(/Review Engine analysis/i)).toBeInTheDocument();
    expect(screen.queryByText(/Legacy heuristic estimate/i)).not.toBeInTheDocument();

    const list = screen.getByRole('listbox', { name: /Moves in selected hand/i });
    const rows = within(list).getAllByRole('option');
    expect(rows).toHaveLength(6);
    expect(within(rows[0]!).getByText('#1')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('#2')).toBeInTheDocument();
    expect(within(rows[5]!).getByText('#6')).toBeInTheDocument();
    // Raw telemetry ids must not be the primary numbering.
    expect(within(list).queryByText('#8')).not.toBeInTheDocument();
    expect(within(list).queryByText('#70')).not.toBeInTheDocument();

    expect(within(rows[0]!).getByText('Forced')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Good')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Mistake')).toBeInTheDocument();
    expect(within(rows[3]!).getByText('Best')).toBeInTheDocument();
    expect(within(rows[4]!).getByText('Blunder')).toBeInTheDocument();
    expect(within(rows[5]!).getByText('Unavailable')).toBeInTheDocument();
  });
});
