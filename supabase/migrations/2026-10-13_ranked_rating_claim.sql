-- Claim the game and expected profile version in the same transaction.
-- Existing history rows lack a game key; the new nullable key applies to all
-- future writes without rewriting historical ratings.
begin;

alter table public.rating_periods add column if not exists ranked_game_id uuid null;
create unique index if not exists rating_periods_one_per_ranked_game_idx
  on public.rating_periods (ranked_game_id) where ranked_game_id is not null;

create or replace function public.commit_glicko_game_update(
  p_profile_id uuid,
  p_glicko_rating double precision,
  p_glicko_rd double precision,
  p_glicko_vol double precision,
  p_glicko_last_period timestamptz,
  p_provisional boolean,
  p_peak_rating double precision,
  p_ranked_games_played integer,
  p_game_id uuid,
  p_delta double precision,
  p_rating_before double precision,
  p_rd_before double precision,
  p_vol_before double precision
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_player_id uuid; v_rating_after double precision;
begin
  select player_id, rating_after into v_player_id, v_rating_after
    from public.ranked_games where id = p_game_id for update;
  if not found or v_player_id is distinct from p_profile_id then
    raise exception 'ranked_game_not_found';
  end if;
  if v_rating_after is not null then raise exception 'ranked_already_processed'; end if;

  update public.profiles
     set glicko_rating = p_glicko_rating,
         glicko_rd = p_glicko_rd,
         glicko_vol = p_glicko_vol,
         glicko_last_period = p_glicko_last_period,
         provisional = p_provisional,
         peak_rating = p_peak_rating,
         ranked_games_played = p_ranked_games_played
   where id = p_profile_id
     and glicko_rating = p_rating_before
     and glicko_rd = p_rd_before
     and glicko_vol = p_vol_before
     and ranked_games_played = p_ranked_games_played - 1;
  if not found then raise exception 'ranked_state_conflict'; end if;

  update public.ranked_games
     set rating_after = p_glicko_rating, rd_after = p_glicko_rd, delta = p_delta
   where id = p_game_id;

  insert into public.rating_periods (
    user_id, ranked_game_id, rating_before, rating_after,
    rd_before, rd_after, vol_before, vol_after, processed_at
  ) values (
    p_profile_id, p_game_id, p_rating_before, p_glicko_rating,
    p_rd_before, p_glicko_rd, p_vol_before, p_glicko_vol, p_glicko_last_period
  );
end $$;

-- The no-game decay sweep must also be conditional. A concurrent game commit
-- may change RD between the sweep's read and write.
create or replace function public.commit_glicko_decay_update(
  p_profile_id uuid, p_new_rd double precision, p_processed_at timestamptz,
  p_rating_before double precision, p_rd_before double precision,
  p_vol_before double precision, p_games_before integer
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.profiles
     set glicko_rd = p_new_rd, glicko_last_period = p_processed_at
   where id = p_profile_id and glicko_rating = p_rating_before
     and glicko_rd = p_rd_before and glicko_vol = p_vol_before
     and ranked_games_played = p_games_before;
  if not found then raise exception 'ranked_state_conflict'; end if;
  insert into public.rating_periods (
    user_id, rating_before, rating_after, rd_before, rd_after,
    vol_before, vol_after, processed_at
  ) values (
    p_profile_id, p_rating_before, p_rating_before, p_rd_before, p_new_rd,
    p_vol_before, p_vol_before, p_processed_at
  );
end $$;

revoke execute on function public.commit_glicko_game_update(
  uuid,double precision,double precision,double precision,timestamptz,
  boolean,double precision,integer,uuid,double precision,double precision,
  double precision,double precision
) from public, anon, authenticated;
grant execute on function public.commit_glicko_game_update(
  uuid,double precision,double precision,double precision,timestamptz,
  boolean,double precision,integer,uuid,double precision,double precision,
  double precision,double precision
) to service_role;
revoke execute on function public.commit_glicko_decay_update(
  uuid,double precision,timestamptz,double precision,double precision,double precision,integer
) from public, anon, authenticated;
grant execute on function public.commit_glicko_decay_update(
  uuid,double precision,timestamptz,double precision,double precision,double precision,integer
) to service_role;

commit;
