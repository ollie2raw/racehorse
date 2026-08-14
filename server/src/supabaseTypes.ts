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

export type BotMatchPendingRow = {
  id: string;
  user_id: string;
  room_code: string | null;
  fritz_tier: string | null;
  started_at: string;
  resolved: boolean;
  local_match_id: string | null;
};

export type LeagueMemberRow = {
  id: string;
  league_id: string;
  player_user_id: string;
  seed: number | null;
  joined_at: string;
  member_type: string | null;
};

export type FixtureRow = {
  id: string;
  league_id: string;
  matchday: number;
  home_member_id: string;
  away_member_id: string;
  status: string;
  home_score: number | null;
  away_score: number | null;
  live_room_code: string | null;
  played_at: string | null;
};

export type LeagueRow = {
  id: string;
  name: string;
  status: string;
  created_at: string;
};
