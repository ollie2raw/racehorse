-- Performance indexes for daily_puzzle_attempts hot paths.
--
-- Two queries dominate load on this table:
--
--   1. Per-user attempt lookup (puzzle start, slot submit, complete, review):
--        puzzle_date = $1 AND user_id = $2 LIMIT 1
--      Without an index Postgres does a full table scan. This fires on every
--      puzzle interaction for every active player.
--
--   2. Leaderboard build (listDailyPuzzleAttemptsForDate):
--        puzzle_date = $1 ORDER BY completed_at ASC NULLS LAST, id ASC
--      Fetches all attempts for a date. A (puzzle_date, completed_at, id)
--      index lets Postgres satisfy both the filter and the sort in one pass.

create index if not exists idx_daily_puzzle_attempts_date_user
  on public.daily_puzzle_attempts(puzzle_date, user_id);

create index if not exists idx_daily_puzzle_attempts_date_leaderboard
  on public.daily_puzzle_attempts(puzzle_date, completed_at asc nulls last, id asc);

-- slot_results are fetched by attempt_id in listDailyPuzzleAttemptsForDate
-- (the IN(...) clause) and in per-attempt loads. Confirm the index exists
-- (daily_puzzle_ladder_v1.sql may already cover this via FK, but be explicit).
create index if not exists idx_daily_puzzle_slot_results_attempt_id
  on public.daily_puzzle_slot_results(attempt_id);
