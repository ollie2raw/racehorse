import { apiGet } from '../api/client';
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

export type LeaderboardEntry = {
  userId: string;
  username: string | null;
  glicko_rating: number;
  ranked_games_played: number;
};

export type LeaderboardResponse = {
  leaderboard: LeaderboardEntry[];
  leaderboard_load_failed?: boolean;
};

export async function fetchRankingLeaderboard(
  limit = 50,
): Promise<{ data: LeaderboardResponse | null; error: string | null }> {
  try {
    const res = await fetch(
      `${resolveGameServerUrl()}/api/ranking/leaderboard?limit=${limit}`,
    );
    if (!res.ok) {
      return { data: null, error: `HTTP ${res.status}` };
    }
    const body = (await res.json()) as LeaderboardResponse & { ok: boolean };
    if (body.leaderboard_load_failed) {
      return { data: { leaderboard: [], leaderboard_load_failed: true }, error: null };
    }
    return {
      data: { leaderboard: Array.isArray(body.leaderboard) ? body.leaderboard : [] },
      error: null,
    };
  } catch {
    return { data: null, error: 'Failed to load leaderboard.' };
  }
}

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
