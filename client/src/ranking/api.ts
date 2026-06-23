import { apiGet } from '../api/client';
import { supabase } from '../lib/supabase';

export type RatingHistoryGame = {
  played_at: string;
  rating_after: number;
  rd_after: number;
  delta: number;
  opponent_id: string;
  player_score: number;
  opponent_score: number;
  is_fritz: boolean;
};

export type RatingHistoryResponse = {
  games: RatingHistoryGame[];
  currentRating: number;
  peakRating: number;
  provisional: boolean;
  rd: number;
};

export async function fetchRatingHistory(
  userId: string,
): Promise<{ data: RatingHistoryResponse | null; error: string | null }> {
  if (!supabase) {
    return { data: null, error: 'Supabase not configured.' };
  }

  const result = await apiGet<RatingHistoryResponse & { error?: string }>(
    `/api/ranking/history/${encodeURIComponent(userId)}`,
  );
  if (result.error) {
    return { data: null, error: result.error };
  }
  const body = result.data;
  if (!body) {
    return { data: null, error: 'Failed to fetch rating history.' };
  }

  return {
    data: {
      games: Array.isArray(body.games) ? body.games : [],
      currentRating: Number(body.currentRating ?? 800),
      peakRating: Number(body.peakRating ?? body.currentRating ?? 800),
      provisional: Boolean(body.provisional),
      rd: Number(body.rd ?? 200),
    },
    error: null,
  };
}
