import { describe, expect, it } from 'vitest';
import type { ReviewAction, ReviewCandidateEvaluationV1, ReviewEvaluationV1 } from '@racehorse/game-core/review';
import { classifyHeuristicResult } from './classifyHeuristicResult';
import {
  calibratedRatingCoachingCopy,
  formatScoreGapForDisplay,
  moveRatingCoachingCopy,
} from './moveRatingCoachingCopy';
import {
  assertPresentationConsistency,
  buildReviewPresentationRecord,
} from './reviewPresentationRecord';
import {
  buildPlayerDecisionLedger,
  formatDecisionAccountingSummary,
  legacyCoverageCounts,
} from './reviewDecisionAccounting';
import type { AnalyzedMove } from './moveAnalyzer';
import type { ReviewCoachingFacts } from './reviewCoachingFacts';

function candidate(action: ReviewAction, rawScore: number | undefined): ReviewCandidateEvaluationV1 {
  return {
    action,
    value: { expectedPointDifferential: 0, winProbability: null },
    immediatePoints: 0,
    principalVariation: [],
    rawScore,
  };
}

function heuristicEval(
  candidates: readonly ReviewCandidateEvaluationV1[],
  playedAction: ReviewAction,
): ReviewEvaluationV1 {
  const played = candidates.find((c) => JSON.stringify(c.action) === JSON.stringify(playedAction))!;
  return {
    evaluationVersion: 1,
    snapshotId: 'x',
    rulesVersion: 1,
    reviewEngineVersion: 'review-engine-v1',
    evidence: { source: 'heuristic', confidence: 'low', displayLabel: 'Heuristic estimate' },
    played,
    best: candidates[0],
    candidates,
    loss: { expectedPointDifferential: 0, winProbability: null },
    search: { nodes: candidates.length, depth: 0, hiddenStateSamples: 0, coverage: 0, complete: true },
    diagnostics: [],
  };
}

function searchEval(loss: number, played: ReviewAction, best: ReviewAction): ReviewEvaluationV1 {
  const playedCand = candidate(played, undefined);
  const bestCand = candidate(best, undefined);
  const other = candidate({ kind: 'play', tile: { low: 0, high: 1 }, position: 'right' }, undefined);
  return {
    evaluationVersion: 1,
    snapshotId: 'x',
    rulesVersion: 1,
    reviewEngineVersion: 'review-engine-v1',
    evidence: { source: 'search', confidence: 'medium', displayLabel: 'Review Engine search' },
    played: playedCand,
    best: bestCand,
    candidates: [playedCand, bestCand, other],
    loss: { expectedPointDifferential: loss, winProbability: null },
    search: { nodes: 3, depth: 2, hiddenStateSamples: 10, coverage: 0.5, complete: false },
    diagnostics: [],
  };
}

const play = (low: number, high: number, position: string = 'left'): ReviewAction =>
  ({ kind: 'play', tile: { low, high }, position }) as ReviewAction;

function analyzedMove(moveNumber: number, validMoves: Array<[number, number]>): AnalyzedMove {
  return {
    moveNumber,
    action: 'place',
    playedTile: validMoves[0] ?? [0, 0],
    score: 50,
    rating: 'Good',
    explanation: 'test',
    handBefore: [],
    validMoves,
    boardEnds: [0, 0],
    boardState: [],
    boardRenderState: null,
    boardRenderStateAfterMove: null,
    handSnapshot: [],
    engineBestMove: null,
  };
}

describe('production integrity — heuristic Fritz primary (no Blunder + Best move)', () => {
  it('player matches stored Fritz preference but canonical evaluation selects another move', () => {
    const fritz = play(2, 2, 'left');
    const oracleMax = play(5, 6, 'right');
    const worse = play(0, 1, 'left');
    const baseEvaluation = heuristicEval(
      [candidate(fritz, -40), candidate(oracleMax, 80), candidate(worse, -60)],
      fritz,
    );
    const evaluation = { ...baseEvaluation, best: baseEvaluation.candidates[1]! };
    expect(classifyHeuristicResult(evaluation, { primaryReferenceAction: fritz })).toEqual({
      kind: 'estimate',
      matchedPrimary: true,
    });

    const facts = {
      played: { action: fritz, immediatePoints: 0 },
      best: { action: fritz, immediatePoints: 0 },
      referenceSource: 'fritz',
      missKind: 'correct',
      deltas: { immediatePoints: 0, expectedPointDifferential: 0 },
      evidence: evaluation.evidence,
      principalVariation: [],
      agreement: {
        contested: true,
        oracleVsFritz: 'disagree',
        playedMatch: 'fritz',
      },
    } as ReviewCoachingFacts;

    const record = buildReviewPresentationRecord(evaluation, facts);
    expect(record.primaryReferenceAction).toEqual(evaluation.best.action);
    expect(record.playedMatchesPrimary).toBe(false);
    expect(record.classification).toEqual({ kind: 'estimate', matchedPrimary: false });
    expect(assertPresentationConsistency(record, 'Best move. 2-2 at the left end matches the review reference.')).toEqual([]);
  });
});

