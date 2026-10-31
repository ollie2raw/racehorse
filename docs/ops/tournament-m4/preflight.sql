-- M4 preflight — READ-ONLY. Run in the Supabase SQL editor before applying
-- supabase/migrations/2026-10-31_tournament_live_event_times_eastern.sql
-- (Live Events move from 17:00 / 20:00 America/Los_Angeles to 18:00 / 21:00 America/New_York).
-- Nothing here writes. It uses no M4 object (they don't exist yet), so the new schedule is spelled out:
-- America/New_York, 18:00 and 21:00. Requires M2 (the _live_event_* helpers must already exist).
--
-- Expected: rows marked "expect 0" are 0. If not, M4 still applies safely — it leaves those rows untouched — but look at
-- them first (query 2).

-- 0. M2 must be in place, and the schedule must still be the Pacific one (expect: America/Los_Angeles).
select public._live_event_timezone() as current_timezone,
       (select array_agg(t order by t) from public._live_event_slot_times() t) as current_slot_times;

-- 1. Counts
with t as (
  select s.*,
         (s.scheduled_start at time zone 'America/New_York')::time in ('18:00', '21:00') as at_new_slot,
         exists (select 1 from public.scheduled_tournament_registrations r where r.tournament_id = s.id) as has_reg,
         exists (select 1 from public.scheduled_tournament_matches m where m.tournament_id = s.id) as has_match
    from public.scheduled_tournaments s
)
select 'will cancel: future upcoming Live off the new slots, empty, > 35 min away (the old 5 pm / 8 pm PT inventory)' as item,
       count(*) filter (where kind = 'live' and status = 'upcoming' and scheduled_start > now() + interval '35 minutes' and not at_new_slot and not has_reg and not has_match) as n
  from t
union all
select 'left untouched, expect 0: future upcoming Live off the new slots WITH registrations (an event somebody entered keeps its old time)',
       count(*) filter (where kind = 'live' and status = 'upcoming' and scheduled_start > now() + interval '35 minutes' and not at_new_slot and has_reg) from t
union all
select 'left untouched, expect 0: future upcoming Live off the new slots WITH match rows',
       count(*) filter (where kind = 'live' and status = 'upcoming' and scheduled_start > now() + interval '35 minutes' and not at_new_slot and has_match) from t
union all
select 'kept: registration_open Live events (any time)',
       count(*) filter (where kind = 'live' and status = 'registration_open') from t
union all
select 'kept: upcoming Live starting within 35 min (transition)',
       count(*) filter (where kind = 'live' and status = 'upcoming' and scheduled_start > now() and scheduled_start <= now() + interval '35 minutes') from t
union all
select 'existing future Live rows already at 18:00 / 21:00 ET (kept; expect 0 before M4)',
       count(*) filter (where kind = 'live' and status in ('upcoming', 'registration_open') and scheduled_start > now() and at_new_slot) from t
union all
select 'existing CANCELLED rows at future 18:00 / 21:00 ET (stay cancelled: that slot will be empty; expect 0)',
       count(*) filter (where status = 'cancelled' and scheduled_start > now() and at_new_slot) from t
union all
select 'Fritz Cups (informational; never touched)',
       count(*) filter (where kind = 'fritz_cup') from t;

-- 2. The anomalies themselves (expect no rows).
select s.id, s.status, s.scheduled_start,
       (select count(*) from public.scheduled_tournament_registrations r where r.tournament_id = s.id) as registrations,
       (select count(*) from public.scheduled_tournament_matches m where m.tournament_id = s.id) as match_rows
  from public.scheduled_tournaments s
 where s.kind = 'live' and s.status = 'upcoming' and s.scheduled_start > now()
   and (exists (select 1 from public.scheduled_tournament_registrations r where r.tournament_id = s.id)
     or exists (select 1 from public.scheduled_tournament_matches m where m.tournament_id = s.id))
 order by s.scheduled_start;

-- 3. The next 12 scheduled Live rows and what M4 will do to each.
select s.status,
       to_char(s.scheduled_start at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || 'Z' as utc,
       to_char(s.scheduled_start at time zone 'America/Los_Angeles', 'Dy MM-DD HH24:MI') || ' PT' as pacific,
       to_char(s.scheduled_start at time zone 'America/New_York', 'Dy MM-DD HH24:MI') || ' ET' as eastern,
       case
         when s.status <> 'upcoming' then 'keep'
         when s.scheduled_start <= now() then 'keep (past)'
         when s.scheduled_start <= now() + interval '35 minutes' then 'keep (transition)'
         when (s.scheduled_start at time zone 'America/New_York')::time in ('18:00', '21:00') then 'keep, window -> 12 h / 2 min'
         when exists (select 1 from public.scheduled_tournament_registrations r where r.tournament_id = s.id)
           or exists (select 1 from public.scheduled_tournament_matches m where m.tournament_id = s.id) then 'keep (anomaly)'
         else 'cancel (schedule_changed)'
       end as m4_action
  from public.scheduled_tournaments s
 where s.kind = 'live' and s.status in ('upcoming', 'registration_open') and s.scheduled_start > now() - interval '2 hours'
 order by s.scheduled_start
 limit 12;
