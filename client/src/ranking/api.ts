import { supabase } from '../lib/supabase';
import { resolveGameServerUrl } from '../lib/gameServerUrl';

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
  try {
    if (!supabase) {
      return { data: null, error: 'Supabase not configured.' };
    }

    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();
    if (sessionError) {
      throw sessionError;
    }
    const accessToken = session?.access_token;
    if (!accessToken) {
      return { data: null, error: 'You must be signed in to view rating history.' };
    }

    const response = await fetch(`${resolveGameServerUrl()}/api/ranking/history/${encodeURIComponent(userId)}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      credentials: 'include',
    });
    const body = (await response.json()) as RatingHistoryResponse & { error?: string; ok?: boolean };
    if (!response.ok) {
      throw new Error(body.error || 'Failed to fetch rating history.');
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
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}
