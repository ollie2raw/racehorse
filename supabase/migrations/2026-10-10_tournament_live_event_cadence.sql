-- M2: Live Event cadence — two events per America/Los_Angeles day (Phase 2D).
--
-- Schedule (launch decision; Pacific local time is the source of truth):
--   every local day in America/Los_Angeles, at 17:00 and 20:00 local time.
--   registration_open_at  = scheduled_start - 12 hours
--   registration_close_at = scheduled_start - 2 minutes
-- Slots are built as (local date + local time) in America/Los_Angeles and then
-- converted to timestamptz, so their UTC instant moves with PDT/PST. Neither
-- slot is in a DST transition hour (01:00–03:00 local).
--
-- ONE definition of each rule, in replaceable internal helpers (a future
-- schedule change is one `create or replace` of the helper):
--   _live_event_timezone()                 'America/Los_Angeles'
--   _live_event_slot_times()               17:00, 20:00
--   _live_event_registration_window(start) open = start - 12 h, close = start - 2 min
--   _is_live_event_slot(ts)                ts is one of the local slot times
--   _live_event_slots(from, days)          every slot on local days
--                                          [date(from), date(from) + days) whose
--                                          registration closes after `from`
--
-- Public functions keep their signatures (pg_cron and every deployed server
-- call them unchanged; they produce the new cadence as soon as this commits):
--   seed_future_tournaments(days_ahead integer default 30) returns integer
--     Inserts every missing slot of the window (kind 'live', no owner, status
--     'upcoming', table defaults for format / win_target / max_players). ON
--     CONFLICT (scheduled_start) DO NOTHING: an existing row at a slot time —
--     including a CANCELLED one — is never touched or revived. Returns the
--     number inserted.
--   ensure_tournament_seed_window() returns integer
--     Was: "seed only if fewer than 1440 future rows" (a count that cannot see
--     holes, and counts every kind). Now: seed the desired slot set — the call
--     is idempotent and ~60 conflict checks, so it simply always does it.
--
-- Cleanup of the old 48-a-day inventory (never deleted; history unchanged):
--   cancelled with cancel_reason 'cadence_replaced' only if ALL hold:
--     kind = 'live', status = 'upcoming', scheduled_start > now() + 35 min,
--     not at a slot time, no registration row, no match row.
--   Everything else is left exactly as it is (registration_open, in_progress,
--   completed, cancelled, past, within 35 min, any registration or match, every
--   Fritz Cup). The <= 35-minute rows are the current transition: they play out
--   or are cancelled by the ordinary lifecycle.
-- Existing future Live Events already AT a slot time keep their id and start;
-- if still upcoming / registration_open and without match rows, their
-- registration window is set to the new rule. Status is never changed here: an
-- upcoming row whose new open time has passed is opened by the orchestrator's
-- normal (compare-and-set) lifecycle on its next tick.
--
-- Atomic: one transaction. It first takes SHARE ROW EXCLUSIVE on
-- scheduled_tournaments (reads continue; inserts / updates wait for the
-- seconds this takes), so no old-body seed call (pg_cron, a server tick) can
-- insert old-cadence rows between the cleanup and the commit, and no
-- registration or bracket can appear on a row between its check and its
-- cancellation. The new function bodies, the cleanup and the first seeding
-- commit together.

begin;

lock table public.scheduled_tournaments in share row exclusive mode;

-- ─────────────────────────────────────────────────────────────────────────────
-- Canonical schedule helpers
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public._live_event_timezone()
returns text
language sql
immutable
as $$ select 'America/Los_Angeles'::text $$;

create or replace function public._live_event_slot_times()
returns setof time
language sql
immutable
as $$ values (time '17:00'), (time '20:00') $$;

create or replace function public._live_event_registration_window(
  p_scheduled_start     timestamptz,
  out registration_open_at  timestamptz,
  out registration_close_at timestamptz
)
language sql
immutable
as $$ select p_scheduled_start - interval '12 hours', p_scheduled_start - interval '2 minutes' $$;

-- Stable, not immutable: time-zone rules come from the server's tz database.
create or replace function public._is_live_event_slot(p_ts timestamptz)
returns boolean
language sql
stable
as $$
  select (p_ts at time zone public._live_event_timezone())::time in (select public._live_event_slot_times())
