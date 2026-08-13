-- Performance indexes for daily_puzzle_attempts hot paths.
--
-- NOTE: All three indexes below were later found to be redundant with pre-existing
-- definitions in daily_puzzle_ladder_v1.sql.  They are dropped immediately by the
-- follow-up migration 2026-08-12_drop_redundant_puzzle_indexes.sql.
-- The CREATE INDEX IF NOT EXISTS statements are kept here for history; they are
-- no-ops on any DB where the drop migration has already run.
--
-- See 2026-08-12_drop_redundant_puzzle_indexes.sql for the full coverage analysis.

create index if not exists idx_daily_puzzle_attempts_date_user
  on public.daily_puzzle_attempts(puzzle_date, user_id);

create index if not exists idx_daily_puzzle_attempts_date_leaderboard
  on public.daily_puzzle_attempts(puzzle_date, completed_at asc nulls last, id asc);

create index if not exists idx_daily_puzzle_slot_results_attempt_id
  on public.daily_puzzle_slot_results(attempt_id);
