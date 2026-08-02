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
  event_version int not null default 1 check (event_version > 0),
  idempotency_key text not null unique,
  authority_revision bigint null,
  game_number int null check (game_number between 1 and 3),
  hand_index int null check (hand_index >= 0),
  verifier_code text null,
  status_code int null,
  duration_ms int null check (duration_ms >= 0),
  failure_phase text null check (failure_phase is null or failure_phase in (
    'challenge', 'start', 'verification', 'command', 'persistence', 'recovery', 'unknown'
  )),
  recovery_class text null check (recovery_class is null or recovery_class in (
    'transparent_retry', 'authoritative_refresh', 'client_update_required',
    'terminal_integrity_failure', 'not_applicable'
  )),
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

alter table public.fritz_challenge_outbox
  add column if not exists analytics_projected_at timestamptz null;

create index if not exists idx_fritz_challenge_events_funnel
  on public.fritz_challenge_events (challenge_id, event_type, occurred_at desc);
create index if not exists idx_fritz_challenge_events_attempt
  on public.fritz_challenge_events (attempt_id, occurred_at desc);

alter table public.fritz_challenge_events enable row level security;
create policy "fritz_challenge_events_no_client_access"
  on public.fritz_challenge_events for all to authenticated using (false) with check (false);

create or replace function public.project_fritz_challenge_outbox_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  event_user_id uuid;
begin
  select user_id into event_user_id
    from public.fritz_challenge_attempts where id = new.attempt_id;
  insert into public.fritz_challenge_events (
    challenge_id, attempt_id, user_id, event_type, source, event_version,
    authority_revision, game_number, hand_index, idempotency_key, payload, occurred_at
  ) values (
    new.challenge_id, new.attempt_id, event_user_id, new.event_type, 'outbox', 1,
    case when jsonb_typeof(new.payload->'revision') = 'number'
      then (new.payload->>'revision')::bigint else null end,
    case when jsonb_typeof(new.payload->'gameNumber') = 'number'
      then (new.payload->>'gameNumber')::int else null end,
    case when jsonb_typeof(new.payload->'handIndex') = 'number'
      then (new.payload->>'handIndex')::int else null end,
    'outbox:' || new.id::text, new.payload, new.occurred_at
  ) on conflict (idempotency_key) do nothing;
  update public.fritz_challenge_outbox
    set analytics_projected_at = now() where id = new.id;
  return new;
end;
$$;

drop trigger if exists fritz_challenge_outbox_project_event on public.fritz_challenge_outbox;
create trigger fritz_challenge_outbox_project_event
after insert on public.fritz_challenge_outbox
for each row execute function public.project_fritz_challenge_outbox_event();

create or replace view public.fritz_challenge_funnel_metrics with (security_invoker = true) as
select challenge_id, event_type, count(*)::bigint as total
from public.fritz_challenge_events
group by challenge_id, event_type;

create or replace view public.fritz_challenge_failure_metrics with (security_invoker = true) as
select event_type, coalesce(failure_phase, 'unknown') as failure_phase,
       coalesce(recovery_class, 'not_applicable') as recovery_class,
       coalesce(verifier_code, 'none') as verifier_code,
       coalesce(status_code, 0) as status_code, count(*)::bigint as total
from public.fritz_challenge_events
where event_type in ('command_conflict', 'verification_failed', 'request_failed')
group by event_type, failure_phase, recovery_class, verifier_code, status_code;

revoke all on public.fritz_challenge_funnel_metrics from anon, authenticated;
revoke all on public.fritz_challenge_failure_metrics from anon, authenticated;
