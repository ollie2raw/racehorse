-- A verified match gets one Ghost rating outcome. The profile row lock
-- serializes independent matches for the same player. Existing game rows are
-- treated as already applied because their historical rating cannot be
-- reconstructed safely from the current profile.
begin;

alter table public.ghost_games
  add column if not exists rating_before integer null,
  add column if not exists rating_after integer null,
  add column if not exists rating_delta integer null,
  add column if not exists rating_applied_at timestamptz null;

-- Add the per-player arbiter first. Keep the old global match_id uniqueness
-- until the replacement server is deployed; old code still uses
-- on_conflict=match_id. The follow-up migration removes the old constraint.
create unique index if not exists ghost_games_user_match_idx
  on public.ghost_games (user_id, match_id) where match_id is not null;

update public.ghost_games
   set rating_applied_at = played_at
 where rating_applied_at is null and match_id is not null;

create or replace function public.complete_ghost_rating_v2(
  p_user_id uuid, p_match_id uuid, p_final_score integer,
  p_opponent_score integer, p_move_log jsonb, p_mode text,
  p_opponent_rating integer, p_apply_rating boolean
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_profile public.ghost_profiles%rowtype;
  v_game public.ghost_games%rowtype;
  v_inserted boolean := false;
  v_k integer;
  v_expected double precision;
  v_margin double precision;
  v_multiplier double precision;
  v_actual double precision;
  v_delta integer := 0;
  v_new_rating integer;
begin
  if p_match_id is null or p_mode not in ('ghost','fritz')
     or p_final_score < 0 or p_opponent_score < 0
     or jsonb_typeof(p_move_log) <> 'array' then
    raise exception 'ghost_invalid_completion';
  end if;

  insert into public.ghost_profiles (user_id) values (p_user_id)
    on conflict (user_id) do nothing;
  select * into v_profile from public.ghost_profiles
    where user_id = p_user_id for update;

  insert into public.ghost_games
    (user_id,match_id,final_score,opponent_score,move_log)
  values (p_user_id,p_match_id,p_final_score,p_opponent_score,p_move_log)
  on conflict (user_id,match_id) where match_id is not null
    do nothing returning * into v_game;
  v_inserted := found;
  if not v_inserted then
    select * into v_game from public.ghost_games
     where user_id = p_user_id and match_id = p_match_id;
    if v_game.user_id <> p_user_id or v_game.final_score <> p_final_score
       or v_game.opponent_score <> p_opponent_score then
      raise exception 'ghost_match_conflict';
    end if;
    if v_game.rating_applied_at is not null then
      return jsonb_build_object(
        'isNewGame',false,
        'newRating',coalesce(v_game.rating_after,v_profile.ghost_rating),
        'ratingDelta',coalesce(v_game.rating_delta,0),
        'gamesPlayed',v_profile.games_played
      );
    end if;
  end if;

  v_new_rating := v_profile.ghost_rating;
  if p_apply_rating and greatest(p_final_score,p_opponent_score) >= 10
     and p_opponent_rating is not null then
    if p_mode = 'fritz' then
      v_k := case when v_profile.games_played < 20 then 40
                  when v_profile.games_played < 50 then 32 else 20 end;
    else
      v_k := case when v_profile.games_played < 10 then 40
                  when v_profile.games_played < 30 then 32 else 20 end;
    end if;
    v_expected := 1.0 / (1.0 + power(10.0,
      (p_opponent_rating - v_profile.ghost_rating)::double precision / 400.0));
    v_margin := abs(p_final_score - p_opponent_score)::double precision /
      greatest(1,p_final_score + p_opponent_score);
    v_multiplier := ln(v_margin * 10.0 + 1.0) / ln(11.0) + 0.5;
    v_actual := case when p_final_score > p_opponent_score then 1.0 else 0.0 end;
    v_delta := floor(v_k * (v_actual - v_expected) * v_multiplier + 0.5)::integer;
    v_new_rating := v_profile.ghost_rating + v_delta;
    update public.ghost_profiles
       set ghost_rating = v_new_rating,
           games_played = games_played + 1,
           last_updated = now()
     where user_id = p_user_id;
  end if;

  update public.ghost_games
     set rating_before = v_profile.ghost_rating,
         rating_after = v_new_rating,
         rating_delta = v_delta,
         rating_applied_at = now()
   where id = v_game.id;
  return jsonb_build_object(
    'isNewGame',v_inserted,'newRating',v_new_rating,
    'ratingDelta',v_delta,
    'gamesPlayed',v_profile.games_played + case when p_apply_rating and
      greatest(p_final_score,p_opponent_score) >= 10 and p_opponent_rating is not null
      then 1 else 0 end
  );
end $$;

revoke execute on function public.complete_ghost_rating_v2(uuid,uuid,integer,integer,jsonb,text,integer,boolean)
  from public,anon,authenticated;
grant execute on function public.complete_ghost_rating_v2(uuid,uuid,integer,integer,jsonb,text,integer,boolean)
  to service_role;

commit;
