import { randomUUID } from 'crypto';
import { supabaseFetch } from '../supabaseUtils';
import {
  GAME_OVER_PERSIST_MAX_ATTEMPTS,
  GAME_OVER_PERSIST_RETRY_DELAYS_MS,
} from '../multiplayer/gameOverPersistPolicy';
import type { MatchmakingMatchRecord, QueuedPlayer } from './types';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Thrown when matchmaking_matches insert cannot be proven after bounded retries (M2). */
export class MatchStartPersistError extends Error {
  readonly cause: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'MatchStartPersistError';
    this.cause = cause;
  }
}

/**
 * Insert a new `in_progress` row into matchmaking_matches.
 * Returns the locally-constructed record (with the generated id) so callers
 * can attach it to the in-memory room.
 *
 * Sim matches stay local-only (synthetic userIds). Human matches retry with
 * the same bounded attempt/delay ceiling as game-over persist, then throw —
 * callers must not emit queue:matched or keep an orphan room (M1/M2).
 */
export async function recordMatchStart(params: {
  roomCode: string;
  a: QueuedPlayer;
  b: QueuedPlayer;
}): Promise<MatchmakingMatchRecord> {
  const id = randomUUID();
  const startedAt = new Date().toISOString();
  // Sim players have synthetic userIds (`sim:<uuid>`) that don't exist in auth.users.
  // Skip DB persistence in that case — sim matches are intentionally not recorded.
  const isSim = params.a.isSim || params.b.isSim;
  const record: MatchmakingMatchRecord = {
    id,
    roomCode: params.roomCode,
    playerAId: params.a.userId,
    playerBId: params.b.userId,
    playerARating: params.a.rating,
    playerBRating: params.b.rating,
    status: 'in_progress',
    winnerId: null,
    playerARatingChange: null,
    playerBRatingChange: null,
    isSim,
    startedAt,
    endedAt: null,
  };

  if (isSim) return record;

  let lastErr: unknown;
  for (let attempt = 0; attempt < GAME_OVER_PERSIST_MAX_ATTEMPTS; attempt++) {
    const delayMs = GAME_OVER_PERSIST_RETRY_DELAYS_MS[attempt] ?? 0;
    if (delayMs > 0) {
      await sleep(delayMs);
    }
    try {
      await supabaseFetch('/rest/v1/matchmaking_matches', {
        method: 'POST',
        body: JSON.stringify({
          id,
          room_code: params.roomCode,
          player_a_id: params.a.userId,
          player_b_id: params.b.userId,
          player_a_rating: params.a.rating,
          player_b_rating: params.b.rating,
          status: 'in_progress',
          is_sim: false,
          started_at: startedAt,
        }),
      });
      return record;
    } catch (err) {
      lastErr = err;
    }
  }

  throw new MatchStartPersistError(
    'matchmaking_match_start_persist_failed',
    lastErr,
  );
}

/**
 * Patch a matchmaking_matches row to its terminal state.
 * Sim matches (id local-only) are no-ops since they were never inserted.
 */
export async function recordMatchEnd(params: {
  matchId: string;
  status: 'completed' | 'abandoned' | 'forfeit';
  winnerId: string | null;
  playerARatingChange: number | null;
  playerBRatingChange: number | null;
  isSim?: boolean;
}): Promise<void> {
  if (params.isSim) return;
  const endedAt = new Date().toISOString();
  try {
    // MP-G4 / MP-G5 (matchmaking half): conditional on `status=eq.in_progress`
    // so the FIRST terminal write wins. A later game-over / forfeit / cleanup
    // call for the same match updates 0 rows and is a harmless no-op — it can
    // no longer overwrite the recorded winner or rating delta. (The private
    // `room_match_logs` half of MP-G5 is Tier C and untouched.)
    await supabaseFetch(
      `/rest/v1/matchmaking_matches?id=eq.${encodeURIComponent(params.matchId)}&status=eq.in_progress`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          status: params.status,
          winner_id: params.winnerId,
          player_a_rating_change: params.playerARatingChange,
          player_b_rating_change: params.playerBRatingChange,
          ended_at: endedAt,
        }),
      },
    );
  } catch (err) {
    console.warn('[matchmaking] recordMatchEnd failed', err instanceof Error ? err.message : err);
  }
}
