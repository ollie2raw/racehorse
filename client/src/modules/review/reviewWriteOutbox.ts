import {
  createDurableOutbox,
  type OutboxEntry,
  type OutboxFlushResult,
  type OutboxSendResult,
} from './durableOutbox.ts';

/**
 * Durable outbox for the finished-review save (`POST /api/game-reviews`).
 *
 * The save used to be one fire-and-forget request from a React effect: close the tab, background the phone or hit one
 * transient error and the finished review was never written to the player's history. Now the body is parked here
 * first (localStorage, bound to the signed-in account), sent with backoff while the page is open, and sent again on
 * the next app load, when the device comes back online, or when the tab becomes visible. The server write is
 * idempotent (by game digest), so a retry or a double send is always safe.
 *
 * This is the same shape as a chess.com game save: the game is stored first, delivery is retried until it lands.
 */

export const REVIEW_WRITE_OUTBOX_KEY = 'racehorse_review_write_outbox_v1';
/** Keep the newest few: a replay artifact is large and localStorage is small. */
export const REVIEW_WRITE_OUTBOX_MAX_ENTRIES = 3;
export const REVIEW_WRITE_OUTBOX_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Delay before the Nth automatic retry while the page stays open (then it waits for the next load / online event). */
export const REVIEW_WRITE_RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 45_000, 120_000] as const;

/**
 * All the outbox needs to know about a queued body: its game digest (the key). Deliberately not the full review type, so
 * this module (which the auth layer imports to clear it on account change) never depends back on the review modules.
 */
export type ReviewWriteBodyBase = { readonly gameDigest: string };

export type ReviewWriteOutboxEntry = OutboxEntry<ReviewWriteBodyBase>;
export type ReviewWriteSendResult = OutboxSendResult;
export type ReviewWriteSender<T extends ReviewWriteBodyBase = ReviewWriteBodyBase> = (body: T) => Promise<ReviewWriteSendResult>;
export type ReviewWriteFlushResult = OutboxFlushResult;

const outbox = createDurableOutbox<ReviewWriteBodyBase>({
  storageKey: REVIEW_WRITE_OUTBOX_KEY,
  maxEntries: REVIEW_WRITE_OUTBOX_MAX_ENTRIES,
  maxAgeMs: REVIEW_WRITE_OUTBOX_MAX_AGE_MS,
  keyOf: (body) => body.gameDigest,
});

export function listReviewWriteOutbox(now = Date.now()): ReviewWriteOutboxEntry[] {
  return outbox.list(now);
}

export function enqueueReviewWrite(userId: string, body: ReviewWriteBodyBase, now = Date.now()): ReviewWriteOutboxEntry {
  return outbox.enqueue(userId, body, now);
}

export function removeReviewWrite(key: string, now = Date.now()): void {
  outbox.remove(key, now);
}

/** Account switch / sign-out: drop what belongs to the previous account. */
export function clearReviewWriteOutbox(userId?: string): void {
  outbox.clear(userId);
}

/** Send everything queued for `userId`. One flush at a time; a second caller shares the first's result. */
export function flushReviewWriteOutbox<T extends ReviewWriteBodyBase = ReviewWriteBodyBase>(
  userId: string,
  send: ReviewWriteSender<T>,
): Promise<ReviewWriteFlushResult> {
  return outbox.flush(userId, send as ReviewWriteSender);
}

/** Test seam. */
export function resetReviewWriteOutboxForTests(): void {
  outbox.resetForTests();
}
