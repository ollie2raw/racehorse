import type { ReviewEvaluationV1 } from '@racehorse/game-core/review';
import type { GameAccuracyModelResult } from '@racehorse/review-engine';
import { apiPost } from '../../api/client.ts';
import { peekCachedSession } from '../../auth/sessionToken.ts';
import type { GameReviewReplayArtifactV1 } from './gameReviewReplayArtifact.ts';
import {
  REVIEW_WRITE_RETRY_DELAYS_MS,
  enqueueReviewWrite,
  flushReviewWriteOutbox,
  listReviewWriteOutbox,
  type ReviewWriteSendResult,
} from './reviewWriteOutbox.ts';

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

/** One send of a queued review. Idempotent on the server (by game digest), so repeating it is always safe. */
export async function sendReviewWrite(body: PostGameReviewWriteBody): Promise<ReviewWriteSendResult> {
  try {
    const result = await apiPost('/api/game-reviews', body);
    return result.error ? { ok: false, status: result.status } : { ok: true };
  } catch {
    // A thrown network failure is a transient failure like any other: keep it queued.
    return { ok: false };
  }
}

export const REVIEW_SAVE_PENDING_MESSAGE =
  "We couldn't save this review to your history yet. We'll keep trying in the background; you can close this screen.";

export const REVIEW_SAVE_REFUSED_MESSAGE = 'This review could not be saved to your history.';

/**
 * Save a finished review to the player's history. The body is parked in a durable outbox first, then sent with backoff
 * while the page is open; anything still unsent is sent again on the next app load, when the device comes back
 * online, or when the tab becomes visible (see `useReviewWriteOutboxFlush`). Gameplay never waits on this.
 *
 * `onFailure` fires on the first failed attempt (with copy that is true: it is still being retried) and `onSaved` once
 * the server has the review.
 */
export function postGameReviewWrite(
  body: PostGameReviewWriteBody,
  onFailure?: (message: string) => void,
  onSaved?: () => void,
): void {
  const userId = peekCachedSession()?.userId ?? null;
  // Signed out (or no session yet): there is no account to bind the queued save to, so do the single attempt only.
  if (!userId) {
    void sendReviewWrite(body).then((result) => { if (!result.ok) onFailure?.(REVIEW_SAVE_REFUSED_MESSAGE); else onSaved?.(); });
    return;
  }
  enqueueReviewWrite(userId, body);
  let announcedFailure = false;
  const attempt = (retryIndex: number): void => {
    void flushReviewWriteOutbox<PostGameReviewWriteBody>(userId, sendReviewWrite).then(({ remaining, refused }) => {
      if (refused.includes(body.gameDigest)) {
        onFailure?.(REVIEW_SAVE_REFUSED_MESSAGE);
        return;
      }
      const stillQueued = listReviewWriteOutbox().some((entry) => entry.key === body.gameDigest && entry.userId === userId);
      if (!stillQueued) {
        onSaved?.();
        return;
      }
      if (!announcedFailure) {
        announcedFailure = true;
        onFailure?.(REVIEW_SAVE_PENDING_MESSAGE);
      }
      const delay = REVIEW_WRITE_RETRY_DELAYS_MS[retryIndex];
      if (delay !== undefined && remaining > 0) setTimeout(() => attempt(retryIndex + 1), delay);
    });
  };
  attempt(0);
}
