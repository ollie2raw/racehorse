-- M4 post-migration verification — READ-ONLY. Run in the Supabase SQL editor after
-- 2026-10-31_tournament_live_event_times_eastern.sql. Every "expect" row must hold.
-- The schedule is now 18:00 and 21:00 America/New_York ("6 pm and 9 pm Eastern"); Pacific time is shown for a sanity check.

-- 1. The schedule helpers are the M4 definitions (expect: America/New_York, {18:00, 21:00}).
select public._live_event_timezone() as timezone,
       (select array_agg(t order by t) from public._live_event_slot_times() t) as slot_times;

-- 2. The seed functions are still the M2 bodies, with their public signatures.
select p.proname,
       pg_get_function_identity_arguments(p.oid) as args,
       pg_get_functiondef(p.oid) ilike '%_live_event_slots%' or pg_get_functiondef(p.oid) ilike '%seed_future_tournaments()%' as is_m2_body
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('seed_future_tournaments', 'ensure_tournament_seed_window')
 order by 1;
-- expect: seed_future_tournaments(days_ahead integer) t, ensure_tournament_seed_window() t

-- 3. Invariants (expect 0 unless noted).
select 'desired slots (30 local days) with no Live row, expect 0' as item,
       (select count(*) from public._live_event_slots(now(), 30) s
         where not exists (select 1 from public.scheduled_tournaments t where t.scheduled_start = s.scheduled_start and t.kind = 'live')) as n
union all
select 'future slot-time Live rows without a 12 h / 2 min window, expect 0',
       (select count(*) from public.scheduled_tournaments t
         where t.kind = 'live' and t.status in ('upcoming', 'registration_open') and t.scheduled_start > now()
           and public._is_live_event_slot(t.scheduled_start)
           and not exists (select 1 from public.scheduled_tournament_matches m where m.tournament_id = t.id)
           and (t.scheduled_start - t.registration_open_at, t.scheduled_start - t.registration_close_at) <> (interval '12 hours', interval '2 minutes'))
union all
select 'eligible old-schedule rows still not cancelled, expect 0',
       (select count(*) from public.scheduled_tournaments t
         where t.kind = 'live' and t.status = 'upcoming' and t.scheduled_start > now() + interval '35 minutes'
           and not public._is_live_event_slot(t.scheduled_start)
           and not exists (select 1 from public.scheduled_tournament_registrations r where r.tournament_id = t.id)
           and not exists (select 1 from public.scheduled_tournament_matches m where m.tournament_id = t.id))
union all
select 'rows cancelled with schedule_changed (informational: the retired 5 pm / 8 pm PT inventory)',
       (select count(*) from public.scheduled_tournaments where cancel_reason = 'schedule_changed')
union all
select 'schedule_changed Fritz Cups, expect 0',
       (select count(*) from public.scheduled_tournaments where cancel_reason = 'schedule_changed' and kind <> 'live')
union all
select 'schedule_changed rows with registrations, expect 0',
       (select count(*) from public.scheduled_tournaments t where t.cancel_reason = 'schedule_changed'
           and exists (select 1 from public.scheduled_tournament_registrations r where r.tournament_id = t.id))
union all
select 'schedule_changed rows with match rows, expect 0',
       (select count(*) from public.scheduled_tournaments t where t.cancel_reason = 'schedule_changed'
           and exists (select 1 from public.scheduled_tournament_matches m where m.tournament_id = t.id))
union all
select 'schedule_changed rows at a slot time, expect 0',
       (select count(*) from public.scheduled_tournaments t where t.cancel_reason = 'schedule_changed' and public._is_live_event_slot(t.scheduled_start))
union all
select 'active future Live rows off the 18:00 / 21:00 ET grid (preserved anomalies: an entered event keeps its old time; should only shrink)',
       (select count(*) from public.scheduled_tournaments t
         where t.kind = 'live' and t.status in ('upcoming', 'registration_open') and t.scheduled_start > now()
           and not public._is_live_event_slot(t.scheduled_start));

-- 4. The next 10 Live Events: expect 18:00 and 21:00 ET, registration opening 12 h before and closing 2 min before.
select t.status,
       to_char(t.scheduled_start at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || 'Z' as utc,
       to_char(t.scheduled_start at time zone 'America/New_York', 'Dy MM-DD HH24:MI') || ' ET' as eastern,
       to_char(t.scheduled_start at time zone 'America/Los_Angeles', 'Dy MM-DD HH24:MI') || ' PT' as pacific,
       to_char(t.registration_open_at at time zone 'America/New_York', 'MM-DD HH24:MI') || ' ET' as registration_opens,
       to_char(t.registration_close_at at time zone 'America/New_York', 'MM-DD HH24:MI') || ' ET' as registration_closes
  from public.scheduled_tournaments t
 where t.kind = 'live' and t.status in ('upcoming', 'registration_open') and t.scheduled_start > now()
 order by t.scheduled_start
 limit 10;
