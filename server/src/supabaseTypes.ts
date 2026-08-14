/** Minimal Supabase row shapes used across multiple server modules. */

export type ProfileRow = {
  id: string;
  username: string | null;
  glicko_rating: number | null;
  glicko_rd: number | null;
  glicko_vol: number | null;
  glicko_last_period: string | null;
  ranked_games_played: number | null;
  peak_rating: number | null;
  provisional: boolean | null;
};

export type RankedGameRow = {
  id: string;
  player_id: string;
  opponent_id: string;
  player_score: number;
  opponent_score: number;
  played_at: string;
  rating_after: number | null;
  delta: number | null;
  game_type: string | null;
};
