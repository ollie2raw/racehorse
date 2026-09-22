import type { ReviewEvaluationV1 } from '@racehorse/game-core/review';
import type { GameAnalysis } from '../../analyzer/moveAnalyzer';
import type { ReviewCoachingFacts, ReviewCoachingProse } from '../../analyzer/reviewCoachingFacts';
import type { ReviewBatchState } from './useReviewWorkerBatch';
import type { GameReviewReplayArtifactV1 } from './gameReviewReplayArtifact';
import { GAME_REVIEW_REPLAY_ARTIFACT_VERSION } from './gameReviewReplayArtifact';

export type HistoricalGameReviewHydration = {
  readonly reviewId: string;
  readonly analysis: GameAnalysis;
  readonly reviewWorkerBatch: ReviewBatchState;
  readonly decisionIdByMoveNumber: ReadonlyMap<number, string>;
  /** Pre-rendered coaching — GameReviewer must not rebuild facts/prose. */
  readonly historicalCoachingByDecisionId: ReadonlyMap<
    string,
    { readonly facts: ReviewCoachingFacts; readonly prose: ReviewCoachingProse }
  >;
  readonly hasReplayArtifact: boolean;
  readonly legacyNotice: string | null;
};

export type GameReviewReadPayload = {
  readonly id: string;
  readonly evaluations: readonly ReviewEvaluationV1[];
  readonly accuracyModelResult: Record<string, unknown>;
  readonly replayArtifact: GameReviewReplayArtifactV1 | null;
  readonly source: 'client-asserted';
};

/**
 * Hydrates GameReviewer inputs from a persisted review row without launching
 * workers or calling Fritz / buildReviewCoachingFacts.
 */
export function hydrateHistoricalGameReview(
  payload: GameReviewReadPayload,
): HistoricalGameReviewHydration {
  const evaluationsByDecisionId = new Map<string, ReviewEvaluationV1>();
  for (const evaluation of payload.evaluations) {
    evaluationsByDecisionId.set(evaluation.snapshotId, evaluation);
  }

  const reviewWorkerBatch: ReviewBatchState = {
    resultsByDecisionId: evaluationsByDecisionId,
    errorsByDecisionId: new Map(),
    pendingDecisionIds: new Set(),
    done: true,
  };

  const artifact = payload.replayArtifact;
  if (!artifact || artifact.artifactVersion !== GAME_REVIEW_REPLAY_ARTIFACT_VERSION) {
    // Legacy: evaluations only — show classification/navigation when analysis
    // cannot be reconstructed; caller should surface legacyNotice.
    return {
      reviewId: payload.id,
      analysis: {
        accuracy: 0,
        grade: 'D',
        analyzedAt: 0,
        analyzedMoves: [],
        timeline: [],
        hands: [],
        oracleMode: 'tier',
        tierPlayed: 'standard',
        oracleLabel: 'Legacy review',
        worstHandNumber: null,
        consequenceByMoveNumber: {},
        accuracyModel: payload.accuracyModelResult as GameAnalysis['accuracyModel'],
      },
      reviewWorkerBatch,
      decisionIdByMoveNumber: new Map(),
      historicalCoachingByDecisionId: new Map(),
      hasReplayArtifact: false,
      legacyNotice:
        'This older review was saved before replayable explanations were available.',
    };
  }

  const decisionIdByMoveNumber = new Map<number, string>();
  for (const entry of artifact.decisionIds) {
    decisionIdByMoveNumber.set(entry.moveNumber, entry.decisionId);
  }

  const historicalCoachingByDecisionId = new Map<
    string,
    { readonly facts: ReviewCoachingFacts; readonly prose: ReviewCoachingProse }
  >();
  for (const decision of artifact.decisions) {
    historicalCoachingByDecisionId.set(decision.decisionId, {
      facts: decision.coachingFacts,
      prose: decision.coachingProse,
    });
  }

  return {
    reviewId: payload.id,
    analysis: artifact.analysis,
    reviewWorkerBatch,
    decisionIdByMoveNumber,
    historicalCoachingByDecisionId,
    hasReplayArtifact: true,
    legacyNotice: null,
  };
}
