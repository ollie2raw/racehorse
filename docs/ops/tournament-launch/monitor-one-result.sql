-- Tournament event-night monitor: ONE read-only result table (the Supabase SQL editor shows only the last result of a
-- script, so the three queries in README.md "Monitoring" are combined here). Safe to run any time, as often as you like.
--
-- Read the `verdict` column: everything should say OK (or INFO). Anything else names what to look at.
--   lease          the orchestrator must have renewed in the last 2 minutes (the scheduler renews about every 60 s)
--   overdue events an event that should have started 2+ minutes ago and has not
--   stuck matches  ready past its deadline by 2+ minutes, or in progress for 25+ minutes (the match cap is 20)
--   the rest is context: the next event and how many are registered, what is live, and the last one that completed.

with lease as (
  select owner_id, renewed_at
  from public.tournament_orchestrator_leases
  order by renewed_at desc
  limit 1
),
overdue as (
  select count(*) as n, min(scheduled_start) as first_start
  from public.scheduled_tournaments
  where status in ('upcoming', 'registration_open')
    and scheduled_start < now() - interval '2 minutes'
),
stuck as (
  select count(*) as n
  from public.scheduled_tournament_matches
  where (status = 'ready' and ready_deadline_at < now() - interval '2 minutes')
     or (status = 'in_progress' and started_at < now() - interval '25 minutes')
),
nxt as (
  select t.id, t.status, t.scheduled_start,
         (select count(*) from public.scheduled_tournament_registrations r
           where r.tournament_id = t.id and r.status <> 'withdrawn') as registered
  from public.scheduled_tournaments t
  where t.status in ('upcoming', 'registration_open')
    and t.scheduled_start >= now() - interval '2 minutes'
  order by t.scheduled_start
  limit 1
),
live as (
  select
    (select count(*) from public.scheduled_tournaments where status = 'in_progress') as events,
    count(*) filter (where m.status = 'in_progress') as playing,
    count(*) filter (where m.status = 'ready') as ready,
    count(*) filter (where m.status = 'waiting') as waiting
  from public.scheduled_tournament_matches m
  join public.scheduled_tournaments t on t.id = m.tournament_id and t.status = 'in_progress'
),
done as (
  -- Completed events that have already started. A future cancelled slot is not a "last finished event".
  select scheduled_start, status
  from public.scheduled_tournaments
  where status = 'completed' and scheduled_start <= now()
  order by scheduled_start desc
  limit 1
)
select * from (
  select 1 as n, 'orchestrator lease' as what,
    coalesce((select round(extract(epoch from now() - renewed_at))::text || ' s since it last renewed' from lease), 'no lease row') as detail,
    case when not exists (select 1 from lease) then 'MISSING'
         when (select now() - renewed_at from lease) <= interval '2 minutes' then 'OK'
         else 'STALE' end as verdict
  union all
  select 2, 'overdue events',
    (select n::text from overdue) || ' event(s) past their start without starting',
    case when (select n from overdue) = 0 then 'OK' else 'LOOK' end
  union all
  select 3, 'stuck matches',
    (select n::text from stuck) || ' match(es) ready past the deadline or in progress too long',
    case when (select n from stuck) = 0 then 'OK' else 'LOOK' end
  union all
  select 4, 'next event',
    coalesce((select to_char(scheduled_start at time zone 'America/New_York', 'Dy Mon DD HH12:MI AM') || ' ET, ' || status
              || ', ' || registered::text || ' registered' from nxt), 'none scheduled'),
    case when exists (select 1 from nxt) then 'INFO' else 'LOOK' end
  union all
  select 5, 'live now',
    (select events::text || ' event(s) in progress; matches: ' || playing::text || ' playing, '
            || ready::text || ' ready, ' || waiting::text || ' waiting' from live),
    'INFO'
  union all
  select 6, 'last completed event',
    coalesce((select to_char(scheduled_start at time zone 'America/New_York', 'Dy Mon DD HH12:MI AM') || ' ET' from done), 'none yet'),
    'INFO'
) as report
order by n;
