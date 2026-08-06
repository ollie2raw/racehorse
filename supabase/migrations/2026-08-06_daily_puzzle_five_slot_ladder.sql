-- Daily Puzzle now publishes five equal-value puzzles using the high-score setup.
-- Existing rows and attempts remain intact; this only widens the slot domain so
-- the next seed can publish slots 4 and 5 and existing runs can resume safely.

alter table public.daily_puzzles
  drop constraint if exists daily_puzzles_slot_index_check;

alter table public.daily_puzzles
  add constraint daily_puzzles_slot_index_check
  check (slot_index between 1 and 5);

alter table public.daily_puzzle_attempts
  drop constraint if exists daily_puzzle_attempts_current_slot_index_check;

alter table public.daily_puzzle_attempts
  add constraint daily_puzzle_attempts_current_slot_index_check
  check (current_slot_index between 1 and 5);

alter table public.daily_puzzle_slot_results
  drop constraint if exists daily_puzzle_slot_results_slot_index_check;

alter table public.daily_puzzle_slot_results
  add constraint daily_puzzle_slot_results_slot_index_check
  check (slot_index between 1 and 5);
