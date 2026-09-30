-- Registration and withdrawal as transactional RPCs (tournament review A2, A7).
--
-- Before this, registration was read-then-insert over PostgREST:
--   1. read the tournament, check status = 'registration_open'
--   2. count 'registered' rows, check < max_players
--   3. insert
-- Two players taking the last seat could both pass step 2 (a 9th registrant
-- then made bracket generation throw "Tournament caps at 8 players" on every
-- 30 s tick, forever), and nothing compared against registration_close_at, so
-- registration stayed open until the scheduler's next tick flipped the status.
-- Withdrawal was an unconditional DELETE, so a player could delete their row
-- mid-tournament and orphan their bracket slot.
--
-- Both functions lock the tournament row FOR UPDATE, so every registration,
-- withdrawal and bracket generation (generate_tournament_bracket takes the same
-- row lock) for one tournament is serialized. The cap and the close time are
-- checked inside that lock against the database clock.
--
-- Errors are raised with a stable code as the message; the server maps them to
-- HTTP / socket error codes:
--   tournament_not_found, registration_closed, tournament_full,
--   withdraw_closed, invalid_user
--
-- Server-only (service_role), like every other write path on these tables.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- register_for_tournament
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.register_for_tournament(
  p_tournament_id uuid,
  p_user_id       uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_t        scheduled_tournaments%rowtype;
  v_existing scheduled_tournament_registrations%rowtype;
  v_has_row  boolean;
  v_taken    integer;
begin
  if p_user_id is null then
    raise exception 'invalid_user';
  end if;

  select * into v_t from scheduled_tournaments where id = p_tournament_id for update;
  if not found then
    raise exception 'tournament_not_found';
  end if;

  select * into v_existing
    from scheduled_tournament_registrations
   where tournament_id = p_tournament_id and user_id = p_user_id;
  -- Capture now: every later SELECT INTO (the seat count) overwrites FOUND.
  v_has_row := found;

  -- Idempotent: an existing live registration is a success, even at the
  -- boundary (a retry of a request that already landed must not read "closed").
  if v_has_row and v_existing.status in ('registered', 'active') then
    select count(*) into v_taken
      from scheduled_tournament_registrations
     where tournament_id = p_tournament_id and status = 'registered';
    return jsonb_build_object('registered', true, 'already_registered', true, 'seats_taken', v_taken);
  end if;

  if v_t.status <> 'registration_open' or now() >= v_t.registration_close_at then
    raise exception 'registration_closed';
  end if;

  select count(*) into v_taken
    from scheduled_tournament_registrations
   where tournament_id = p_tournament_id and status = 'registered';
  if v_taken >= v_t.max_players then
    raise exception 'tournament_full';
  end if;

  if v_has_row then
    -- A soft-withdrawn row (unique (tournament_id, user_id) forbids a second
    -- row): bring it back rather than inserting.
    update scheduled_tournament_registrations
       set status = 'registered', registered_at = now(), seed = null, placement = null
     where id = v_existing.id;
  else
    insert into scheduled_tournament_registrations (tournament_id, user_id, status)
    values (p_tournament_id, p_user_id, 'registered');
  end if;

  return jsonb_build_object('registered', true, 'already_registered', false, 'seats_taken', v_taken + 1);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- withdraw_from_tournament
--
-- Allowed only while the tournament is upcoming / registration_open AND before
-- registration_close_at. Before the bracket exists the row is deleted (it has
-- no seed, match or placement yet). Once the tournament has left registration
-- nothing is ever deleted: the call raises withdraw_closed and the row stays.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.withdraw_from_tournament(
  p_tournament_id uuid,
  p_user_id       uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_t       scheduled_tournaments%rowtype;
  v_deleted integer;
begin
  if p_user_id is null then
    raise exception 'invalid_user';
  end if;

  select * into v_t from scheduled_tournaments where id = p_tournament_id for update;
  if not found then
    raise exception 'tournament_not_found';
  end if;

  if v_t.status not in ('upcoming', 'registration_open') or now() >= v_t.registration_close_at then
    raise exception 'withdraw_closed';
  end if;

  delete from scheduled_tournament_registrations
   where tournament_id = p_tournament_id
     and user_id = p_user_id
     and status = 'registered';
  get diagnostics v_deleted = row_count;

  return jsonb_build_object('withdrawn', v_deleted > 0);
end;
$$;

revoke execute on function
  public.register_for_tournament(uuid, uuid),
  public.withdraw_from_tournament(uuid, uuid)
  from public, anon, authenticated;

grant execute on function
  public.register_for_tournament(uuid, uuid),
  public.withdraw_from_tournament(uuid, uuid)
  to service_role;

commit;
