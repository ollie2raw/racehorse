-- Allow checkpoint_saved analytics events (server + Phase 1.6 metric mirror).
-- Regression: 2026-08-01 canonical telemetry migration omitted checkpoint_saved
-- from event_type CHECK while the checkpoint route still emitted it.

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
    'share_requested', 'share_completed', 'checkpoint_saved'
  ));
