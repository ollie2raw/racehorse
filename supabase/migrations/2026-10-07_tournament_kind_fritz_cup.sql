-- M1: tournament kind, Fritz Cup ownership, per-user overlap lock (Phase 2B).
--
-- Additive only. Safe to apply before the server that uses it:
--   * scheduled_tournaments.kind defaults to 'live', so every existing row and
--     every row the existing seed functions insert is a Live Event; the deployed
--     server reads with select=* and ignores the new columns.
--   * register_for_tournament keeps its signature and its success shape. It now
--     refuses Fritz Cups (registration_closed, an existing code) and overlapping
--     holds (overlapping_tournament — the deployed server reports it as an error,
--     never as a success).
--   * start_fritz_cup is new; nothing calls it until the server does.
--
-- A user's tournament HOLD: a registration in 'registered' or 'active' for a
-- tournament in 'upcoming' / 'registration_open' / 'in_progress'. Each hold
-- occupies [scheduled_start, scheduled_start + 2 hours) — the same 2 hours as
-- the server's TOURNAMENT_ACTIVE_WINDOW_MS backstop. No user may hold two
-- tournaments whose windows intersect. Every write that can create a hold takes
-- the per-user transaction advisory lock first, then the tournament row lock:
--
--   pg_advisory_xact_lock(hashtext('tournament_user:' || user_id))
--
-- (the same transaction-scoped form generate_tournament_bracket uses for
-- 'tournament_bracket:' keys). The lock lives and dies with the RPC's own
-- transaction, so it works over PostgREST.
--
-- Errors (stable codes, details as JSON in the exception DETAIL):
--   overlapping_tournament  detail {"tournament_id","kind","scheduled_start"}
--   fritz_cup_cooldown      detail {"retry_after_ms","reason": "cooldown"|"daily_limit"}
--   invalid_user, registration_closed, tournament_full, tournament_not_found (existing)

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- Columns
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.scheduled_tournaments
  add column if not exists kind text not null default 'live',
  -- Guardrail #6: every FK to auth.users cascades. Deleting the owner's account
  -- deletes their cups (matches and registrations cascade from the tournament).
  add column if not exists owner_user_id uuid null references auth.users(id) on delete cascade;

alter table public.scheduled_tournaments
  drop constraint if exists scheduled_tournaments_kind_check;
alter table public.scheduled_tournaments
  add constraint scheduled_tournaments_kind_check check (kind in ('live', 'fritz_cup'));

-- A Fritz Cup always has an owner; a Live Event never does.
alter table public.scheduled_tournaments
  drop constraint if exists scheduled_tournaments_owner_matches_kind;
alter table public.scheduled_tournaments
  add constraint scheduled_tournaments_owner_matches_kind
  check ((kind = 'fritz_cup') = (owner_user_id is not null));

-- start_fritz_cup's owner lookups: the active cup, the latest creation
-- (cooldown) and the creations in the last 24 h (daily limit). Live Event
-- queries are already served by idx_st_status_start (status, scheduled_start);
-- a (kind, status, scheduled_start) index would duplicate it.
create index if not exists idx_st_fritz_cup_owner
  on public.scheduled_tournaments (owner_user_id, created_at desc)
  where kind = 'fritz_cup';

