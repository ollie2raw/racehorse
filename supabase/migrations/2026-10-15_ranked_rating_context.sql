-- Expand first. NULL preserves historical/old-writer full-weight semantics.
-- New writers persist treatment + outcome + opponent snapshot before rating.
-- Old RPC callers may process NULL rows but cannot misinterpret new contexts.
begin;

alter table public.ranked_games add column if not exists rating_context jsonb;
alter table public.ranked_games add constraint ranked_games_rating_context_valid check (
  rating_context is null or case
    when jsonb_typeof(rating_context) = 'object'
      and jsonb_typeof(rating_context->'opponent') = 'object'
      and jsonb_typeof(rating_context->'opponent'->'rating') = 'number'
      and jsonb_typeof(rating_context->'opponent'->'rd') = 'number'
    then
      rating_context ?& array['version','treatment','outcome','opponent']
      and rating_context->'version' = '1'::jsonb
      and rating_context->>'treatment' in ('standard', 'disconnect_forfeit')
      and rating_context->>'outcome' in ('win', 'loss', 'draw')
      and outcome is not null and rating_context->>'outcome' = outcome
      and rating_context - array['version','treatment','outcome','opponent'] = '{}'::jsonb
      and (rating_context->'opponent') - array['rating','rd'] = '{}'::jsonb
      and abs((rating_context->'opponent'->>'rating')::numeric) <= 1.7976931348623157e308
      and (rating_context->'opponent'->>'rd')::numeric > 0
      and (rating_context->'opponent'->>'rd')::numeric <= 1.7976931348623157e308
    else false end
);

create function public.keep_ranked_rating_context_immutable() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.rating_context is distinct from old.rating_context
     or (old.rating_context is not null and new.outcome is distinct from old.outcome) then
    raise exception 'ranked_rating_context_immutable' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger ranked_rating_context_immutable before update on public.ranked_games
for each row execute function public.keep_ranked_rating_context_immutable();
revoke all on function public.keep_ranked_rating_context_immutable() from public, anon, authenticated;

-- Replace the existing signature atomically; the trailing default keeps old
-- positional/JSON RPC calls valid for legacy NULL rows. Do not leave overloads
-- with the same named arguments (PostgREST would find them ambiguous).
drop function public.commit_glicko_game_update(
  uuid,double precision,double precision,double precision,timestamptz,
  boolean,double precision,integer,uuid,double precision,double precision,
  double precision,double precision
);
create function public.commit_glicko_game_update(
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
  p_vol_before double precision,
  p_rating_context jsonb default null
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_player_id uuid; v_rating_after double precision; v_rating_context jsonb;
begin
  select player_id, rating_after, rating_context into v_player_id, v_rating_after, v_rating_context
    from public.ranked_games where id = p_game_id for update;
  if not found or v_player_id is distinct from p_profile_id then
    raise exception 'ranked_game_not_found';
  end if;
  if v_rating_after is not null then raise exception 'ranked_already_processed'; end if;
  if p_rating_context is distinct from v_rating_context then
    raise exception 'ranked_rating_context_mismatch';
  end if;

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
revoke all on function public.commit_glicko_game_update(
  uuid,double precision,double precision,double precision,timestamptz,
  boolean,double precision,integer,uuid,double precision,double precision,
  double precision,double precision,jsonb
) from public, anon, authenticated;
grant execute on function public.commit_glicko_game_update(
  uuid,double precision,double precision,double precision,timestamptz,
  boolean,double precision,integer,uuid,double precision,double precision,
  double precision,double precision,jsonb
) to service_role;
comment on column public.ranked_games.rating_context is
  'Immutable v1 treatment, authoritative outcome and opponent rating/RD snapshot. NULL retains historical full-weight interpretation; never backfill disconnects by guessing.';
notify pgrst, 'reload schema';
commit;
