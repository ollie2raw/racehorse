-- Complete the five-slot Daily Puzzle ladder schema rollout.
--
-- The initial five-slot migration widened puzzle and current-slot indexes but
-- left puzzles_completed capped at three. Existing rows already satisfy the
-- wider constraint, so this change is safe to deploy ahead of application code.

alter table public.daily_puzzle_attempts
  drop constraint if exists daily_puzzle_attempts_puzzles_completed_check;

alter table public.daily_puzzle_attempts
  add constraint daily_puzzle_attempts_puzzles_completed_check
  check (puzzles_completed between 0 and 5);

-- Manual rollback (only after verifying no row has puzzles_completed > 3):
-- alter table public.daily_puzzle_attempts
--   drop constraint if exists daily_puzzle_attempts_puzzles_completed_check;
-- alter table public.daily_puzzle_attempts
--   add constraint daily_puzzle_attempts_puzzles_completed_check
--   check (puzzles_completed between 0 and 3);