$$;

create or replace function public._live_event_slots(p_from timestamptz, p_days integer)
returns table (scheduled_start timestamptz, registration_open_at timestamptz, registration_close_at timestamptz)
language sql
stable
as $$
  with local_days as (
    select generate_series(
             (p_from at time zone public._live_event_timezone())::date,
             (p_from at time zone public._live_event_timezone())::date + greatest(p_days, 0) - 1,
             interval '1 day'
           )::date as d
  ),
  slots as (
    select ((ld.d + st) at time zone public._live_event_timezone()) as s
      from local_days ld
     cross join public._live_event_slot_times() st
  )
  select s.s, w.registration_open_at, w.registration_close_at
    from slots s
   cross join lateral public._live_event_registration_window(s.s) w
   -- Only slots a player can still register for (not past, not inside the
   -- final two minutes).
   where w.registration_close_at > p_from
   order by s.s
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Public seeding functions (same signatures)
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.seed_future_tournaments(days_ahead integer default 30)
returns integer
language plpgsql
as $$
declare
  inserted_count integer;
begin
  insert into public.scheduled_tournaments
    (scheduled_start, registration_open_at, registration_close_at, status, kind, owner_user_id)
  select s.scheduled_start, s.registration_open_at, s.registration_close_at, 'upcoming', 'live', null
    from public._live_event_slots(now(), days_ahead) s
  on conflict (scheduled_start) do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

comment on function public.seed_future_tournaments(integer) is
  'Idempotently inserts the Live Event slots (17:00 and 20:00 America/Los_Angeles, see _live_event_slot_times) of the local days [today, today + days_ahead) that can still be registered for. Registration opens 12 h and closes 2 min before start. Never touches an existing row at a slot time, cancelled or not. Returns the number inserted.';

create or replace function public.ensure_tournament_seed_window()
returns integer
language plpgsql
as $$
begin
  -- The desired set, not a row count: a count cannot see a missing slot.
  return public.seed_future_tournaments();
end;
$$;

comment on function public.ensure_tournament_seed_window() is
  'Ensures every Live Event slot of the default seed window exists (seed_future_tournaments()). Idempotent; safe to call from pg_cron and every server.';

-- Internal helpers: not client-callable. The seed functions run as their
-- caller (pg_cron as the owner, the server as service_role).
revoke execute on function
  public._live_event_timezone(),
  public._live_event_slot_times(),
  public._live_event_registration_window(timestamptz),
  public._is_live_event_slot(timestamptz),
  public._live_event_slots(timestamptz, integer)
  from public, anon, authenticated;

grant execute on function
  public._live_event_timezone(),
  public._live_event_slot_times(),
  public._live_event_registration_window(timestamptz),
  public._is_live_event_slot(timestamptz),
  public._live_event_slots(timestamptz, integer)
  to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Retire the old future inventory (cancel, never delete)
-- ─────────────────────────────────────────────────────────────────────────────

update public.scheduled_tournaments t
   set status = 'cancelled',
       cancel_reason = 'cadence_replaced'
 where t.kind = 'live'
   and t.status = 'upcoming'
   and t.scheduled_start > now() + interval '35 minutes'
   and not public._is_live_event_slot(t.scheduled_start)
   and not exists (select 1 from public.scheduled_tournament_registrations r where r.tournament_id = t.id)
   and not exists (select 1 from public.scheduled_tournament_matches m where m.tournament_id = t.id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Existing future Live Events at a slot time: same id, same start, new window
-- ─────────────────────────────────────────────────────────────────────────────

update public.scheduled_tournaments t
   set (registration_open_at, registration_close_at) =
       (select w.registration_open_at, w.registration_close_at
          from public._live_event_registration_window(t.scheduled_start) w)
 where t.kind = 'live'
   and t.status in ('upcoming', 'registration_open')
   and t.scheduled_start > now()
   and public._is_live_event_slot(t.scheduled_start)
   and not exists (select 1 from public.scheduled_tournament_matches m where m.tournament_id = t.id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed the new cadence now
-- ─────────────────────────────────────────────────────────────────────────────

select public.ensure_tournament_seed_window();

commit;