-- ─────────────────────────────────────────────────────────────────────────────
-- _tournament_user_conflict: the first tournament this user holds whose 2-hour
-- window intersects [p_window_start, p_window_start + 2 hours), excluding
-- p_exclude_tournament_id. Callers must hold the user lock.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public._tournament_user_conflict(
  p_user_id               uuid,
  p_window_start          timestamptz,
  p_exclude_tournament_id uuid default null
)
returns table (tournament_id uuid, kind text, scheduled_start timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select t.id, t.kind, t.scheduled_start
    from scheduled_tournament_registrations r
    join scheduled_tournaments t on t.id = r.tournament_id
   where r.user_id = p_user_id
     and r.status in ('registered', 'active')
     and t.status in ('upcoming', 'registration_open', 'in_progress')
     and (p_exclude_tournament_id is null or t.id <> p_exclude_tournament_id)
     and t.scheduled_start < p_window_start + interval '2 hours'
     and p_window_start < t.scheduled_start + interval '2 hours'
   order by t.scheduled_start
   limit 1;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- register_for_tournament (same signature and success shape as 2026-09-29)
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
  v_conflict record;
begin
  if p_user_id is null then
    raise exception 'invalid_user';
  end if;

  -- 1. user lock, 2. tournament row lock — never the other way round.
  perform pg_advisory_xact_lock(hashtext('tournament_user:' || p_user_id::text));

  select * into v_t from scheduled_tournaments where id = p_tournament_id for update;
  if not found then
    raise exception 'tournament_not_found';
  end if;

  -- Fritz Cups are never publicly registerable: the owner's registration is
  -- written only by start_fritz_cup.
  if v_t.kind <> 'live' then
    raise exception 'registration_closed';
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

  select * into v_conflict
    from public._tournament_user_conflict(p_user_id, v_t.scheduled_start, p_tournament_id);
  if found then
    raise exception 'overlapping_tournament' using detail = jsonb_build_object(
      'tournament_id', v_conflict.tournament_id,
      'kind', v_conflict.kind,
      'scheduled_start', v_conflict.scheduled_start
    )::text;
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
-- start_fritz_cup: the database half of an on-demand Fritz Cup. Creates (or
-- returns) the user's active cup and its owner registration in one
-- transaction. The server then starts it through the normal engine
-- (closeRegistrationAndStart → generate_tournament_bracket → dispatch); the
-- cup is due at once, so the scheduler's ordinary lifecycle tick starts it if
-- the server dies first. No bracket is generated here.
--
-- Returns {"existing": bool, "tournament": <scheduled_tournaments row>}.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.start_fritz_cup(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cup          scheduled_tournaments%rowtype;
  v_conflict     record;
  v_now          timestamptz := now();
  v_last_created timestamptz;
  v_day_count    integer;
  v_day_oldest   timestamptz;
  v_start        timestamptz;
  v_id           uuid;
  v_attempt      integer := 0;
begin
  if p_user_id is null or not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'invalid_user';
  end if;

  perform pg_advisory_xact_lock(hashtext('tournament_user:' || p_user_id::text));

  -- 1. Idempotent: the user's active cup (theirs, not finished, and they are
  --    still in it) is returned as is — before any limit is applied.
  select t.* into v_cup
    from scheduled_tournaments t
    join scheduled_tournament_registrations r
      on r.tournament_id = t.id and r.user_id = p_user_id
   where t.kind = 'fritz_cup'
     and t.owner_user_id = p_user_id
     and t.status in ('upcoming', 'registration_open', 'in_progress')
     and r.status in ('registered', 'active')
   order by t.created_at desc
   limit 1;
  if found then
    return jsonb_build_object('existing', true, 'tournament', to_jsonb(v_cup));
  end if;

  -- 2. Overlap with any other hold (Live Event or cup).
  select * into v_conflict from public._tournament_user_conflict(p_user_id, v_now, null);
  if found then
    raise exception 'overlapping_tournament' using detail = jsonb_build_object(
      'tournament_id', v_conflict.tournament_id,
      'kind', v_conflict.kind,
      'scheduled_start', v_conflict.scheduled_start
    )::text;
  end if;

  -- 3. Abuse limits. Every cup row ever created counts, whatever became of it
  --    (cancelled initialisations included): one new cup per 60 s, 20 per 24 h.
  select max(created_at) into v_last_created
    from scheduled_tournaments
   where kind = 'fritz_cup' and owner_user_id = p_user_id;
  if v_last_created is not null and v_last_created > v_now - interval '60 seconds' then
    raise exception 'fritz_cup_cooldown' using detail = jsonb_build_object(
      'reason', 'cooldown',
      'retry_after_ms', ceil(extract(epoch from (v_last_created + interval '60 seconds' - v_now)) * 1000)::bigint
    )::text;
  end if;

  select count(*), min(created_at) into v_day_count, v_day_oldest
    from scheduled_tournaments
   where kind = 'fritz_cup' and owner_user_id = p_user_id
     and created_at > v_now - interval '24 hours';
  if v_day_count >= 20 then
    raise exception 'fritz_cup_cooldown' using detail = jsonb_build_object(
      'reason', 'daily_limit',
      'retry_after_ms', ceil(extract(epoch from (v_day_oldest + interval '24 hours' - v_now)) * 1000)::bigint
    )::text;
  end if;

  -- 4. The cup. scheduled_start is UNIQUE and also holds Live Event slots
  --    (always whole minutes). The candidate is the database clock's current
  --    millisecond + 1 µs; a collision (another cup this millisecond — ON
  --    CONFLICT waits for a concurrent insert of the same value to commit or
  --    roll back) steps forward 1 µs, at most 998 times, so a cup start never
  --    reaches the next millisecond and is never a whole second: a cup can
  --    never take a Live Event slot, seeded now or later.
  v_start := date_trunc('milliseconds', clock_timestamp()) + interval '1 microsecond';
  loop
    v_attempt := v_attempt + 1;
    if v_attempt > 998 then
      raise exception 'fritz_cup_start_unavailable';
    end if;
    insert into scheduled_tournaments
      (scheduled_start, registration_open_at, registration_close_at, status, kind, owner_user_id, max_players)
    values
      (v_start, v_start, v_start, 'registration_open', 'fritz_cup', p_user_id, 8)
    on conflict (scheduled_start) do nothing
    returning id into v_id;
    exit when v_id is not null;
    v_start := v_start + interval '1 microsecond';
  end loop;

  -- 5. The owner's registration: the only human. Fritz seats are match rows
  --    only (bot ids), created with the bracket.
  insert into scheduled_tournament_registrations (tournament_id, user_id, status)
  values (v_id, p_user_id, 'registered');

  select * into v_cup from scheduled_tournaments where id = v_id;
  return jsonb_build_object('existing', false, 'tournament', to_jsonb(v_cup));
end;
$$;

revoke execute on function
  public._tournament_user_conflict(uuid, timestamptz, uuid),
  public.register_for_tournament(uuid, uuid),
  public.start_fritz_cup(uuid)
  from public, anon, authenticated;

grant execute on function
  public._tournament_user_conflict(uuid, timestamptz, uuid),
  public.register_for_tournament(uuid, uuid),
  public.start_fritz_cup(uuid)
  to service_role;

commit;
