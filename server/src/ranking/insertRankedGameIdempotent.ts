import { supabaseFetch } from '../supabaseUtils';
import type { MatchOutcome } from './glicko2';
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
function hasIdempotentSource(input: RankedGameInsertInput): boolean {
  return Boolean(input.source?.sourceMatchId?.trim());
}

/**
 * Inserts a ranked_games row idempotently when the input carries a sourceMatchId.
 * ON CONFLICT (player_id, source_match_id) DO NOTHING — empty response means duplicate.
 * A source-less insert (no sourceMatchId) falls back to a plain POST; the unique
 * index treats NULL source ids as non-conflicting, so on_conflict would be a no-op.
 */
export async function insertRankedGameIdempotent(
  input: RankedGameInsertInput,
): Promise<InsertRankedGameResult> {
  const payload = buildRankedGameInsertPayload(input);

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
  return { isNew: true, game };
}