describe('production integrity — calibrated classification ↔ WHY copy', () => {
  it('BEST never says about 0 points behind', () => {
    const copy = calibratedRatingCoachingCopy('Best', 0);
    expect(copy.toLowerCase()).not.toContain('behind');
    expect(copy.toLowerCase()).not.toMatch(/\b0 points?\b/);
  });

  it('MISTAKE never calls itself a solid option', () => {
    const copy = calibratedRatingCoachingCopy('Mistake', 2);
    expect(copy.toLowerCase()).not.toContain('solid option');
    expect(copy.toLowerCase()).toContain('meaningful miss');
  });

  it('tiny nonzero gap does not round to misleading 0', () => {
    expect(formatScoreGapForDisplay(0)).toBeNull();
    expect(formatScoreGapForDisplay(0.04)).toBe('less than 0.1 point');
    expect(formatScoreGapForDisplay(0.8)).toBe('0.8 points');
    const copy = calibratedRatingCoachingCopy('Inaccuracy', 0.04);
    expect(copy).toContain('less than 0.1 point');
    expect(copy).not.toMatch(/about 0 points/);
  });

  it('true displayed-reference equality cannot pair Mistake with even-overall prose', () => {
    const evaluation = searchEval(0, play(3, 4, 'left'), play(3, 4, 'right'));
    const facts = {
      played: { action: play(3, 4, 'left'), immediatePoints: 0 },
      best: { action: play(3, 4, 'right'), immediatePoints: 0 },
      referenceSource: 'oracle',
      missKind: 'same_tile_wrong_end',
      deltas: {
        immediatePoints: 0,
        expectedPointDifferential: 0,
        referenceExpectedPointDifferential: 0,
      },
      evidence: evaluation.evidence,
      principalVariation: [],
      agreement: {
        contested: false,
        oracleVsFritz: 'agree',
        playedMatch: 'neither',
      },
    } as ReviewCoachingFacts;
    const record = buildReviewPresentationRecord(evaluation, facts);
    expect(record.classification).toEqual({ kind: 'calibrated', label: 'Best' });
    expect(assertPresentationConsistency(record, 'The review rates these two moves even overall.')).toEqual([]);
  });

  it('legacy Good + 0 gap uses tied wording, not about 0 points behind', () => {
    const copy = moveRatingCoachingCopy('Good', 'precise', 0);
    expect(copy).toMatch(/Tied with the best/i);
    expect(copy).not.toMatch(/about 0 points/);
  });
});

describe('production integrity — decision accounting', () => {
  it('proves exact ledger identity for a multi-hand shaped set (action-level forced)', () => {
    const moves = [
      analyzedMove(1, [[0, 0]]), // forced via eval
      analyzedMove(5, [[1, 2], [3, 4]]), // scored
      analyzedMove(7, [[2, 3], [4, 5]]), // estimate
      analyzedMove(49, [[1, 1], [2, 2]]), // scored
      analyzedMove(52, [[0, 5], [1, 6]]), // unavailable (no decision id)
      analyzedMove(59, [[3, 3]]), // unavailable without eval (tile-only must not invent Forced)
    ];

    const scored = searchEval(1, play(1, 2), play(3, 4));
    const estimate = heuristicEval(
      [candidate(play(2, 3), 10), candidate(play(4, 5), 40)],
      play(2, 3),
    );
    const scored2 = searchEval(8, play(1, 1), play(2, 2));
    const forcedEval = heuristicEval([candidate(play(0, 0), 1)], play(0, 0));

    const ledger = buildPlayerDecisionLedger({
      analyzedMoves: moves,
      decisionIdByMoveNumber: new Map([
        [1, 'd-forced'],
        [5, 'd-scored'],
        [7, 'd-est'],
        [49, 'd-scored2'],
      ]),
      resultsByDecisionId: new Map([
        ['d-forced', forcedEval],
        ['d-scored', scored],
        ['d-est', estimate],
        ['d-scored2', scored2],
      ]),
      errorsByDecisionId: new Map(),
      pendingDecisionIds: new Set(),
      batchDone: true,
    });

    expect(ledger.totalDecisions).toBe(6);
    expect(ledger.forcedCount).toBe(1);
    expect(ledger.scoredCount).toBe(2);
    expect(ledger.estimateCount).toBe(1);
    expect(ledger.unavailableCount).toBe(0);
    expect(ledger.pendingCount).toBe(2);
    expect(
      ledger.scoredCount + ledger.estimateCount + ledger.forcedCount + ledger.pendingCount,
    ).toBe(ledger.totalDecisions);
    expect(formatDecisionAccountingSummary(ledger)).toBe(
      '2 scored · 1 estimate · 1 forced · 2 pending · 6 total decisions',
    );
  });

  it('one tile / two placements is Estimate (not Forced) in the ledger', () => {
    const left = play(3, 4, 'left');
    const right = play(3, 4, 'right');
    const evaluation = heuristicEval([candidate(left, 10), candidate(right, 40)], left);
    const ledger = buildPlayerDecisionLedger({
      analyzedMoves: [analyzedMove(1, [[3, 4]])],
      decisionIdByMoveNumber: new Map([[1, 'd1']]),
      resultsByDecisionId: new Map([['d1', evaluation]]),
      errorsByDecisionId: new Map(),
      pendingDecisionIds: new Set(),
      batchDone: true,
    });
    expect(ledger.forcedCount).toBe(0);
    expect(ledger.estimateCount).toBe(1);
  });

  it('documents that legacy "36 of 65" meant scorable non-forced of all non-forced (not forced)', () => {
    const legacy = legacyCoverageCounts({
      totalNonForcedMoveCount: 65,
      heuristicMoveCount: 29,
    });
    expect(legacy).toEqual({ scorableNonForced: 36, totalNonForced: 65 });
  });
});
