-- PRE-CONTRACT CHECK (apply with the Ghost expand migration; additive).
-- Detects Ghost/Fritz handoff partials and blocks the Ghost contract migration
-- while any are unresolved. It reports exact (user_id, match_id) pairs and
-- NEVER writes a rating, a Ghost row, or a resolution on its own.
--
-- A straddle partial is a verified Fritz ranked result that committed while no
-- Ghost row exists for that (user, match): the old writer committed the ranked
-- result, then its deferred Ghost training write was fenced by the expand
-- migration or lost to a process death. With a proper drain this should be
-- empty. Rows the old writer completed in full (ranked row AND Ghost row,
-- merely lacking a receipt) are legacy history, not partials.
begin;

create table if not exists public.ghost_cutover_resolutions (
  user_id uuid not null,
  match_id uuid not null,
  resolution text not null check (resolution in ('rating_applied_manually','confirmed_no_effect_needed')),
  note text not null check (length(btrim(note)) >= 10),
  resolved_by text not null,
  resolved_at timestamptz not null default now(),
  primary key (user_id, match_id)
);
alter table public.ghost_cutover_resolutions enable row level security;
revoke all on public.ghost_cutover_resolutions from public, anon, authenticated;
grant select on public.ghost_cutover_resolutions to service_role;

create or replace function public.ghost_cutover_suspicious_partials()
returns table (kind text, user_id uuid, match_id uuid, detail jsonb)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_start timestamptz;
  v_expand timestamptz;
begin
  select first_quiesced_at, ghost_expand_applied_at into v_start, v_expand
    from public.rating_cutover_gate where id;
  if v_expand is null or v_start is null then
    raise exception 'ghost_cutover_boundary_unknown: expand has not run under a closed gate';
  end if;
  -- Five minutes of slack covers clock skew and a unit that began just before the gate closed.
  v_start := v_start - interval '5 minutes';

  return query
  select 'ranked_without_ghost_row'::text, rg.player_id, rg.source_match_id,
         jsonb_build_object('ranked_game_id', rg.id, 'played_at', rg.played_at)
    from public.ranked_games rg
   where rg.game_type = 'fritz' and rg.source_type = 'verified_single_player'
     and rg.source_match_id is not null and rg.played_at >= v_start
     and not exists (select 1 from public.ghost_games gg
                      where gg.user_id = rg.player_id and gg.match_id = rg.source_match_id)
     and not exists (select 1 from public.ghost_cutover_resolutions r
                      where r.user_id = rg.player_id and r.match_id = rg.source_match_id)
  union all
  select 'ranked_after_expand_without_receipt'::text, rg.player_id, rg.source_match_id,
         jsonb_build_object('ranked_game_id', rg.id, 'played_at', rg.played_at)
    from public.ranked_games rg
   where rg.game_type = 'fritz' and rg.source_type = 'verified_single_player'
     and rg.source_match_id is not null and rg.played_at >= v_expand
     and not exists (select 1 from public.ghost_games gg
                      where gg.user_id = rg.player_id and gg.match_id = rg.source_match_id
                        and gg.rating_applied_at is not null)
     and not exists (select 1 from public.ghost_cutover_resolutions r
                      where r.user_id = rg.player_id and r.match_id = rg.source_match_id)
  union all
  select 'ghost_row_after_expand_without_receipt'::text, gg.user_id, gg.match_id,
         jsonb_build_object('ghost_game_id', gg.id, 'played_at', gg.played_at)
    from public.ghost_games gg
   where gg.match_id is not null and gg.played_at >= v_expand and gg.rating_applied_at is null
     and not exists (select 1 from public.ghost_cutover_resolutions r
                      where r.user_id = gg.user_id and r.match_id = gg.match_id);
end $$;

-- Deliberate, audited resolution. It never rates anything. For
-- 'rating_applied_manually' the Ghost receipt must already exist, i.e. the
-- operator applied the outcome through complete_ghost_rating_v2 first. The
-- training move log is not retained anywhere for a lost deferred write, and
-- applying the rating now uses today's Ghost rating, not the one at match time,
-- so the outcome is an operator decision, never inferred.
create or replace function public.ghost_cutover_resolve(
  p_user_id uuid, p_match_id uuid, p_resolution text, p_note text, p_resolved_by text
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_resolution = 'rating_applied_manually' and not exists (
    select 1 from public.ghost_games
     where user_id = p_user_id and match_id = p_match_id and rating_applied_at is not null
  ) then
    raise exception 'ghost_cutover_resolution_requires_receipt';
  end if;
  insert into public.ghost_cutover_resolutions (user_id, match_id, resolution, note, resolved_by)
  values (p_user_id, p_match_id, p_resolution, p_note, p_resolved_by);
end $$;

create or replace function public.ghost_cutover_assert_reconciled()
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_count integer;
begin
  select count(*) into v_count from public.ghost_cutover_suspicious_partials();
  if v_count > 0 then
    raise exception 'ghost_cutover_unreconciled: % suspicious partial(s); run select * from public.ghost_cutover_suspicious_partials()', v_count;
  end if;
end $$;

revoke execute on function public.ghost_cutover_suspicious_partials() from public, anon, authenticated;
revoke execute on function public.ghost_cutover_resolve(uuid,uuid,text,text,text) from public, anon, authenticated;
revoke execute on function public.ghost_cutover_assert_reconciled() from public, anon, authenticated;
grant execute on function public.ghost_cutover_suspicious_partials() to service_role;
grant execute on function public.ghost_cutover_resolve(uuid,uuid,text,text,text) to service_role;
grant execute on function public.ghost_cutover_assert_reconciled() to service_role;

commit;
