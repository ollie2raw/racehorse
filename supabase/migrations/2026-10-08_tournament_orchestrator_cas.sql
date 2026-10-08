-- Orchestrator write hardening (Phase 2C prerequisite).
--
-- Additive: three new service-role RPCs. Nothing existing is changed, and
-- nothing calls them until the Phase 2C server does.
--
-- The tournament orchestrator (scheduler tick, reconcile, backstop, recovery)
-- decides from rows it read earlier and writes later. Most of its writes are
-- compare-and-set PATCHes from Node. Three decisions depend on state a PATCH
-- filter cannot express, so they are revalidated here, under row locks:
--
--   complete_tournament_match_if_unchanged
--     A no-show / administrative result (reconciler, event backstop) is decided
--     from a 'ready' match and its players' attendance as read earlier.
--     complete_tournament_match accepts no_show from 'ready' OR 'in_progress'
--     and does not look at attendance, so a stale decision could land on a
--     game that has since started, or name as absent a player who has since
--     joined. This wrapper locks the match row, refuses with
--     `match_state_changed` (status no longer p_expected_status) or
--     `attendance_changed` (a listed user has joined), and otherwise runs
--     complete_tournament_match unchanged in the same transaction.
--
--   cancel_tournament_if_no_entrants
--     A Live Event is cancelled for `not_enough_players` from a registration
--     count read earlier. Registration closes by the database clock; a server
--     clock slightly ahead can read "nobody" while a last-moment registration
--     still commits. This locks the tournament row (the lock
--     register_for_tournament takes), and cancels only if it is still before
--     its start, registration is closed by the database clock, and nobody is
--     registered — so a registration either committed first (no cancel) or
--     comes after (and finds the event cancelled: registration_closed).
--
--   cancel_tournament_if_bracket_unchanged
--     The event backstop cancels a tournament it judged unrecoverable. The
--     tournament stays 'in_progress' while other processes complete, promote
--     or repair its matches, and some "unrecoverable" RPC refusals are exactly
--     what a concurrent change produces. So the cancel is conditional on the
--     whole bracket being as the backstop saw it: every match locked (matches
--     first, then the tournament — the order complete_tournament_match uses,
--     so the two never deadlock), compared field by field with the snapshot,
--     and the tournament cancelled only if nothing changed and it is still
--     in_progress. Otherwise nothing is written and the backstop decides again
--     from fresh state on its next tick.
--
-- Errors: match_not_found, match_state_changed, attendance_changed,
-- tournament_not_found, plus everything complete_tournament_match raises.

begin;

