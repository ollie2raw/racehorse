-- Record why a tournament was cancelled (tournament review Q9).
--
-- The scheduler used to retry a tournament whose bracket could not be created
-- every 30 s forever, silently. It now alerts and cancels after a run of
-- consecutive failures, and every cancel path writes its reason here:
--   not_enough_players              — nobody registered by the close time
--   active_window_expired           — in_progress past the 2-hour window
--   bracket_generation_failed:<code> — close-and-start failed N ticks in a row
--
-- Nullable, no default: rows cancelled before this column existed keep null.
-- Apply before deploying the server that writes it (the PATCH names the column).

alter table public.scheduled_tournaments
  add column if not exists cancel_reason text;
