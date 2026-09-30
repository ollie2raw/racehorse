-- generate_tournament_bracket, v2: the one path that creates a bracket, and it
-- repairs partial state (tournament review A1, B8).
--
-- The server used to build brackets itself: seven PostgREST inserts, then the
-- registrations, then the tournament status, each its own request. A crash part
-- way left some match rows behind with the tournament still
-- 'registration_open', and the old code's "any match rows exist → done" early
-- return meant every retry reported success without finishing. v1 of this
-- function (2026-08-31_tournament_match_rpcs.sql) was never called, and it had
-- the same blind spot: it only acted when there were zero rows.
--
-- v2 (same signature, so the existing service_role-only grants carry over):
--   * Serializes with register_for_tournament / withdraw_from_tournament by
--     locking the tournament row FOR UPDATE (plus the existing advisory lock).
--   * While the tournament is still in registration, validates the caller's
--     seed list against the live 'registered' set and raises
--     registrations_changed if a registration landed or left after the caller
--     read it. The caller re-reads and retries.
--   * Repairs: match rows left by an interrupted pre-RPC attempt are unplayed by
--     construction (the tournament never left registration, so nothing was
--     dispatched). They are replaced wholesale, so a retry can never leave a
--     4-of-7 bracket. Anything played raises bracket_partial_conflict instead.
--   * An 'in_progress' tournament with all 7 rows is a no-op (idempotent retry);
--     one missing rows gets them inserted (on conflict do nothing).
--   * Seeds are written exactly as passed. The server passes bracket (rating)
--     order, the same order used to pair the quarterfinals, so the stored seed
--     matches the bracket position (B8).
--
-- Errors (stable codes): tournament_not_found, tournament_not_startable,
-- registrations_changed, tournament_full, bracket_partial_conflict.

begin;

create or replace function public.generate_tournament_bracket(
  p_tournament_id uuid,
  p_qf_pairs      jsonb,
  p_seeds         jsonb,
  p_actor         text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_t          scheduled_tournaments%rowtype;
  v_existing   integer;
  v_created    boolean := false;
  v_repaired   boolean := false;
  v_pair       jsonb;
  v_seed       jsonb;
  v_qf         scheduled_tournament_matches%rowtype;
  v_bye_winner text;
begin
  perform pg_advisory_xact_lock(hashtext('tournament_bracket:' || p_tournament_id::text));

  select * into v_t from scheduled_tournaments where id = p_tournament_id for update;
  if not found then
    raise exception 'tournament_not_found';
  end if;
  if v_t.status in ('cancelled', 'completed') then
    raise exception 'tournament_not_startable';
  end if;

  select count(*) into v_existing
    from scheduled_tournament_matches where tournament_id = p_tournament_id;

  -- Idempotent retry of a finished generation.
  if v_t.status = 'in_progress' and v_existing >= 7 then
    return jsonb_build_object(
      'created', false,
      'repaired', false,
      'matches', coalesce((
        select jsonb_agg(to_jsonb(m) order by m.round, m.match_number)
          from scheduled_tournament_matches m
         where m.tournament_id = p_tournament_id
      ), '[]'::jsonb)
    );
  end if;

  if v_t.status in ('upcoming', 'registration_open') then
    -- The seed list must be exactly the live 'registered' set.
    if exists (
         select 1 from scheduled_tournament_registrations r
          where r.tournament_id = p_tournament_id and r.status = 'registered'
            and not exists (
              select 1 from jsonb_array_elements(p_seeds) s
               where (s->>'user_id')::uuid = r.user_id))
       or exists (
         select 1 from jsonb_array_elements(p_seeds) s
          where not exists (
            select 1 from scheduled_tournament_registrations r
             where r.tournament_id = p_tournament_id
               and r.user_id = (s->>'user_id')::uuid
               and r.status = 'registered'))
    then
      raise exception 'registrations_changed';
    end if;
    if jsonb_array_length(p_seeds) > v_t.max_players then
      raise exception 'tournament_full';
    end if;

    if v_existing > 0 then
      if exists (
           select 1 from scheduled_tournament_matches
            where tournament_id = p_tournament_id
              and (status not in ('waiting', 'bye') or winner_id is not null))
      then
        raise exception 'bracket_partial_conflict';
      end if;
      delete from scheduled_tournament_matches where tournament_id = p_tournament_id;
      v_repaired := true;
    end if;
    v_created := true;
  else
    -- in_progress with fewer than 7 rows: fill in whatever is missing.
    v_repaired := true;
  end if;

  -- 4 quarterfinals
  for v_pair in select * from jsonb_array_elements(p_qf_pairs) loop
    insert into scheduled_tournament_matches
      (tournament_id, round, match_number, player1_id, player2_id, room_code, status, bot_tier)
    values (
      p_tournament_id, 1,
      (v_pair->>'match_number')::int,
      nullif(v_pair->>'player1_id', ''),
      nullif(v_pair->>'player2_id', ''),
      '',
      case when (v_pair->>'player1_id') is null or (v_pair->>'player2_id') is null
           then 'bye' else 'waiting' end,
      nullif(v_pair->>'bot_tier', '')
    )
    on conflict (tournament_id, round, match_number) do nothing;
  end loop;

  -- 2 empty semifinals + 1 empty final
  insert into scheduled_tournament_matches (tournament_id, round, match_number, room_code, status)
  values (p_tournament_id, 2, 1, '', 'waiting'),
         (p_tournament_id, 2, 2, '', 'waiting'),
         (p_tournament_id, 3, 1, '', 'waiting')
  on conflict (tournament_id, round, match_number) do nothing;

  -- registrations → active, with the bracket seed. Only 'registered' rows move:
  -- a repair must never resurrect an eliminated player.
  for v_seed in select * from jsonb_array_elements(p_seeds) loop
    update scheduled_tournament_registrations
       set status = 'active', seed = (v_seed->>'seed')::int
     where tournament_id = p_tournament_id
       and user_id = (v_seed->>'user_id')::uuid
       and status = 'registered';
  end loop;

  update scheduled_tournaments
     set status = 'in_progress'
   where id = p_tournament_id and status <> 'in_progress';

  -- walk over any bye QF (one player vs null)
  for v_qf in
    select * from scheduled_tournament_matches
     where tournament_id = p_tournament_id and round = 1 and status = 'bye'
  loop
    v_bye_winner := coalesce(v_qf.player1_id, v_qf.player2_id);
    if v_bye_winner is not null then
      perform public.complete_tournament_match(
        p_match_id      => v_qf.id,
        p_winner_id     => v_bye_winner,
        p_winner_source => null,
        p_bye_walkover  => true,
        p_actor         => p_actor
      );
    end if;
  end loop;

  return jsonb_build_object(
    'created', v_created,
    'repaired', v_repaired,
    'matches', coalesce((
      select jsonb_agg(to_jsonb(m) order by m.round, m.match_number)
        from scheduled_tournament_matches m
       where m.tournament_id = p_tournament_id
    ), '[]'::jsonb)
  );
end;
$$;

-- create or replace keeps the grants from 2026-08-31; restate them so this file
-- is correct on its own.
revoke execute on function public.generate_tournament_bracket(uuid, jsonb, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.generate_tournament_bracket(uuid, jsonb, jsonb, text)
  to service_role;

commit;
