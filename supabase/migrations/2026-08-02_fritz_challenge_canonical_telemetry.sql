create table if not exists public.fritz_challenge_events (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.fritz_challenges(id) on delete cascade,
  attempt_id uuid null references public.fritz_challenge_attempts(id) on delete cascade,
  user_id uuid null references auth.users(id) on delete set null,
  event_type text not null check (event_type in (
    'challenge_created', 'challenge_joined', 'attempt_started', 'attempt_resumed',
    'first_move', 'hand_verified', 'game_recorded', 'attempt_completed',
    'command_conflict', 'verification_failed', 'request_failed', 'recovery_succeeded'
  )),
  source text not null check (source in ('server', 'outbox', 'client')),
  idempotency_key text not null unique,
  authority_revision bigint null,
  game_number int null check (game_number between 1 and 3),
  hand_index int null check (hand_index >= 0),
  verifier_code text null,
  status_code int null,
  duration_ms int null check (duration_ms >= 0),
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists idx_fritz_challenge_events_funnel
  on public.fritz_challenge_events (challenge_id, event_type, occurred_at desc);
create index if not exists idx_fritz_challenge_events_attempt
  on public.fritz_challenge_events (attempt_id, occurred_at desc);

alter table public.fritz_challenge_events enable row level security;
create policy "fritz_challenge_events_no_client_access"
  on public.fritz_challenge_events for all to authenticated using (false) with check (false);

create or replace view public.fritz_challenge_funnel_metrics with (security_invoker = true) as
select challenge_id, event_type, count(*)::bigint as total
from public.fritz_challenge_events
group by challenge_id, event_type;

create or replace view public.fritz_challenge_failure_metrics with (security_invoker = true) as
select event_type, coalesce(verifier_code, 'none') as verifier_code,
       coalesce(status_code, 0) as status_code, count(*)::bigint as total
from public.fritz_challenge_events
where event_type in ('command_conflict', 'verification_failed', 'request_failed')
group by event_type, verifier_code, status_code;

revoke all on public.fritz_challenge_funnel_metrics from anon, authenticated;
revoke all on public.fritz_challenge_failure_metrics from anon, authenticated;
