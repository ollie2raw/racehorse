create table if not exists public.daily_fritz_events (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid null references public.daily_fritz_attempts(id) on delete cascade,
  run_date date null references public.daily_fritz_runs(run_date) on delete set null,
  user_id uuid null references auth.users(id) on delete set null,
  request_id text null,
  event_type text not null check (
    event_type in (
      'attempt_started',
      'hand_verified',
      'next_hand_replayed',
      'game_recorded',
      'attempt_completed',
      'attempt_abandoned',
      'verification_failed',
      'request_failed',
      'retry_request'
    )
  ),
  game_number int null check (game_number is null or game_number between 1 and 3),
  hand_index int null check (hand_index is null or hand_index >= 0),
  status_code int null,
  verifier_code text null,
  transcript_digest text null,
  idempotency_key text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_daily_fritz_events_idempotency
  on public.daily_fritz_events (idempotency_key);

create index if not exists idx_daily_fritz_events_attempt_created
  on public.daily_fritz_events (attempt_id, created_at);

create index if not exists idx_daily_fritz_events_run_type_created
  on public.daily_fritz_events (run_date, event_type, created_at);

create or replace view public.daily_fritz_event_metrics
  with (security_invoker = true) as
select
  event_type,
  verifier_code,
  count(*)::bigint as total
from public.daily_fritz_events
group by event_type, verifier_code;

revoke all on public.daily_fritz_event_metrics from anon, authenticated;
grant select on public.daily_fritz_event_metrics to service_role;

alter table public.daily_fritz_events enable row level security;

drop policy if exists "daily_fritz_events_no_client_access" on public.daily_fritz_events;
create policy "daily_fritz_events_no_client_access"
  on public.daily_fritz_events
  for all
  to authenticated
  using (false)
  with check (false);
