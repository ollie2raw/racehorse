-- Expand first. NULL preserves historical/old-writer full-weight semantics.
-- New writers persist treatment + outcome + opponent snapshot before rating.
-- Old RPC callers may process NULL rows but cannot misinterpret new contexts.
begin;

alter table public.ranked_games add column if not exists rating_context jsonb;
-- NULL is historical; the unshipped intermediate shape is intentionally unsupported.
create or replace function public.valid_ranked_rating_context(c jsonb) returns boolean
language plpgsql immutable set search_path = public, pg_temp as $$
begin
  if c is null then return true; end if;
  if jsonb_typeof(c) <> 'object' or jsonb_typeof(c->'player') <> 'object'
     or jsonb_typeof(c->'opponent') <> 'object' then return false; end if;
  return coalesce(
    c ?& array['version','treatment','cause','outcome','player','opponent']
    and c - array['version','treatment','cause','outcome','player','opponent'] = '{}'::jsonb
    and c->'version' = '1'::jsonb
    and c->>'treatment' in ('standard','disconnect_forfeit')
    and c->>'cause' in ('completed','manual_forfeit','disconnect_timeout')
    and (c->>'treatment' = 'disconnect_forfeit') = (c->>'cause' = 'disconnect_timeout')
    and c->>'outcome' in ('win','loss','draw')
    and (c->>'cause' = 'completed' or c->>'outcome' <> 'draw')
    and (c->'player') ?& array['rating','rd','vol','gamesPlayed','peakRating']
    and (c->'player') - array['rating','rd','vol','gamesPlayed','peakRating'] = '{}'::jsonb
    and (c->'opponent') ?& array['rating','rd']
    and (c->'opponent') - array['rating','rd'] = '{}'::jsonb
    and jsonb_typeof(c->'player'->'rating') = 'number'
    and jsonb_typeof(c->'player'->'rd') = 'number'
    and jsonb_typeof(c->'player'->'vol') = 'number'
    and jsonb_typeof(c->'player'->'gamesPlayed') = 'number'
    and jsonb_typeof(c->'player'->'peakRating') = 'number'
    and jsonb_typeof(c->'opponent'->'rating') = 'number'
    and jsonb_typeof(c->'opponent'->'rd') = 'number'
    and abs((c->'player'->>'rating')::numeric) <= 10000
    and (c->'player'->>'rd')::numeric > 0 and (c->'player'->>'rd')::numeric <= 1000
    and (c->'player'->>'vol')::numeric > 0 and (c->'player'->>'vol')::numeric <= 1
    and abs((c->'player'->>'peakRating')::numeric) <= 10000
    and (c->'player'->>'gamesPlayed')::numeric between 0 and 2147483646
    and trunc((c->'player'->>'gamesPlayed')::numeric) = (c->'player'->>'gamesPlayed')::numeric
    and abs((c->'opponent'->>'rating')::numeric) <= 10000
    and (c->'opponent'->>'rd')::numeric > 0 and (c->'opponent'->>'rd')::numeric <= 1000, false);
exception when others then return false;
end $$;
alter table public.ranked_games drop constraint if exists ranked_games_rating_context_valid;
alter table public.ranked_games add constraint ranked_games_rating_context_valid check (
  public.valid_ranked_rating_context(rating_context) and (rating_context is null or
    (outcome is not null and rating_context->>'outcome' = outcome and
     (rating_context->>'cause' <> 'completed' or outcome = case when player_score > opponent_score then 'win'
       when player_score < opponent_score then 'loss' else 'draw' end)))
) not valid;

create or replace function public.keep_ranked_rating_context_immutable() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.rating_context is distinct from old.rating_context
     or (old.rating_context is not null and
       (new.outcome is distinct from old.outcome or new.player_id is distinct from old.player_id
        or new.opponent_id is distinct from old.opponent_id or new.player_score is distinct from old.player_score
        or new.opponent_score is distinct from old.opponent_score
        or new.played_at is distinct from old.played_at or new.source_match_id is distinct from old.source_match_id
        or new.source_type is distinct from old.source_type or new.game_type is distinct from old.game_type)) then
    raise exception 'ranked_rating_context_immutable' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists ranked_rating_context_immutable on public.ranked_games;
create trigger ranked_rating_context_immutable before update on public.ranked_games
for each row execute function public.keep_ranked_rating_context_immutable();

