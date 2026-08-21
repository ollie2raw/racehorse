-- Puzzle Rush: record which stage the player was in when a puzzle was reported.
--
-- Purely observational — it exists so drop-off can be measured per stage
-- (Warm-Up / Building / Master). Nothing scored reads this column: grading,
-- total_score, and invalidation are all computed from the replayed lines and
-- the run's own ordinals, never from a client-supplied stage.
--
-- Nullable with no default: a report that omits it is still a valid report.

begin;

alter table public.rush_run_puzzles
  add column if not exists stage_reached_key text null;

alter table public.rush_run_puzzles
  drop constraint if exists rush_run_puzzles_stage_reached_key_check;

alter table public.rush_run_puzzles
  add constraint rush_run_puzzles_stage_reached_key_check
  check (stage_reached_key is null or stage_reached_key in ('warm_up', 'building', 'master'));

-- Drop-off analysis reads by stage across runs.
create index if not exists rush_run_puzzles_stage_reached_idx
  on public.rush_run_puzzles (stage_reached_key)
  where stage_reached_key is not null;

commit;

-- Manual rollback:
-- begin;
-- drop index if exists public.rush_run_puzzles_stage_reached_idx;
-- alter table public.rush_run_puzzles
--   drop constraint if exists rush_run_puzzles_stage_reached_key_check;
-- alter table public.rush_run_puzzles drop column if exists stage_reached_key;
-- commit;
