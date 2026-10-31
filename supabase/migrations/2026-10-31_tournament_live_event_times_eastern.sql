-- M4: Live Events at 6 pm and 9 pm Eastern (replaces M2's 5 pm and 8 pm Pacific).
--
-- Schedule (owner decision, 2026-10-31):
--   every local day in America/New_York, at 18:00 and 21:00 local time.
--   registration_open_at  = scheduled_start - 12 hours   (unchanged from M2)
--   registration_close_at = scheduled_start - 2 minutes  (unchanged from M2)
-- "6 pm / 9 pm EST" is read as Eastern time as people say it (EST in winter, EDT in summer), so the events stay at
-- 6 pm and 9 pm on an Eastern clock all year. Slots are built as (local date + local time) in America/New_York and
-- converted to timestamptz, so their UTC instant moves with EDT/EST. Neither slot is in a DST transition hour
-- (01:00-03:00 local).
--
-- M2 made the schedule ONE definition in replaceable helpers, for exactly this: a schedule change is a
-- `create or replace` of the helpers, nothing else.
--   _live_event_timezone()      'America/Los_Angeles' -> 'America/New_York'
--   _live_event_slot_times()    17:00, 20:00          -> 18:00, 21:00
-- Everything that derives from them follows with no further change: _is_live_event_slot, _live_event_slots,
-- seed_future_tournaments, ensure_tournament_seed_window (signatures unchanged: pg_cron and every deployed server call
-- them as before). The registration window helper is untouched. Nothing in the server or the client hard-codes the
-- schedule: the server is driven by the stored timestamps and the client shows each player's own local time.
--
-- Cleanup of the old inventory (same rule as M2; never deleted, history unchanged): cancelled with cancel_reason
-- 'schedule_changed' only if ALL hold: kind = 'live', status = 'upcoming', scheduled_start > now() + 35 min, not at
-- a (new) slot time, no registration row, no match row. Everything else is left exactly as it is: registration_open,
-- in_progress, completed, cancelled, past, within 35 min, any registration or match, every Fritz Cup. So an event
-- somebody already registered for still plays at its old time; the rest of the old inventory is retired.
-- Existing future Live Events already AT a new slot time keep their id and start (none are expected).
--
-- Atomic: one transaction. It first takes SHARE ROW EXCLUSIVE on scheduled_tournaments (reads continue; inserts /
-- updates wait for the seconds this takes), so no old-body seed call (pg_cron, a server tick) can insert old-schedule
-- rows between the cleanup and the commit, and no registration or bracket can appear on a row between its check and
-- its cancellation. The new helpers, the cleanup and the first seeding commit together. Idempotent: applying it again
-- changes nothing.
--
-- Requires M2 (2026-10-10_tournament_live_event_cadence.sql): this only redefines two of its helpers.

begin;

lock table public.scheduled_tournaments in share row exclusive mode;

-- ─────────────────────────────────────────────────────────────────────────────
-- The schedule
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public._live_event_timezone()
returns text
language sql
immutable
as $$ select 'America/New_York'::text $$;

create or replace function public._live_event_slot_times()
returns setof time
language sql
immutable
as $$ values (time '18:00'), (time '21:00') $$;

comment on function public.seed_future_tournaments(integer) is
  'Idempotently inserts the Live Event slots (18:00 and 21:00 America/New_York, see _live_event_slot_times) of the local days [today, today + days_ahead) that can still be registered for. Registration opens 12 h and closes 2 min before start. Never touches an existing row at a slot time, cancelled or not. Returns the number inserted.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Retire the old future inventory (cancel, never delete)
-- ─────────────────────────────────────────────────────────────────────────────

update public.scheduled_tournaments t
   set status = 'cancelled',
       cancel_reason = 'schedule_changed'
 where t.kind = 'live'
   and t.status = 'upcoming'
   and t.scheduled_start > now() + interval '35 minutes'
   and not public._is_live_event_slot(t.scheduled_start)
   and not exists (select 1 from public.scheduled_tournament_registrations r where r.tournament_id = t.id)
   and not exists (select 1 from public.scheduled_tournament_matches m where m.tournament_id = t.id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Existing future Live Events already at a new slot time: same id, same start, the standard window
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
-- Seed the new schedule now
-- ─────────────────────────────────────────────────────────────────────────────

select public.ensure_tournament_seed_window();

commit;
