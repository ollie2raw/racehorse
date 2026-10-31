-- Tournament launch — production READINESS as ONE result table — READ-ONLY.
-- prod-preflight.sql is several statements and the Supabase SQL editor shows only the LAST result of a script, so most of
-- its panels are invisible there. This is the same checks (P1, P2, P4, P6, P7, P8, P9) as a single query: paste it, read
-- one table. Run it before switching TOURNAMENTS_ENABLED on.
--
-- Rows 01-08: every one must be true. Rows 09 and 21-24: every one must be 0.
-- Row 20 is the backlog of past events that never ran (tournaments were off): it is cancelled automatically on the first
-- ticks after enabling (about 50 rows per 30 s tick), so a few dozen is normal and not a problem.
select item, value from (
  select '01 M1: scheduled_tournaments.kind (expect true)' as item,
         exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'scheduled_tournaments' and column_name = 'kind')::text as value
  union all select '02 M1: start_fritz_cup (expect true)',
         exists(select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'start_fritz_cup')::text
  union all select '03 CAS: complete_tournament_match_if_unchanged (expect true)',
         exists(select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'complete_tournament_match_if_unchanged')::text
  union all select '04 M3: tournament_orchestrator_leases (expect true)',
         (to_regclass('public.tournament_orchestrator_leases') is not null)::text
  union all select '05 08-31: complete_tournament_match and promote_tournament_match (expect true)',
         (exists(select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'complete_tournament_match')
          and exists(select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'promote_tournament_match'))::text
  union all select '06 M2: _live_event_slots (expect true)',
         exists(select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = '_live_event_slots')::text
  union all select '07 M4: the schedule is 18:00 / 21:00 America/New_York (expect true)',
         (exists(select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = '_live_event_timezone' and pg_get_functiondef(p.oid) like '%America/New_York%')
          and exists(select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = '_live_event_slot_times' and pg_get_functiondef(p.oid) like '%18:00%' and pg_get_functiondef(p.oid) like '%21:00%'))::text
  union all select '08 room_live_sessions, for restart restore (expect true)',
         (to_regclass('public.room_live_sessions') is not null)::text
  union all select '09 tournament functions defined twice (an old overload), expect 0',
         (select count(*)::text from (
            select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public'
               and p.proname in ('complete_tournament_match', 'promote_tournament_match', 'generate_tournament_bracket',
                                 'register_for_tournament', 'withdraw_from_tournament', 'seed_future_tournaments', 'ensure_tournament_seed_window')
             group by 1 having count(*) > 1) d)
  union all select '10 pg_cron installed (informational)',
         exists(select 1 from pg_extension where extname = 'pg_cron')::text
  union all select '20 past events that never ran, cancelled automatically at enablement (informational)',
         (select count(*)::text from public.scheduled_tournaments where status in ('upcoming', 'registration_open') and scheduled_start < now())
  union all select '21 registrations on unfinished events, expect 0',
         (select count(*)::text from public.scheduled_tournament_registrations r join public.scheduled_tournaments t on t.id = r.tournament_id
           where t.status in ('upcoming', 'registration_open', 'in_progress'))
  union all select '22 match rows on unfinished events, expect 0',
         (select count(*)::text from public.scheduled_tournament_matches m join public.scheduled_tournaments t on t.id = m.tournament_id
           where t.status in ('upcoming', 'registration_open', 'in_progress'))
  union all select '23 events open for registration or in progress right now, expect 0',
         (select count(*)::text from public.scheduled_tournaments where status in ('registration_open', 'in_progress'))
  union all select '24 security posture hard_fail_count, expect 0',
         (select (r ->> 'hard_fail_count') from public.assert_security_posture() r)
  union all select '30 events by status: ' || t.status, count(*)::text from public.scheduled_tournaments t group by t.status
  union all select '31 next upcoming event',
         coalesce((select to_char(t.scheduled_start at time zone 'America/New_York', 'Dy MM-DD HH24:MI') || ' ET'
                     from public.scheduled_tournaments t where t.status = 'upcoming' and t.scheduled_start > now() order by t.scheduled_start limit 1), '(none)')
) x
order by item;
