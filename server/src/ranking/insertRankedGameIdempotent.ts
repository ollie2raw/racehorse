import { supabaseFetch } from '../supabaseUtils';
import {
  buildRankedGameInsertPayload,
  isRankedGameSourceColumnsEnabled,
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
};

export type InsertRankedGameResult =
  | { isNew: true; game: InsertedRankedGameRow }
  | { isNew: false; game: null };

function hasIdempotentSource(input: RankedGameInsertInput): boolean {
  const sourceMatchId = input.source?.sourceMatchId?.trim();
  return isRankedGameSourceColumnsEnabled() && Boolean(sourceMatchId);
}

/**
 * Inserts a ranked_games row idempotently when source columns are enabled.
 * ON CONFLICT (player_id, source_match_id) DO NOTHING — empty response means duplicate.
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
