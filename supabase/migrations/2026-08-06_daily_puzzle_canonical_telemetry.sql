create table if not exists public.daily_puzzle_events (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid references public.daily_puzzle_attempts(id) on delete set null,
  run_date date not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in (
    'mode_impression', 'start_requested', 'attempt_started', 'attempt_resumed',
    'first_move', 'slot_submitted', 'attempt_abandoned', 'recovery_started',
    'recovery_succeeded', 'recovery_failed', 'attempt_completed',
    'share_requested', 'share_completed', 'request_failed'
  )),
  event_version integer not null default 1,
  slot_index integer check (slot_index is null or slot_index between 1 and 5),
  request_id text,
  failure_code text,
  failure_phase text,
  recovery_class text,
  session_id text,
  client_release text,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  source text not null default 'server' check (source in ('server', 'client')),
  idempotency_key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_daily_puzzle_events_funnel
  on public.daily_puzzle_events (run_date, event_type, created_at);
create index if not exists idx_daily_puzzle_events_attempt
  on public.daily_puzzle_events (attempt_id, created_at);
create index if not exists idx_daily_puzzle_events_failures
  on public.daily_puzzle_events (failure_phase, failure_code, created_at)
  where event_type in ('request_failed', 'recovery_failed');

alter table public.daily_puzzle_events enable row level security;
drop policy if exists "daily_puzzle_events_no_client_access" on public.daily_puzzle_events;
create policy "daily_puzzle_events_no_client_access"
  on public.daily_puzzle_events for all to authenticated using (false) with check (false);

create or replace view public.daily_puzzle_event_funnel as
select run_date, event_type, count(*)::bigint as total,
  count(distinct user_id)::bigint as unique_users
from public.daily_puzzle_events
group by run_date, event_type;

create or replace view public.daily_puzzle_failure_metrics as
select run_date, event_type, coalesce(failure_phase, 'unknown') as failure_phase,
  coalesce(failure_code, 'unknown') as failure_code, count(*)::bigint as total
from public.daily_puzzle_events
where event_type in ('request_failed', 'recovery_failed')
group by run_date, event_type, failure_phase, failure_code;

-- Rollback (manual, after application rollback):
-- drop view if exists public.daily_puzzle_failure_metrics;
-- drop view if exists public.daily_puzzle_event_funnel;
-- drop table if exists public.daily_puzzle_events;
