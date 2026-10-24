import { prepareRankedGameProfile, readRankedOpponentSnapshot } from './periodService';
import { supabaseFetch } from '../supabaseUtils';
import type { MatchOutcome } from './glicko2';
import { readRankedRatingContext } from './ratingContext';
import {
  buildRankedGameInsertPayload,
  type RankedGameInsertInput,
} from './rankedGamePayload';

export type InsertedRankedGameRow = {
  id: string;
  player_id: string;
  opponent_id: string;
  player_score: number;
  opponent_score: number;
  played_at: string;
  rating_after?: number | null;
  delta?: number | null;
  source_type?: string | null;
  source_match_id?: string | null;
  outcome?: MatchOutcome | null;
  rating_context?: unknown;
};

export type InsertRankedGameResult =
  | { isNew: true; game: InsertedRankedGameRow }
  | { isNew: false; game: null };

/**
 * True when the input carries a per-match idempotency key. The only path that
 * legitimately has none is completeGhostGame() called with a null matchId — see
 * buildRankedGameInsertPayload. RK-8: this used to also require a runtime flag;
 * that flag was deleted 2026-09-06 (HARDENING_PLAN.md §8.3).
 */
function hasIdempotentSource(input: Omit<RankedGameInsertInput, 'playerState'>): boolean {
  return Boolean(input.source?.sourceMatchId?.trim());
}

/**
 * Inserts a ranked_games row idempotently when the input carries a sourceMatchId.
 * ON CONFLICT (player_id, source_match_id) DO NOTHING — empty response means duplicate.
 * A source-less insert (no sourceMatchId) falls back to a plain POST; the unique
 * index treats NULL source ids as non-conflicting, so on_conflict would be a no-op.
 */
export async function insertRankedGameIdempotent(
  input: Omit<RankedGameInsertInput, 'playerState'>,
): Promise<InsertRankedGameResult> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try { return await insertPrepared(input); }
    catch (error) {
      if (attempt === 4 || !/ranked_predecessor_pending|ranked_snapshot_conflict/.test(String(error))) throw error;
    }
  }
  throw new Error('Ranked insert serialization exhausted');
}
async function insertPrepared(input: Omit<RankedGameInsertInput, 'playerState'>): Promise<InsertRankedGameResult> {
  const profile = await prepareRankedGameProfile(input.playerId);
  const opponent = await readRankedOpponentSnapshot(input.opponentId, input.source?.sourceMatchId);
  const payload = buildRankedGameInsertPayload({ ...input, ratingBefore: profile.glicko_rating, rdBefore: profile.glicko_rd,
    playerState: { rating: profile.glicko_rating, rd: profile.glicko_rd, vol: profile.glicko_vol,
      gamesPlayed: profile.ranked_games_played, peakRating: profile.peak_rating },
    opponentRating: opponent.rating, opponentRd: opponent.rd });

  if (!hasIdempotentSource(input)) {
    const rows = await supabaseFetch<InsertedRankedGameRow[]>('/rest/v1/ranked_games', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(payload),
    });
    const game = rows?.[0];
    if (!game) {
      return { isNew: false, game: null };
    }
    if (JSON.stringify(readRankedRatingContext(game.rating_context)) !== JSON.stringify(payload.rating_context)
      || game.outcome !== payload.outcome) throw new Error('Ranked insert did not return its authoritative rating context');
    return { isNew: true, game };
  }

  const rows = await supabaseFetch<InsertedRankedGameRow[]>(
    '/rest/v1/ranked_games?on_conflict=player_id,source_match_id',
    {
      method: 'POST',
      headers: {
        Prefer: 'return=representation,resolution=ignore-duplicates',
      },
      body: JSON.stringify(payload),
    },
  );

  const game = rows?.[0];
  if (!game) {
    return { isNew: false, game: null };
  }
  if (JSON.stringify(readRankedRatingContext(game.rating_context)) !== JSON.stringify(payload.rating_context)
    || game.outcome !== payload.outcome) throw new Error('Ranked insert did not return its authoritative rating context');
  return { isNew: true, game };
}
