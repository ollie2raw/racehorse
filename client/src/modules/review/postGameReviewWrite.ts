import type { ReviewEvaluationV1 } from '@racehorse/game-core/review';
import type { GameAccuracyModelResult } from '@racehorse/review-engine';
import { apiPost } from '../../api/client.ts';
import type { GameReviewReplayArtifactV1 } from './gameReviewReplayArtifact.ts';

export type PostGameReviewWriteBody = {
  gameDigest: string;
  reviewEngineVersion: string;
  accuracyModelVersion: string;
  evaluations: readonly ReviewEvaluationV1[];
  accuracyModelResult: GameAccuracyModelResult;
  mode: 'pvf' | 'mp' | 'multiplayer';
  sourceMatchId?: string | null;
  /** F1e-5 Path A historical replay artifact (optional for legacy writes). */
  replayArtifact?: GameReviewReplayArtifactV1 | null;
};

/** Persist the player replay artifact; keep gameplay independent while reporting save failures. */
export function postGameReviewWrite(body: PostGameReviewWriteBody, onFailure?: (message: string) => void): void {
  void apiPost('/api/game-reviews', body)
    .then((result) => { if (result.error) onFailure?.('Your analysis could not be saved to history. Please keep this review open and try again later.'); })
    .catch(() => onFailure?.('Your analysis could not be saved to history. Please keep this review open and try again later.'));
}
