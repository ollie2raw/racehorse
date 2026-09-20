import type { ReviewEvaluationV1, ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import type { GameAccuracyModelResult } from '@racehorse/review-engine';
import { computeGameDigest } from './gameDigest';

export type MultiplayerReviewWriteBody = {
  readonly gameDigest: string;
  readonly reviewEngineVersion: string;
  readonly accuracyModelVersion: string;
  readonly evaluations: readonly ReviewEvaluationV1[];
  readonly accuracyModelResult: GameAccuracyModelResult;
  readonly mode: 'multiplayer';
  readonly sourceMatchId: string;
};

export function persistMultiplayerReview(input: {
  readonly enabled: boolean;
  readonly snapshots: readonly ReviewPositionSnapshotV2[];
  readonly evaluations: readonly ReviewEvaluationV1[];
  readonly accuracyModelResult: GameAccuracyModelResult;
  readonly sourceMatchId: string;
  readonly write: (body: MultiplayerReviewWriteBody) => void | Promise<void>;
}): void {
  if (!input.enabled || input.snapshots.length === 0 || input.evaluations.length === 0) return;

  const body: MultiplayerReviewWriteBody = {
    gameDigest: computeGameDigest(input.snapshots),
    reviewEngineVersion: input.evaluations[0].reviewEngineVersion,
    accuracyModelVersion: input.accuracyModelResult.accuracyModelVersion,
    evaluations: input.evaluations,
    accuracyModelResult: input.accuracyModelResult,
    mode: 'multiplayer',
    sourceMatchId: input.sourceMatchId,
  };

  // Persistence is observability/storage only. Never let a rejected request
  // affect the already-completed multiplayer result or local review UI.
  void Promise.resolve().then(() => input.write(body)).catch(() => {});
}
