-- EXPAND. A verified match gets one Ghost rating outcome. The old server
-- writes ghost_games and ghost_profiles in separate requests, so a legacy row
-- cannot prove whether its rating was applied. Fence those direct writes at
-- the database boundary before the new server is deployed. Existing rows
-- remain explicitly unresolved; never infer their rating from a NULL marker.
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

create or replace function public.enforce_ghost_rating_writer_v2()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if current_setting('racehorse.ghost_rating_v2', true) = 'on' then
    return new;
  end if;
  if tg_table_name = 'ghost_games' then
    raise exception 'ghost_legacy_writer_fenced';
  end if;
  if tg_op = 'INSERT' then
    if new.ghost_rating <> 800 or new.games_played <> 0 then
      raise exception 'ghost_legacy_writer_fenced';
    end if;
  elsif new.ghost_rating is distinct from old.ghost_rating or
        new.games_played is distinct from old.games_played then
    raise exception 'ghost_legacy_writer_fenced';
  end if;
  return new;
end $$;

drop trigger if exists ghost_games_writer_v2_gate on public.ghost_games;
create trigger ghost_games_writer_v2_gate before insert or update on public.ghost_games
  for each row execute function public.enforce_ghost_rating_writer_v2();
drop trigger if exists ghost_profiles_rating_v2_gate on public.ghost_profiles;
create trigger ghost_profiles_rating_v2_gate before insert or update on public.ghost_profiles
  for each row execute function public.enforce_ghost_rating_writer_v2();
revoke execute on function public.enforce_ghost_rating_writer_v2() from public,anon,authenticated;

-- The old Fritz HTTP path defers its Ghost training write and could otherwise
-- mark a verified match completed after the fenced write failed. The Ghost
-- route's result has ghostScore + newRating; Daily Fritz finalization uses a
-- different result contract and is deliberately outside this guard.
create or replace function public.require_ghost_receipt_for_verified_completion_v2()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_becoming_completed boolean;
begin
  if tg_op = 'INSERT' then
    v_becoming_completed := new.status = 'completed';
  else
    v_becoming_completed := new.status = 'completed' and old.status is distinct from 'completed';
  end if;
  if v_becoming_completed and
     jsonb_typeof(new.completion_result) = 'object' and
     new.completion_result ? 'ghostScore' and
     new.completion_result ? 'newRating' and
     not exists (
       select 1 from public.ghost_games
        where user_id = new.user_id and match_id = new.match_id
          and rating_applied_at is not null
     ) then
    raise exception 'ghost_legacy_writer_fenced';
  end if;
  return new;
end $$;
drop trigger if exists verified_ghost_completion_v2_gate on public.verified_single_player_matches;
create trigger verified_ghost_completion_v2_gate
  before insert or update on public.verified_single_player_matches
  for each row execute function public.require_ghost_receipt_for_verified_completion_v2();
revoke execute on function public.require_ghost_receipt_for_verified_completion_v2()
  from public,anon,authenticated;

-- Old Fritz writes the ranked result before its deferred Ghost training
-- write. A verified Fritz result needs the new atomic Ghost receipt first.
-- Fritz abandons use a different source and are unaffected.
create or replace function public.require_ghost_receipt_for_fritz_ranked_v2()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.game_type = 'fritz' and new.source_type = 'verified_single_player'
     and new.source_match_id is not null and not exists (
       select 1 from public.ghost_games
        where user_id = new.player_id and match_id = new.source_match_id
          and rating_applied_at is not null
     ) then
    raise exception 'ghost_legacy_writer_fenced';
  end if;
  return new;
end $$;
drop trigger if exists ranked_fritz_ghost_receipt_v2_gate on public.ranked_games;
create trigger ranked_fritz_ghost_receipt_v2_gate before insert on public.ranked_games
  for each row execute function public.require_ghost_receipt_for_fritz_ranked_v2();
revoke execute on function public.require_ghost_receipt_for_fritz_ranked_v2()
  from public,anon,authenticated;

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

  -- Transaction-local permission for this one atomic writer. It does not
  -- survive the PostgREST RPC transaction or authorize an old HTTP request.
  perform set_config('racehorse.ghost_rating_v2', 'on', true);

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
    if v_game.rating_applied_at is null then
      -- This is a pre-cutover row. The old writer may or may not have reached
      -- its separate profile update. An automatic retry would either double
      -- rate or silently discard a valid result, so require reconciliation.
      raise exception 'ghost_legacy_completion_ambiguous';
    end if;
    return jsonb_build_object(
      'isNewGame',false,
      'newRating',v_game.rating_after,
      'ratingDelta',v_game.rating_delta,
      'gamesPlayed',v_profile.games_played
    );
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
