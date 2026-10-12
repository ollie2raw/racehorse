-- Tournament launch — PRODUCTION read-only preflight (Phase 4A).
-- Paste into the production Supabase SQL editor. Every statement is a SELECT;
-- nothing is written. Keep the full output with the launch notes.

set default_transaction_read_only = on;

-- P1. Which launch objects already exist (before M1: the 08-31 rows decide whether
--     tournament-v2-preflight pieces A-D go first; M1..M2 rows false; room_live_sessions true).
select x.what, x.present
from (values
  ('08-31 complete_tournament_match',                exists(select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'complete_tournament_match')),
  ('08-31 promote_tournament_match',                 exists(select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'promote_tournament_match')),
  ('M1 scheduled_tournaments.kind',                  exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'scheduled_tournaments' and column_name = 'kind')),
  ('M1 start_fritz_cup',                             exists(select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'start_fritz_cup')),
  ('CAS complete_tournament_match_if_unchanged',     exists(select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'complete_tournament_match_if_unchanged')),
  ('M3 tournament_orchestrator_leases',              to_regclass('public.tournament_orchestrator_leases') is not null),
  ('M2 _live_event_slots',                           exists(select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = '_live_event_slots')),
  ('room_live_sessions (restart restore; expect true)', to_regclass('public.room_live_sessions') is not null)
) as x(what, present);

-- P2. One row per name expected (two rows = an old overload exists: stop).
select p.proname, count(*) as overloads, string_agg(pg_get_function_identity_arguments(p.oid), ' / ') as signatures
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('complete_tournament_match', 'promote_tournament_match', 'generate_tournament_bracket',
                    'register_for_tournament', 'withdraw_from_tournament',
                    'seed_future_tournaments', 'ensure_tournament_seed_window')
group by 1 order by 1;

-- P3. Which seed body is live (the 05-17 body closes at T-2; 05-14/16 at T-5).
select case
         when pg_get_functiondef('public.seed_future_tournaments(integer)'::regprocedure) like '%_live_event_slots%' then 'M2 body (17:00 / 20:00 PT)'
         when pg_get_functiondef('public.seed_future_tournaments(integer)'::regprocedure) like '%2 minutes%' then '05-17 body (30-min cadence, close T-2)'
         when pg_get_functiondef('public.seed_future_tournaments(integer)'::regprocedure) like '%5 minutes%' then '05-14/05-16 body (30-min cadence, close T-5)'
         else 'unknown body: send the definition'
       end as seed_body;

-- P4. pg_cron and any tournament seed job.
select exists(select 1 from pg_extension where extname = 'pg_cron') as pg_cron_installed;
-- Only if the line above is true, run this one too:
-- select jobid, jobname, schedule, active, command from cron.job where command ilike '%tournament%';

-- P5. Migration tracking (if this project uses it; an error here just means it doesn't).
select to_regclass('supabase_migrations.schema_migrations') is not null as has_migration_table;
-- If true: select version, name from supabase_migrations.schema_migrations order by version desc limit 40;

-- P6. Tournament rows by status (and the stale backlog the scheduler will drain at enablement).
select status, count(*) as rows,
       count(*) filter (where scheduled_start < now()) as past,
       count(*) filter (where scheduled_start >= now()) as future,
       min(scheduled_start) filter (where scheduled_start >= now()) as next_future
from public.scheduled_tournaments
group by 1 order by 1;

select count(*) as stale_backlog_rows
from public.scheduled_tournaments
where status in ('upcoming', 'registration_open') and scheduled_start < now();

-- P7. Anything a human touched on a not-yet-finished row (expect 0 / 0).
select (select count(*) from public.scheduled_tournament_registrations r
          join public.scheduled_tournaments t on t.id = r.tournament_id
         where t.status in ('upcoming', 'registration_open', 'in_progress')) as live_registrations,
       (select count(*) from public.scheduled_tournament_matches m
          join public.scheduled_tournaments t on t.id = m.tournament_id
         where t.status in ('upcoming', 'registration_open', 'in_progress')) as live_match_rows;

-- P8. Anything in progress right now (expect 0 rows while tournaments are off).
select id, status, scheduled_start from public.scheduled_tournaments
where status in ('registration_open', 'in_progress') order by scheduled_start limit 20;

-- P9. Security posture (the repo's standing check).
select (r ->> 'hard_fail_count')::int as hard_fail_count from public.assert_security_posture() r;
