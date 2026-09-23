/**
 * @vitest-environment jsdom
 *
 * Production-pipeline integration: real snapshots → runReviewBatch →
 * accuracy/evidence merge → ledger → GameReviewer → replay artifact → hydrate.
 * Does NOT stub evidence, accuracyModel, reference source, or classification.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { REVIEW_FIXTURE_CORPUS } from '../../../packages/game-core/src/reviewFixtureCorpus';
import type { ReviewEvaluationV1, ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import { isForcedDecision } from '@racehorse/game-core/review';
import {
  ACCURACY_MODEL_VERSION,
  LOSS_BAND_BOUNDARIES,
  computeGameAccuracyModel,
} from '@racehorse/review-engine';
import GameReviewer from './GameReviewer';
import { analyzeMoveLog, deriveReviewEvidence, type AnalyzedMove, type GameAnalysis } from './moveAnalyzer';
import { buildPlayerDecisionLedger, formatDecisionAccountingSummary } from './reviewDecisionAccounting';
import { classifyHeuristicResult } from './classifyHeuristicResult';
import { buildReviewPresentationRecord, assertPresentationConsistency } from './reviewPresentationRecord';
import { runReviewBatch } from '../modules/review/runReviewBatch';
import { buildGameReviewReplayArtifact } from '../modules/review/gameReviewReplayArtifact';
import { hydrateHistoricalGameReview } from '../modules/review/hydrateHistoricalGameReview';
import {
  DEFAULT_REVIEW_COVERAGE_THRESHOLD,
  DEFAULT_REVIEW_DISPATCH_BUDGET,
} from '../modules/review/reviewEngineConfig';

function analyzedFromSnapshot(snapshot: ReviewPositionSnapshotV2, moveNumber: number): AnalyzedMove {
  const action = snapshot.actualAction;
  return {
    moveNumber,
    action: action.kind === 'play' ? 'place' : action.kind,
    playedTile: action.kind === 'play' ? [action.tile.low, action.tile.high] : undefined,
    score: 50,
    rating: 'Good',
    explanation: 'pipeline',
    handBefore: snapshot.preAction.actorHand.map((t) => [t.low, t.high] as [number, number]),
    validMoves: [],
    boardEnds: [
      snapshot.preAction.board?.leftEnd ?? 0,
      snapshot.preAction.board?.rightEnd ?? 0,
    ],
    boardState: [],
    boardRenderState: null,
    boardRenderStateAfterMove: null,
    handSnapshot: snapshot.preAction.actorHand.map((t) => [t.low, t.high] as [number, number]),
    engineBestMove: null,
  };
}

describe('production review pipeline integration', () => {
  it('flows real corpus snapshots through batch → accuracy/evidence → ledger → UI → persist/reopen', () => {
    // Curated multi-hand mix: forced opening, multi-placement midgame,
    // and endgame exact/search so coverage clears the floor like production.
    const fixtureIds = [
      'opening-double-from-live-deal',
      'near-win-multi-choice-defense',
      'hidden-allocation-ambiguous-midgame',
      'forced-single-play-midgame',
      'scoring-branch-chain',
      'nested-branch-decision',
      'locked-yard-five-tile-endgame',
      'locked-yard-feasible-endgame',
      'second-pass-blocks-hand',
      'deliberately-poor-avoided-branch-and-score',
      'deliberately-poor-flat-continuation-over-branch',
      'deliberately-poor-opening-s21-a10',
    ] as const;
    const fixtures = fixtureIds.map((id) => {
      const f = REVIEW_FIXTURE_CORPUS.find((x) => x.id === id);
      if (!f) throw new Error(`missing fixture ${id}`);
      return f;
    });
    const snapshots = fixtures.map((f) => f.snapshot);
    const resultsByDecisionId = new Map<string, ReviewEvaluationV1>();
    const errorsByDecisionId = new Map<string, string>();

    runReviewBatch(snapshots, DEFAULT_REVIEW_DISPATCH_BUDGET, DEFAULT_REVIEW_COVERAGE_THRESHOLD, {
      onResult: (id, evaluation) => {
        resultsByDecisionId.set(id, evaluation);
      },
      onError: (id, message) => {
        errorsByDecisionId.set(id, message);
      },
      onDone: () => {},
      isCancelled: () => false,
    });

    expect(errorsByDecisionId.size).toBe(0);
    expect(resultsByDecisionId.size).toBe(snapshots.length);

    const openingEval = resultsByDecisionId.get(
      REVIEW_FIXTURE_CORPUS.find((f) => f.id === 'opening-double-from-live-deal')!.snapshot.identifiers.decisionId,
    )!;
    expect(isForcedDecision(openingEval.candidates)).toBe(true);

    for (const evaluation of resultsByDecisionId.values()) {
      if (evaluation.candidates.length <= 1) continue;
      const playPositions = evaluation.candidates
        .filter((c) => c.action.kind === 'play')
        .map((c) => (c.action.kind === 'play' ? `${c.action.tile.low}-${c.action.tile.high}:${c.action.position}` : ''));
      const unique = new Set(playPositions);
      if (unique.size > 1 && playPositions.every((p) => p.startsWith(playPositions[0]!.split(':')[0]!))) {
        // Same tile, multiple placements → must not be forced.
        expect(isForcedDecision(evaluation.candidates)).toBe(false);
      }
    }

    const accuracyModel = computeGameAccuracyModel([...resultsByDecisionId.values()]);
    const evidence = deriveReviewEvidence(accuracyModel);
    expect(evidence.displayLabel.toLowerCase()).not.toContain('legacy');
    expect(accuracyModel.accuracyModelVersion).toBe('accuracy-model-v5-action-forced-2026-09-22');
    expect(ACCURACY_MODEL_VERSION).toBe('accuracy-model-v5-action-forced-2026-09-22');
    expect(LOSS_BAND_BOUNDARIES.bestTolerance).toBeCloseTo(0.13, 10);
    expect(LOSS_BAND_BOUNDARIES.inaccuracyToMistake).toBe(0.79);
    expect(LOSS_BAND_BOUNDARIES.mistakeToBlunder).toBe(5.98);
    if (accuracyModel.status === 'partial') {
      expect(accuracyModel.grade).toBeNull();
      expect(accuracyModel.accuracy).not.toBeNull();
    }
    if (accuracyModel.status === 'complete') {
      expect(accuracyModel.grade).not.toBeNull();
      expect(accuracyModel.accuracy).not.toBeNull();
    }

    const analyzedMoves = snapshots.map((s, i) => analyzedFromSnapshot(s, i + 1));
    const decisionIdByMoveNumber = new Map(
      snapshots.map((s, i) => [i + 1, s.identifiers.decisionId] as const),
    );

    const ledger = buildPlayerDecisionLedger({
      analyzedMoves,
      decisionIdByMoveNumber,
      resultsByDecisionId,
      errorsByDecisionId,
      pendingDecisionIds: new Set(),
      batchDone: true,
    });
    expect(ledger.totalDecisions).toBe(analyzedMoves.length);
    expect(
      ledger.scoredCount + ledger.estimateCount + ledger.forcedCount + ledger.unavailableCount,
    ).toBe(ledger.totalDecisions);
    expect(formatDecisionAccountingSummary(ledger)).toMatch(/total decisions/);

    for (const evaluation of resultsByDecisionId.values()) {
      if (evaluation.evidence.source !== 'heuristic') continue;
      if (isForcedDecision(evaluation.candidates)) continue;
      const classification = classifyHeuristicResult(evaluation);
      expect(['estimate', 'unclear']).toContain(classification.kind);
      const record = buildReviewPresentationRecord(evaluation, null);
      expect(assertPresentationConsistency(record, 'Best move.')).toEqual([]);
    }

    const analysis: GameAnalysis = {
      ...analyzeMoveLog([]),
      analyzedMoves,
      hands: [],
      accuracyModel,
      evidence,
    };

    render(
      <GameReviewer
        open
        onClose={vi.fn()}
        analysis={analysis}
        reviewWorkerBatch={{
          resultsByDecisionId,
          errorsByDecisionId: new Map(),
          pendingDecisionIds: new Set(),
          done: true,
        }}
        decisionIdByMoveNumber={decisionIdByMoveNumber}
        title="Pipeline review"
      />,
    );

    expect(screen.getByText(/Review Engine analysis/i)).toBeInTheDocument();
    expect(screen.queryByText(/Legacy heuristic estimate/i)).not.toBeInTheDocument();

    const list = screen.getByRole('listbox', { name: /Moves in selected hand/i });
    const rows = within(list).getAllByRole('option');
    expect(rows).toHaveLength(analyzedMoves.length);
    expect(within(rows[0]!).getByText('#1')).toBeInTheDocument();
    expect(within(rows[rows.length - 1]!).getByText(`#${rows.length}`)).toBeInTheDocument();

    const artifact = buildGameReviewReplayArtifact({
      analysis,
      evaluationsByDecisionId: resultsByDecisionId,
      decisionIdByMoveNumber,
      snapshotsByDecisionId: new Map(snapshots.map((s) => [s.identifiers.decisionId, s])),
      enablePositionalExplanations: false,
    });
    const hydrated = hydrateHistoricalGameReview({
      id: 'pipeline-test',
      evaluations: [...resultsByDecisionId.values()],
      accuracyModelResult: accuracyModel as unknown as Record<string, unknown>,
      replayArtifact: artifact,
      source: 'client-asserted',
    });
    expect(hydrated.hasReplayArtifact).toBe(true);
    expect(hydrated.analysis.evidence?.displayLabel).toBe(evidence.displayLabel);
    expect(hydrated.analysis.accuracyModel?.accuracyModelVersion).toBe(accuracyModel.accuracyModelVersion);
    expect(hydrated.decisionIdByMoveNumber.size).toBe(decisionIdByMoveNumber.size);
    expect(hydrated.legacyNotice).toBeNull();
  });
});
