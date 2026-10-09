-- M2 post-migration verification — READ-ONLY. Run in the Supabase SQL editor
-- after 2026-10-10_tournament_live_event_cadence.sql. Every "expect" row must
-- hold. Eastern time is shown for a sanity check only; the schedule is Pacific.

-- 1. The seed functions are the M2 bodies.
select p.proname,
       pg_get_function_identity_arguments(p.oid) as args,
       pg_get_functiondef(p.oid) ilike '%_live_event_slots%' or pg_get_functiondef(p.oid) ilike '%seed_future_tournaments()%' as is_m2_body
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('seed_future_tournaments', 'ensure_tournament_seed_window')
 order by 1;
-- expect: seed_future_tournaments(days_ahead integer) t, ensure_tournament_seed_window() t

-- 2. Invariants (expect 0 unless noted).
select 'desired slots (30 local days) with no Live row, expect 0' as item,
       (select count(*) from public._live_event_slots(now(), 30) s
         where not exists (select 1 from public.scheduled_tournaments t where t.scheduled_start = s.scheduled_start and t.kind = 'live')) as n
union all
select 'desired slots held by a CANCELLED row (deliberately cancelled before M2; informational)',
       (select count(*) from public._live_event_slots(now(), 30) s join public.scheduled_tournaments t using (scheduled_start) where t.status = 'cancelled')
union all
select 'future slot-time Live rows without a 12 h / 2 min window, expect 0',
       (select count(*) from public.scheduled_tournaments t
         where t.kind = 'live' and t.status in ('upcoming', 'registration_open') and t.scheduled_start > now()
           and public._is_live_event_slot(t.scheduled_start)
           and not exists (select 1 from public.scheduled_tournament_matches m where m.tournament_id = t.id)
           and (t.scheduled_start - t.registration_open_at, t.scheduled_start - t.registration_close_at) <> (interval '12 hours', interval '2 minutes'))
union all
select 'eligible legacy rows still not cancelled, expect 0',
       (select count(*) from public.scheduled_tournaments t
         where t.kind = 'live' and t.status = 'upcoming' and t.scheduled_start > now() + interval '35 minutes'
           and not public._is_live_event_slot(t.scheduled_start)
           and not exists (select 1 from public.scheduled_tournament_registrations r where r.tournament_id = t.id)
           and not exists (select 1 from public.scheduled_tournament_matches m where m.tournament_id = t.id))
union all
select 'rows cancelled with cadence_replaced (informational: the retired inventory)',
       (select count(*) from public.scheduled_tournaments where cancel_reason = 'cadence_replaced')
union all
select 'cadence_replaced Fritz Cups, expect 0',
       (select count(*) from public.scheduled_tournaments where cancel_reason = 'cadence_replaced' and kind <> 'live')
union all
select 'cadence_replaced rows with registrations, expect 0',
       (select count(*) from public.scheduled_tournaments t where t.cancel_reason = 'cadence_replaced'
           and exists (select 1 from public.scheduled_tournament_registrations r where r.tournament_id = t.id))
union all
select 'cadence_replaced rows with match rows, expect 0',
       (select count(*) from public.scheduled_tournaments t where t.cancel_reason = 'cadence_replaced'
           and exists (select 1 from public.scheduled_tournament_matches m where m.tournament_id = t.id))
union all
select 'cadence_replaced rows at a slot time, expect 0',
       (select count(*) from public.scheduled_tournaments t where t.cancel_reason = 'cadence_replaced' and public._is_live_event_slot(t.scheduled_start))
union all
select 'active future Live rows off the 17:00 / 20:00 grid (transition / anomalies; should only shrink)',
       (select count(*) from public.scheduled_tournaments t
         where t.kind = 'live' and t.status in ('upcoming', 'registration_open') and t.scheduled_start > now()
           and not public._is_live_event_slot(t.scheduled_start));

-- 3. The next 10 Live Events.
select t.status,
       to_char(t.scheduled_start at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || 'Z' as utc,
       to_char(t.scheduled_start at time zone 'America/Los_Angeles', 'Dy MM-DD HH24:MI') || ' PT' as pacific,
       to_char(t.scheduled_start at time zone 'America/New_York', 'Dy MM-DD HH24:MI') || ' ET' as eastern,
       to_char(t.registration_open_at at time zone 'America/Los_Angeles', 'MM-DD HH24:MI') || ' PT' as registration_opens,
       to_char(t.registration_close_at at time zone 'America/Los_Angeles', 'MM-DD HH24:MI') || ' PT' as registration_closes
  from public.scheduled_tournaments t
 where t.kind = 'live' and t.status in ('upcoming', 'registration_open') and t.scheduled_start > now()
 order by t.scheduled_start
 limit 10;
