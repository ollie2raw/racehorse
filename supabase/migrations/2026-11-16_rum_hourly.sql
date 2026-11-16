-- First-party speed measurements, hourly totals (docs/ops/rum-beacon.md).
--
-- Written by the game server only when RUM_SUPABASE_APPEND_ENABLED=true (default off): one row per hour, group and metric, from the
-- server's in-memory totals. No row ever describes fewer than 5 summaries (the CHECK below repeats the server's floor), and no row
-- holds an identifier of any kind: the beacon carries none and the server keeps none. A daily job on the server deletes rows older
-- than 12 months (DELETE ... WHERE hour < now() - 365 days); the index makes that cheap.
--
-- Safe in any order: nothing reads or writes the table unless the flag is on.
-- Rollback: unset RUM_SUPABASE_APPEND_ENABLED and redeploy; dropping the table is optional afterwards.

begin;

create table if not exists public.rum_hourly (
  hour timestamptz not null,
  -- 'all', or '<dimension>:<value>' (plat:web, form:phone, scr:s, mem:4, net:4g), or 'other:<dimension>'
  grp text not null,
  metric text not null,
  reports integer not null check (reports >= 5),
  n integer not null check (n >= 0),
  p50 integer not null check (p50 >= 0),
  p75 integer not null check (p75 >= 0),
  p95 integer not null check (p95 >= 0),
  max integer not null check (max >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  primary key (hour, grp, metric)
);

create index if not exists rum_hourly_hour_idx on public.rum_hourly (hour);

alter table public.rum_hourly enable row level security;
-- No policies: server-only (service_role bypasses RLS), the same posture as room_live_sessions.
revoke all on table public.rum_hourly from anon, authenticated;
grant select, insert, update, delete on table public.rum_hourly to service_role;

commit;

notify pgrst, 'reload schema';
