alter table public.daily_fritz_events
  add column if not exists challenge_id text null references public.daily_fritz_published_challenges(challenge_id),
  add column if not exists authority_revision bigint null check (authority_revision is null or authority_revision >= 0),
  add column if not exists event_version int not null default 1 check (event_version > 0),
  add column if not exists source text not null default 'server' check (source in ('server', 'client', 'outbox')),
  add column if not exists session_id text null,
  add column if not exists client_release text null,
  add column if not exists duration_ms int null check (duration_ms is null or duration_ms >= 0),
  add column if not exists failure_phase text null check (
    failure_phase is null or failure_phase in (
      'challenge', 'start', 'verification', 'command', 'persistence',
      'recovery', 'submission', 'unknown'
    )
  ),
  add column if not exists recovery_class text null check (
    recovery_class is null or recovery_class in (
      'transparent_retry', 'authoritative_refresh', 'client_update_required',
      'terminal_integrity_failure', 'not_applicable'
    )
  );

alter table public.daily_fritz_outbox
  add column if not exists analytics_projected_at timestamptz null;

alter table public.daily_fritz_events
  drop constraint if exists daily_fritz_events_event_type_check;
alter table public.daily_fritz_events
  add constraint daily_fritz_events_event_type_check check (event_type in (
    'mode_impression', 'start_requested', 'attempt_started', 'attempt_resumed',
    'first_move', 'hand_started', 'hand_verified', 'next_hand_replayed',
    'game_started', 'game_recorded', 'set_continued', 'attempt_completed',
    'attempt_abandoned', 'verification_failed', 'command_conflict',
    'recovery_started', 'recovery_succeeded', 'recovery_failed',
    'request_failed', 'retry_request', 'review_opened', 'leaderboard_opened',
    'share_requested', 'share_completed'
  ));

create index if not exists idx_daily_fritz_events_challenge_funnel
  on public.daily_fritz_events (challenge_id, event_type, created_at);
create index if not exists idx_daily_fritz_events_user_retention
  on public.daily_fritz_events (user_id, run_date, event_type, created_at);
create index if not exists idx_daily_fritz_events_failures
  on public.daily_fritz_events (failure_phase, recovery_class, verifier_code, created_at)
  where event_type in ('verification_failed', 'command_conflict', 'recovery_failed', 'request_failed');

create or replace function public.project_daily_fritz_outbox_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  event_user_id uuid;
  event_run_date date;
begin
  select user_id, run_date into event_user_id, event_run_date
    from public.daily_fritz_attempts where id = new.attempt_id;
  insert into public.daily_fritz_events (
    attempt_id, run_date, user_id, event_type, challenge_id,
    authority_revision, event_version, source, game_number, hand_index,
    idempotency_key, payload, created_at
  ) values (
    new.attempt_id, event_run_date, event_user_id, new.event_type, new.challenge_id,
    case when jsonb_typeof(new.payload->'revision') = 'number'
      then (new.payload->>'revision')::bigint else null end,
    new.event_version, 'outbox',
    case when jsonb_typeof(new.payload->'gameNumber') = 'number'
      then (new.payload->>'gameNumber')::int else null end,
    case when jsonb_typeof(new.payload->'handIndex') = 'number'
      then (new.payload->>'handIndex')::int else null end,
    'outbox:' || new.id::text, new.payload, new.occurred_at
  ) on conflict (idempotency_key) do nothing;
  update public.daily_fritz_outbox
    set analytics_projected_at = now()
    where id = new.id;
  return new;
end;
$$;

drop trigger if exists daily_fritz_outbox_project_event on public.daily_fritz_outbox;
create trigger daily_fritz_outbox_project_event
after insert on public.daily_fritz_outbox
for each row execute function public.project_daily_fritz_outbox_event();

create or replace view public.daily_fritz_funnel_metrics
with (security_invoker = true) as
select run_date, challenge_id, event_type, count(*)::bigint as total,
  count(distinct user_id)::bigint as unique_users
from public.daily_fritz_events
group by run_date, challenge_id, event_type;

create or replace view public.daily_fritz_failure_metrics
with (security_invoker = true) as
select run_date, challenge_id, failure_phase, recovery_class, verifier_code,
  count(*)::bigint as total
from public.daily_fritz_events
where event_type in ('verification_failed', 'command_conflict', 'recovery_failed', 'request_failed')
group by run_date, challenge_id, failure_phase, recovery_class, verifier_code;

create or replace view public.daily_fritz_retention_metrics
with (security_invoker = true) as
with cohorts as (
  select user_id, min(run_date) as cohort_date
  from public.daily_fritz_events
  where user_id is not null and run_date is not null
    and event_type = 'attempt_started'
  group by user_id
), active_days as (
  select distinct user_id, run_date
  from public.daily_fritz_events
  where user_id is not null and run_date is not null
    and event_type in ('mode_impression', 'start_requested', 'attempt_started', 'attempt_resumed', 'first_move')
)
select c.cohort_date,
  count(*)::bigint as cohort_users,
  count(*) filter (where exists (
    select 1 from active_days a
    where a.user_id = c.user_id and a.run_date = c.cohort_date + 1
  ))::bigint as next_day_returned_users,
  count(*) filter (where exists (
    select 1 from active_days a
    where a.user_id = c.user_id
      and a.run_date between c.cohort_date + 1 and c.cohort_date + 7
  ))::bigint as seven_day_returned_users
from cohorts c
group by c.cohort_date;

revoke all on public.daily_fritz_funnel_metrics from anon, authenticated;
revoke all on public.daily_fritz_failure_metrics from anon, authenticated;
revoke all on public.daily_fritz_retention_metrics from anon, authenticated;
grant select on public.daily_fritz_funnel_metrics to service_role;
grant select on public.daily_fritz_failure_metrics to service_role;
grant select on public.daily_fritz_retention_metrics to service_role;