-- One pending game per owner. Lock ordering serializes admission with both
-- game commit and decay. A successor is admitted only after its predecessor
-- is applied, never by silently rebasing a persisted historical calculation.
create or replace function public.admit_ranked_rating_context() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare p public.profiles%rowtype; expected jsonb;
begin
  if new.rating_context is null then return new; end if;
  if not public.valid_ranked_rating_context(new.rating_context) then
    raise exception 'ranked_games_rating_context_valid' using errcode = '23514';
  end if;
  select * into p from public.profiles where id=new.player_id for update;
  if not found then raise exception 'ranked_profile_not_found'; end if;
  -- BEFORE INSERT also runs on ignored duplicates. Preserve the first row.
  if exists (select 1 from public.ranked_games where id=new.id or
       (player_id=new.player_id and source_match_id=new.source_match_id and new.source_match_id is not null)) then return new; end if;
  if new.rating_after is not null or new.rd_after is not null or new.delta is not null then
    raise exception 'ranked_new_context_requires_pending';
  end if;
  if exists (select 1 from public.ranked_games where player_id=new.player_id and rating_after is null) then
    raise exception 'ranked_predecessor_pending';
  end if;
  if p.ranked_games_played=0 and p.glicko_rating=1500 and coalesce(p.peak_rating,0) in (0,1500) then
    raise exception 'ranked_snapshot_conflict: normalize legacy owner before snapshot';
  end if;
  expected := jsonb_build_object('rating',p.glicko_rating,'rd',p.glicko_rd,'vol',p.glicko_vol,
      'gamesPlayed',p.ranked_games_played,'peakRating',p.peak_rating);
  if new.rating_context->'player' is distinct from expected then raise exception 'ranked_snapshot_conflict'; end if;
  return new;
end $$;
drop trigger if exists ranked_rating_context_admission on public.ranked_games;
create trigger ranked_rating_context_admission before insert on public.ranked_games
for each row execute function public.admit_ranked_rating_context();
revoke all on function public.keep_ranked_rating_context_immutable() from public, anon, authenticated;
revoke all on function public.admit_ranked_rating_context() from public, anon, authenticated;

-- Replace the existing signature atomically; the trailing default keeps old
-- positional/JSON RPC calls valid for legacy NULL rows. Do not leave overloads
-- with the same named arguments (PostgREST would find them ambiguous).
drop function if exists public.commit_glicko_game_update(
  uuid,double precision,double precision,double precision,timestamptz,
  boolean,double precision,integer,uuid,double precision,double precision,
  double precision,double precision
);
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

  if v_rating_context is not null and (
    (v_rating_context->'player'->>'rating')::double precision is distinct from p_rating_before
    or (v_rating_context->'player'->>'rd')::double precision is distinct from p_rd_before
    or (v_rating_context->'player'->>'vol')::double precision is distinct from p_vol_before
    or (v_rating_context->'player'->>'gamesPlayed')::integer + 1 <> p_ranked_games_played
  ) then raise exception 'ranked_rating_context_mismatch'; end if;

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
-- Decay cannot invalidate an admitted pending game's owner snapshot.
create or replace function public.commit_glicko_decay_update(
  p_profile_id uuid, p_new_rd double precision, p_processed_at timestamptz,
  p_rating_before double precision, p_rd_before double precision,
  p_vol_before double precision, p_games_before integer
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform 1 from public.profiles where id=p_profile_id for update;
  if exists (select 1 from public.ranked_games where player_id=p_profile_id and rating_after is null) then
    raise exception 'ranked_state_conflict';
  end if;
  update public.profiles set glicko_rd=p_new_rd,glicko_last_period=p_processed_at
   where id=p_profile_id and glicko_rating=p_rating_before and glicko_rd=p_rd_before
     and glicko_vol=p_vol_before and ranked_games_played=p_games_before;
  if not found then raise exception 'ranked_state_conflict'; end if;
  insert into public.rating_periods(user_id,rating_before,rating_after,rd_before,rd_after,vol_before,vol_after,processed_at)
    values(p_profile_id,p_rating_before,p_rating_before,p_rd_before,p_new_rd,p_vol_before,p_vol_before,p_processed_at);
end $$;
revoke all on function public.commit_glicko_decay_update(uuid,double precision,timestamptz,double precision,double precision,double precision,integer) from public,anon,authenticated;
grant execute on function public.commit_glicko_decay_update(uuid,double precision,timestamptz,double precision,double precision,double precision,integer) to service_role;
comment on column public.ranked_games.rating_context is
  'Immutable v1 treatment/cause/outcome, owner rating/RD/volatility/count/peak and opponent rating/RD. NULL retains historical full-weight interpretation; never backfill disconnects by guessing.';
notify pgrst, 'reload schema';
commit;
-- Validate under the weaker validation lock after releasing expansion DDL locks.
alter table public.ranked_games validate constraint ranked_games_rating_context_valid;
