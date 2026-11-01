-- M4 post-migration verification as ONE result table — READ-ONLY.
-- The Supabase SQL editor shows only the LAST result of a multi-statement script, so verify.sql's panels are mostly
-- invisible there. This is the same checks as a single query: paste it and read one table.
--
-- Rows 01-09: every "expect" must hold. Rows 10-13: informational. Rows 20+: the next events.
-- Eastern is the schedule; Pacific is not shown.
with
slots as (select * from public._live_event_slots(now(), 30)),
nxt as (
  select row_number() over (order by t.scheduled_start) as rn, t.*
    from public.scheduled_tournaments t
   where t.kind = 'live' and t.status in ('upcoming', 'registration_open') and t.scheduled_start > now()
),
held as (
  select s.scheduled_start, t.cancel_reason, row_number() over (order by s.scheduled_start) as rn
    from slots s join public.scheduled_tournaments t on t.scheduled_start = s.scheduled_start
   where t.status = 'cancelled'
)
select item, value from (
  select '01 timezone (expect America/New_York)' as item, public._live_event_timezone()::text as value
  union all select '02 slot times (expect 18:00:00, 21:00:00)', (select string_agg(t::text, ', ' order by t) from public._live_event_slot_times() t)
  union all select '03 seed functions keep their signatures (expect 2)',
    (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and ((p.proname = 'seed_future_tournaments' and pg_get_function_identity_arguments(p.oid) = 'days_ahead integer')
          or (p.proname = 'ensure_tournament_seed_window' and pg_get_function_identity_arguments(p.oid) = '')))
  union all select '04 desired slots with no Live row at all, expect 0',
    (select count(*)::text from slots s where not exists (select 1 from public.scheduled_tournaments t where t.scheduled_start = s.scheduled_start and t.kind = 'live'))
  union all select '05 future slot-time Live rows without a 12 h / 2 min window, expect 0',
    (select count(*)::text from public.scheduled_tournaments t
      where t.kind = 'live' and t.status in ('upcoming', 'registration_open') and t.scheduled_start > now()
        and public._is_live_event_slot(t.scheduled_start)
        and not exists (select 1 from public.scheduled_tournament_matches m where m.tournament_id = t.id)
        and (t.scheduled_start - t.registration_open_at, t.scheduled_start - t.registration_close_at) <> (interval '12 hours', interval '2 minutes'))
  union all select '06 eligible old-schedule rows still not cancelled, expect 0',
    (select count(*)::text from public.scheduled_tournaments t
      where t.kind = 'live' and t.status = 'upcoming' and t.scheduled_start > now() + interval '35 minutes'
        and not public._is_live_event_slot(t.scheduled_start)
        and not exists (select 1 from public.scheduled_tournament_registrations r where r.tournament_id = t.id)
        and not exists (select 1 from public.scheduled_tournament_matches m where m.tournament_id = t.id))
  union all select '07 schedule_changed rows with a registration or a match row, expect 0',
    (select count(*)::text from public.scheduled_tournaments t where t.cancel_reason = 'schedule_changed'
        and (exists (select 1 from public.scheduled_tournament_registrations r where r.tournament_id = t.id)
          or exists (select 1 from public.scheduled_tournament_matches m where m.tournament_id = t.id)))
  union all select '08 schedule_changed Fritz Cups, expect 0',
    (select count(*)::text from public.scheduled_tournaments where cancel_reason = 'schedule_changed' and kind <> 'live')
  union all select '09 schedule_changed rows at a slot time, expect 0',
    (select count(*)::text from public.scheduled_tournaments t where t.cancel_reason = 'schedule_changed' and public._is_live_event_slot(t.scheduled_start))
  union all select '10 retired old-schedule events (informational)',
    (select count(*)::text from public.scheduled_tournaments where cancel_reason = 'schedule_changed')
  union all select '11 desired slots that exist and are upcoming (informational)',
    (select count(*)::text from slots s join public.scheduled_tournaments t on t.scheduled_start = s.scheduled_start where t.status = 'upcoming')
  union all select '12 desired slots held by a CANCELLED row (informational: those slots stay empty)',
    (select count(*)::text from held)
  union all select '13 active future Live events off the 18:00 / 21:00 grid (informational)',
    (select count(*)::text from public.scheduled_tournaments t
      where t.kind = 'live' and t.status in ('upcoming', 'registration_open') and t.scheduled_start > now()
        and not public._is_live_event_slot(t.scheduled_start))
  union all select '14 cancelled slot ' || lpad(h.rn::text, 2, '0'),
    to_char(h.scheduled_start at time zone 'America/New_York', 'Dy MM-DD HH24:MI') || ' ET, reason: ' || coalesce(h.cancel_reason, '(none)')
    from held h where h.rn <= 8
  union all select '20 next event ' || lpad(n.rn::text, 2, '0'),
    to_char(n.scheduled_start at time zone 'America/New_York', 'Dy MM-DD HH24:MI') || ' ET | registration opens '
      || to_char(n.registration_open_at at time zone 'America/New_York', 'MM-DD HH24:MI') || ' | closes '
      || to_char(n.registration_close_at at time zone 'America/New_York', 'HH24:MI') || ' | ' || n.status
    from nxt n where n.rn <= 8
) x
order by item;
