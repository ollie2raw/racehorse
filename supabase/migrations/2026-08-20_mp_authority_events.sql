-- NOTE (2026-09-01): this file was NEVER applied to prod (confirmed absent —
-- HARDENING_PLAN MP-G6). Superseded by
-- 2026-09-01_apply_room_command_receipts_and_mp_authority_events.sql, which
-- drops the `event` CHECK (already 4 event names behind the code) and adds a
-- self-assert. Kept as the historical record.
--
-- Durable mp.authority funnel (service-role insert). Best-effort from the
-- game server — insert failure must never block gameplay.

create table if not exists public.mp_authority_events (
  id uuid primary key default gen_random_uuid(),
  event text not null check (
    event in (
      'private_lobby_created',
      'private_match_started',
      'private_action_committed',
      'private_action_uncertain',
      'private_action_duplicate',
      'private_reconnect_hydrated',
      'private_receipts_hydrated',
      'private_rematch_started',
      'private_match_abandoned',
      'private_match_archived',
      'private_durability_degraded',
      'private_durability_failed',
      'private_move_log_verification_failed',
      'private_terminal_recovery'
    )
  ),
  ts timestamptz not null default now(),
  room_code text null,
  seat_id text null,
  request_id text null,
  failure_code text null,
  payload jsonb not null default '{}'::jsonb,
  source_type text null check (
    source_type is null or source_type in ('private', 'quick', 'tournament')
  )
);

create index if not exists idx_mp_authority_events_event_ts
  on public.mp_authority_events (event, ts);

create index if not exists idx_mp_authority_events_room_ts
  on public.mp_authority_events (room_code, ts);

alter table public.mp_authority_events enable row level security;

drop policy if exists "mp_authority_events_no_client_access" on public.mp_authority_events;
create policy "mp_authority_events_no_client_access"
  on public.mp_authority_events
  for all
  to authenticated
  using (false)
  with check (false);

revoke all on public.mp_authority_events from anon, authenticated;
grant insert, select on public.mp_authority_events to service_role;

-- Pacific calendar date + event, same operational shape as daily_fritz_funnel_metrics.
create or replace view public.mp_authority_funnel_metrics
  with (security_invoker = true) as
select
  (ts at time zone 'America/Los_Angeles')::date as event_date,
  event,
  count(*)::bigint as total
from public.mp_authority_events
group by 1, 2;

revoke all on public.mp_authority_funnel_metrics from anon, authenticated;
grant select on public.mp_authority_funnel_metrics to service_role;
