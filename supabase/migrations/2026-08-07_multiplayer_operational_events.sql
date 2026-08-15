create table if not exists public.multiplayer_operational_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in (
    'action_accepted', 'action_rejected', 'stale_command', 'request_id_conflict',
    'duplicate_replay', 'persistence_succeeded', 'persistence_failed',
    'room_hydration_succeeded', 'room_hydration_failed',
    'reconnect_started', 'reconnect_succeeded', 'reconnect_failed'
  )),
  room_code text,
  request_id text,
  action_type text,
  error_code text,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  release text,
  idempotency_key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_multiplayer_operational_events_type_created
  on public.multiplayer_operational_events (event_type, created_at);
create index if not exists idx_multiplayer_operational_events_room_created
  on public.multiplayer_operational_events (room_code, created_at);

alter table public.multiplayer_operational_events enable row level security;
drop policy if exists "multiplayer_operational_events_no_client_access" on public.multiplayer_operational_events;
create policy "multiplayer_operational_events_no_client_access"
  on public.multiplayer_operational_events for all to authenticated using (false) with check (false);

create or replace view public.multiplayer_operational_metrics as
select date_trunc('hour', created_at) as bucket,
  event_type,
  coalesce(error_code, 'none') as error_code,
  count(*)::bigint as total,
  percentile_cont(0.50) within group (order by duration_ms) filter (where duration_ms is not null) as p50_ms,
  percentile_cont(0.95) within group (order by duration_ms) filter (where duration_ms is not null) as p95_ms,
  percentile_cont(0.99) within group (order by duration_ms) filter (where duration_ms is not null) as p99_ms
from public.multiplayer_operational_events
group by date_trunc('hour', created_at), event_type, error_code;

-- Rollback: drop view public.multiplayer_operational_metrics, then table
-- public.multiplayer_operational_events after disabling application writes.
