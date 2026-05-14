import { randomUUID } from 'crypto';
import { supabaseFetch } from '../supabaseUtils';
import type { MatchmakingMatchRecord, QueuedPlayer } from './types';

/**
 * Insert a new `in_progress` row into matchmaking_matches.
 * Returns the locally-constructed record (with the generated id) so callers
 * can attach it to the in-memory room. Persistence failures are swallowed
 * with a console.warn — the match itself still plays.
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
  } catch (err) {
    console.warn('[matchmaking] recordMatchStart failed', err instanceof Error ? err.message : err);
  }

  return record;
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
    await supabaseFetch(
      `/rest/v1/matchmaking_matches?id=eq.${encodeURIComponent(params.matchId)}`,
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
