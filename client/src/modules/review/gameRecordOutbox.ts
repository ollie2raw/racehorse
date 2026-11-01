import { createDurableOutbox, type OutboxFlushResult, type OutboxSendResult } from './durableOutbox.ts';

/**
 * Durable outbox for the saved game record (`POST /api/game-records`). Same guarantee as the review outbox: the
 * finished game is parked on the device first (bound to the signed-in account), then delivered until the server
 * answers 2xx, on this load, the next load, reconnect, or when the tab is visible again. The server save is
 * idempotent by (user, sourceMatchId), so repeats are always safe.
 *
 * Free of imports from the rest of the app on purpose: the auth layer imports it to clear it on account change.
 */

export const GAME_RECORD_OUTBOX_KEY = 'racehorse_game_record_outbox_v1';
/** A record is small (compact actions, no snapshots): keep more of them than reviews. */
export const GAME_RECORD_OUTBOX_MAX_ENTRIES = 10;
export const GAME_RECORD_OUTBOX_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
export const GAME_RECORD_RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 45_000, 120_000] as const;

export type GameRecordBodyBase = { readonly sourceMatchId: string };

const outbox = createDurableOutbox<GameRecordBodyBase>({
  storageKey: GAME_RECORD_OUTBOX_KEY,
  maxEntries: GAME_RECORD_OUTBOX_MAX_ENTRIES,
  maxAgeMs: GAME_RECORD_OUTBOX_MAX_AGE_MS,
  keyOf: (body) => body.sourceMatchId,
});

export const listGameRecordOutbox = outbox.list;
export const enqueueGameRecord = outbox.enqueue;
export const clearGameRecordOutbox = outbox.clear;
export const resetGameRecordOutboxForTests = outbox.resetForTests;

export function flushGameRecordOutbox<T extends GameRecordBodyBase = GameRecordBodyBase>(
  userId: string,
  send: (body: T) => Promise<OutboxSendResult>,
): Promise<OutboxFlushResult> {
  return outbox.flush(userId, send as (body: GameRecordBodyBase) => Promise<OutboxSendResult>);
}
