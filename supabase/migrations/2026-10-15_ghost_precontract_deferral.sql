-- EXPAND (additive; NEW-only function; BRIDGE does not call it). Apply with the other expand
-- migrations, after 2026-10-13_ghost_rating_idempotent_completion.sql, BEFORE deploying NEW.
--
-- Mixed-version Ghost completion. Until 2026-10-13_ghost_user_match_uniqueness.sql runs, the
-- legacy global ghost_games_match_id_unique remains, so the SECOND account of one
-- human-vs-human match cannot insert its (user_id, match_id) Ghost row. Rather than failing the
-- whole multiplayer completion or dropping that seat's Ghost work, the RPC records the seat in
-- ghost_deferred_completions in the same transaction and returns the typed outcome
-- {"status":"deferred_legacy_match_uniqueness"}. After the Ghost contract the app drain
-- (server/src/ghost/deferredGhostCompletion.ts) replays each row through this same RPC, which
-- is idempotent per (user_id, match_id), then deletes it. Only the exact legacy-constraint
-- conflict is deferred; every other error is raised unchanged.
begin;

create table if not exists public.ghost_deferred_completions (
  user_id uuid not null references auth.users(id) on delete cascade,
  match_id uuid not null,
  final_score integer not null check (final_score >= 0),
  opponent_score integer not null check (opponent_score >= 0),
  move_log jsonb not null check (jsonb_typeof(move_log) = 'array'),
  mode text not null check (mode in ('ghost','fritz')),
  opponent_rating integer null,
  apply_rating boolean not null,
  reason text not null default 'legacy_match_uniqueness' check (reason = 'legacy_match_uniqueness'),
  created_at timestamptz not null default now(),
  attempts integer not null default 0,
  last_attempt_at timestamptz null,
  last_error text null,
  quarantined_at timestamptz null,
  primary key (user_id, match_id)
);
create index if not exists ghost_deferred_completions_scan_idx
  on public.ghost_deferred_completions (last_attempt_at nulls first, created_at)
  where quarantined_at is null;
alter table public.ghost_deferred_completions enable row level security;
revoke all on public.ghost_deferred_completions from public, anon, authenticated;
grant select, update, delete on public.ghost_deferred_completions to service_role;

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
  v_constraint text;
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

  begin
    insert into public.ghost_games
      (user_id,match_id,final_score,opponent_score,move_log)
    values (p_user_id,p_match_id,p_final_score,p_opponent_score,p_move_log)
    on conflict (user_id,match_id) where match_id is not null
      do nothing returning * into v_game;
    v_inserted := found;
  exception when unique_violation then
    -- PRE-CONTRACT ONLY. The legacy global ghost_games_match_id_unique is still
    -- present and ANOTHER account already holds this match's row: this is the
    -- second legitimate per-user completion of one human-vs-human match. Anything
    -- else (a different constraint, no sibling row) is a real error and re-raised.
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint is distinct from 'ghost_games_match_id_unique'
       or not exists (select 1 from public.ghost_games
                       where match_id = p_match_id and user_id <> p_user_id) then
      raise;
    end if;
    -- Durable handoff in the SAME transaction as this return: the seat is never
    -- neither-written-nor-pending. complete_ghost_rating_v2 (via the app drain)
    -- replays it exactly once after the contract migration removes the constraint.
    insert into public.ghost_deferred_completions
      (user_id,match_id,final_score,opponent_score,move_log,mode,opponent_rating,apply_rating)
    values (p_user_id,p_match_id,p_final_score,p_opponent_score,p_move_log,p_mode,
            p_opponent_rating,p_apply_rating)
    on conflict (user_id,match_id) do nothing;
    return jsonb_build_object('status','deferred_legacy_match_uniqueness',
                              'isNewGame',false,'deferred',true);
  end;
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

  delete from public.ghost_deferred_completions
   where user_id = p_user_id and match_id = p_match_id;

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
