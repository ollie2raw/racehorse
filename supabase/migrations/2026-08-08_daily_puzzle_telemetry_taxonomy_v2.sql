-- Extend Daily Puzzle telemetry from basic funnel events to the canonical
-- verification, command-conflict, retry, review, and leaderboard vocabulary.

alter table public.daily_puzzle_events
  drop constraint if exists daily_puzzle_events_event_type_check;

alter table public.daily_puzzle_events
  add constraint daily_puzzle_events_event_type_check check (event_type in (
    'mode_impression', 'start_requested', 'attempt_started', 'attempt_resumed',
    'first_move', 'slot_submitted', 'attempt_abandoned', 'recovery_started',
    'recovery_succeeded', 'recovery_failed', 'attempt_completed',
    'share_requested', 'share_completed', 'verification_failed',
    'command_conflict', 'retry_requested', 'review_opened',
    'leaderboard_opened', 'request_failed'
  ));

drop index if exists public.idx_daily_puzzle_events_failures;
create index idx_daily_puzzle_events_failures
  on public.daily_puzzle_events (failure_phase, failure_code, created_at)
  where event_type in (
    'verification_failed', 'command_conflict', 'request_failed', 'recovery_failed'
  );

create or replace view public.daily_puzzle_failure_metrics as
select run_date, event_type, coalesce(failure_phase, 'unknown') as failure_phase,
  coalesce(failure_code, 'unknown') as failure_code, count(*)::bigint as total
from public.daily_puzzle_events
where event_type in (
  'verification_failed', 'command_conflict', 'request_failed', 'recovery_failed'
)
group by run_date, event_type, failure_phase, failure_code;

-- Manual rollback (only after deleting or remapping all v2-only event rows):
-- alter table public.daily_puzzle_events
--   drop constraint if exists daily_puzzle_events_event_type_check;
-- alter table public.daily_puzzle_events
--   add constraint daily_puzzle_events_event_type_check check (event_type in (
--     'mode_impression', 'start_requested', 'attempt_started', 'attempt_resumed',
--     'first_move', 'slot_submitted', 'attempt_abandoned', 'recovery_started',
--     'recovery_succeeded', 'recovery_failed', 'attempt_completed',
--     'share_requested', 'share_completed', 'request_failed'
--   ));
