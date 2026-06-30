-- Migration to consolidate Glicko rating updates into a single atomic transaction.
-- This prevents database corruption/inconsistencies if the server crashes mid-write.

create or replace function public.commit_glicko_game_update(
  p_profile_id uuid,
  p_glicko_rating double precision,
  p_glicko_rd double precision,
  p_glicko_vol double precision,
  p_glicko_last_period timestamp with time zone,
  p_provisional boolean,
  p_peak_rating double precision,
  p_ranked_games_played integer,
  p_game_id uuid,
  p_delta double precision,
  p_rating_before double precision,
  p_rd_before double precision,
  p_vol_before double precision
)
returns void
language plpgsql
security definer
as $$
begin
  -- 1. Update user profile stats
  update public.profiles
  set
    glicko_rating = p_glicko_rating,
    glicko_rd = p_glicko_rd,
    glicko_vol = p_glicko_vol,
    glicko_last_period = p_glicko_last_period,
    provisional = p_provisional,
    peak_rating = p_peak_rating,
    ranked_games_played = p_ranked_games_played
  where id = p_profile_id;

  -- 2. Update the target ranked game record
  update public.ranked_games
  set
    rating_after = p_glicko_rating,
    rd_after = p_glicko_rd,
    delta = p_delta
  where id = p_game_id;

  -- 3. Insert historical rating period log
  insert into public.rating_periods (
    user_id,
    rating_before,
    rating_after,
    rd_before,
    rd_after,
    vol_before,
    vol_after,
    processed_at
  ) values (
    p_profile_id,
    p_rating_before,
    p_glicko_rating,
    p_rd_before,
    p_glicko_rd,
    p_vol_before,
    p_glicko_vol,
    p_glicko_last_period
  );
end;
$$;
