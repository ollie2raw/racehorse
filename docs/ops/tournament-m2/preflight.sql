-- M2 preflight — READ-ONLY. Run in the Supabase SQL editor before applying
-- supabase/migrations/2026-10-10_tournament_live_event_cadence.sql.
-- Nothing here writes. It uses no M2 object (they don't exist yet), so the
-- schedule rule is spelled out: America/Los_Angeles, 17:00 and 20:00.
--
-- Expected: rows marked "expect 0" are 0. If not, M2 still applies safely — it
-- leaves those rows untouched — but look at them first (query 3).

-- 1. Counts
with t as (
  select s.*,
         (s.scheduled_start at time zone 'America/Los_Angeles')::time in ('17:00', '20:00') as at_slot,
         exists (select 1 from public.scheduled_tournament_registrations r where r.tournament_id = s.id) as has_reg,
         exists (select 1 from public.scheduled_tournament_matches m where m.tournament_id = s.id) as has_match
    from public.scheduled_tournaments s
)
select 'will cancel: future upcoming Live off-slot, empty, > 35 min away' as item,
       count(*) filter (where kind = 'live' and status = 'upcoming' and scheduled_start > now() + interval '35 minutes' and not at_slot and not has_reg and not has_match) as n
  from t
union all
select 'left untouched, expect 0: future upcoming Live off-slot WITH registrations',
       count(*) filter (where kind = 'live' and status = 'upcoming' and scheduled_start > now() + interval '35 minutes' and not at_slot and has_reg) from t
union all
select 'left untouched, expect 0: future upcoming Live off-slot WITH match rows',
       count(*) filter (where kind = 'live' and status = 'upcoming' and scheduled_start > now() + interval '35 minutes' and not at_slot and has_match) from t
union all
select 'kept: registration_open Live events (any time)',
       count(*) filter (where kind = 'live' and status = 'registration_open') from t
union all
select 'kept: upcoming Live starting within 35 min (transition)',
       count(*) filter (where kind = 'live' and status = 'upcoming' and scheduled_start > now() and scheduled_start <= now() + interval '35 minutes') from t
union all
select 'kept: past upcoming Live rows (never opened)',
       count(*) filter (where kind = 'live' and status = 'upcoming' and scheduled_start <= now()) from t
union all
select 'existing future Live rows at 17:00 / 20:00 PT (kept, window -> 12 h / 2 min)',
       count(*) filter (where kind = 'live' and status in ('upcoming', 'registration_open') and scheduled_start > now() and at_slot and not has_match) from t
union all
select 'existing future Live rows at 17:00 / 20:00 PT with match rows (left untouched, expect 0)',
       count(*) filter (where kind = 'live' and status in ('upcoming', 'registration_open') and scheduled_start > now() and at_slot and has_match) from t
union all
select 'existing CANCELLED rows at future 17:00 / 20:00 PT (stay cancelled: that slot will be empty)',
       count(*) filter (where status = 'cancelled' and scheduled_start > now() and at_slot) from t
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

-- 3. The next 12 scheduled Live rows and what M2 will do to each.
select s.status,
       to_char(s.scheduled_start at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || 'Z' as utc,
       to_char(s.scheduled_start at time zone 'America/Los_Angeles', 'Dy MM-DD HH24:MI') || ' PT' as pacific,
       to_char(s.scheduled_start at time zone 'America/New_York', 'HH24:MI') || ' ET' as eastern,
       case
         when s.status <> 'upcoming' then 'keep'
         when s.scheduled_start <= now() then 'keep (past)'
         when s.scheduled_start <= now() + interval '35 minutes' then 'keep (transition)'
         when (s.scheduled_start at time zone 'America/Los_Angeles')::time in ('17:00', '20:00') then 'keep, window -> 12 h / 2 min'
         when exists (select 1 from public.scheduled_tournament_registrations r where r.tournament_id = s.id)
           or exists (select 1 from public.scheduled_tournament_matches m where m.tournament_id = s.id) then 'keep (anomaly)'
         else 'cancel (cadence_replaced)'
       end as m2_action
  from public.scheduled_tournaments s
 where s.kind = 'live' and s.status in ('upcoming', 'registration_open') and s.scheduled_start > now() - interval '2 hours'
 order by s.scheduled_start
 limit 12;
