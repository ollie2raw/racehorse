import type { Room } from '../rooms';

/** Initial attempt + retries. Total wall time ≈ sum of delays below. */
export const GAME_OVER_PERSIST_MAX_ATTEMPTS = 4;

/** Delay before attempt index 0..3 (ms). Attempt 0 is immediate. */
export const GAME_OVER_PERSIST_RETRY_DELAYS_MS = [0, 400, 1200, 2800] as const;

/** Shown to both seats after the persist retry ceiling. */
export const MATCH_RESULT_PERSIST_FAILED_MESSAGE =
  "Match finished, but the result couldn't be saved. Ratings may not update.";

/** Tournament seats after applyMatchResult exhausts the same retry ceiling. */
export const TOURNAMENT_RESULT_PERSIST_FAILED_MESSAGE =
  "Match finished, but the tournament result couldn't be saved. The bracket may not advance — hang tight or contact support.";

/** Rematch ack while persist is still in flight / retrying (R1). */
export const MATCH_RESULT_STILL_SAVING_MESSAGE =
  "Result still saving — rematch isn't available yet.";

export type GameOverPersistStatus = 'idle' | 'pending' | 'succeeded' | 'failed';

export type GameOverPersistOutcome = 'succeeded' | 'failed';

export function markGameOverPersistSucceeded(room: Room): void {
  room.matchLogged = true;
  room.gameOverPersistStatus = 'succeeded';
}

export function markGameOverPersistPending(room: Room): void {
  room.gameOverPersistStatus = 'pending';
}

export function markGameOverPersistFailed(room: Room): void {
  room.gameOverPersistStatus = 'failed';
  // Intentionally leave matchLogged false so a future rematch/reset is honest
  // and we never pretend the result was durably recorded.
}