create or replace function public.complete_tournament_match_if_unchanged(
  p_match_id           uuid,
  p_winner_id          text,
  p_winner_source      text,
  p_status_reason      text,
  p_reported_p1_score  integer,
  p_reported_p2_score  integer,
  p_no_show_user_id    text,
  p_expected_status    text,
  p_unjoined_user_ids  text[],
  p_actor              text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_match scheduled_tournament_matches%rowtype;
begin
  select * into v_match from scheduled_tournament_matches where id = p_match_id for update;
  if not found then
    raise exception 'match_not_found';
  end if;
  -- A completed match takes complete_tournament_match's idempotent branch.
  if v_match.status <> 'completed' then
    if p_expected_status is not null and v_match.status <> p_expected_status then
      raise exception 'match_state_changed' using detail = v_match.status;
    end if;
    if exists (
         select 1 from unnest(coalesce(p_unjoined_user_ids, '{}'::text[])) u
          where (u = v_match.player1_id and v_match.player1_joined_at is not null)
             or (u = v_match.player2_id and v_match.player2_joined_at is not null))
    then
      raise exception 'attendance_changed';
    end if;
  end if;
  return public.complete_tournament_match(
    p_match_id          => p_match_id,
    p_winner_id         => p_winner_id,
    p_winner_source     => p_winner_source,
    p_status_reason     => p_status_reason,
    p_reported_p1_score => p_reported_p1_score,
    p_reported_p2_score => p_reported_p2_score,
    p_no_show_user_id   => p_no_show_user_id,
    p_forfeit_user_id   => null,
    p_bye_walkover      => false,
    p_actor             => p_actor
  );
end;
$$;

-- Returns {"cancelled": bool}.
create or replace function public.cancel_tournament_if_no_entrants(
  p_tournament_id uuid,
  p_reason        text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_t scheduled_tournaments%rowtype;
begin
  select * into v_t from scheduled_tournaments where id = p_tournament_id for update;
  if not found then
    raise exception 'tournament_not_found';
  end if;
  if v_t.status not in ('upcoming', 'registration_open')
     or now() < v_t.registration_close_at
     or exists (select 1 from scheduled_tournament_registrations
                 where tournament_id = p_tournament_id and status = 'registered')
  then
    return jsonb_build_object('cancelled', false);
  end if;
  update scheduled_tournaments
     set status = 'cancelled', cancel_reason = p_reason
   where id = p_tournament_id;
  return jsonb_build_object('cancelled', true);
end;
$$;

-- p_expected: the backstop's snapshot, one object per match:
--   {id, status, winner_id, player1_id, player2_id, room_code, status_reason,
--    started_at, completed_at, ready_deadline_at, player1_joined_at, player2_joined_at}
-- Returns {"cancelled": bool, "reason": null | "not_in_progress" | "bracket_changed"}.
create or replace function public.cancel_tournament_if_bracket_unchanged(
  p_tournament_id uuid,
  p_expected      jsonb,
  p_reason        text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status   text;
  v_count    integer;
  v_changed  integer;
begin
  perform 1 from scheduled_tournament_matches
   where tournament_id = p_tournament_id
   order by id
   for update;

  select status into v_status from scheduled_tournaments where id = p_tournament_id for update;
  if not found then
    raise exception 'tournament_not_found';
  end if;
  if v_status <> 'in_progress' then
    return jsonb_build_object('cancelled', false, 'reason', 'not_in_progress');
  end if;

  select count(*) into v_count from scheduled_tournament_matches where tournament_id = p_tournament_id;
  select count(*) into v_changed
    from scheduled_tournament_matches m
    left join jsonb_array_elements(coalesce(p_expected, '[]'::jsonb)) e on (e->>'id')::uuid = m.id
   where m.tournament_id = p_tournament_id
     and (e is null
          or m.status            is distinct from e->>'status'
          or m.winner_id         is distinct from e->>'winner_id'
          or m.player1_id        is distinct from e->>'player1_id'
          or m.player2_id        is distinct from e->>'player2_id'
          or m.room_code         is distinct from e->>'room_code'
          or m.status_reason     is distinct from e->>'status_reason'
          or m.started_at        is distinct from (e->>'started_at')::timestamptz
          or m.completed_at      is distinct from (e->>'completed_at')::timestamptz
          or m.ready_deadline_at is distinct from (e->>'ready_deadline_at')::timestamptz
          or m.player1_joined_at is distinct from (e->>'player1_joined_at')::timestamptz
          or m.player2_joined_at is distinct from (e->>'player2_joined_at')::timestamptz);
  if v_changed > 0 or v_count <> jsonb_array_length(coalesce(p_expected, '[]'::jsonb)) then
    return jsonb_build_object('cancelled', false, 'reason', 'bracket_changed');
  end if;

  update scheduled_tournaments
     set status = 'cancelled', cancel_reason = p_reason
   where id = p_tournament_id;
  return jsonb_build_object('cancelled', true, 'reason', null);
end;
$$;

revoke execute on function
  public.complete_tournament_match_if_unchanged(uuid, text, text, text, integer, integer, text, text, text[], text),
  public.cancel_tournament_if_no_entrants(uuid, text),
  public.cancel_tournament_if_bracket_unchanged(uuid, jsonb, text)
  from public, anon, authenticated;

grant execute on function
  public.complete_tournament_match_if_unchanged(uuid, text, text, text, integer, integer, text, text, text[], text),
  public.cancel_tournament_if_no_entrants(uuid, text),
  public.cancel_tournament_if_bracket_unchanged(uuid, jsonb, text)
  to service_role;

commit;
