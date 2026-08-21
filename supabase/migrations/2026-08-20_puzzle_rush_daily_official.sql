-- Puzzle Rush becomes the Daily Puzzle: mark each user's first run of a
-- calendar day as the "official" one.
--
-- Two columns:
--   run_date     — the Pacific calendar date the run belongs to, resolved by
--                  the server with getPacificDateKey() at creation. Stored
--                  rather than derived from started_at so the day boundary is
--                  byte-identical to daily_puzzle_attempts.puzzle_date and
--                  daily_fritz_attempts.run_date, and so it can be indexed.
--   is_official  — true for a user's first run of that run_date. Governs the
--                  daily leaderboard only.
--
-- The streak deliberately does NOT read is_official: it counts any *completed*
-- run that day, so abandoning a first attempt and finishing a later one still
-- keeps a streak alive. See docs/ops/puzzle-rush-deploy.md.
--
-- Additive only. No existing row is updated and no other table is touched;
-- streak history in daily_puzzle_attempts / daily_puzzle_completions stays
-- valid and is unioned with this table at read time.

begin;

alter table public.rush_runs
  add column if not exists run_date date null;

alter table public.rush_runs
  add column if not exists is_official boolean not null default false;

-- Race backstop. The server picks is_official with an existence check, which
-- is not atomic across concurrent starts; this index makes a second official
-- run for the same user+day impossible at the database level regardless.
create unique index if not exists rush_runs_one_official_per_user_day_idx
  on public.rush_runs (user_id, run_date)
  where is_official;

-- Daily leaderboard: today's official runs, best first.
create index if not exists rush_runs_official_day_idx
  on public.rush_runs (run_date, total_score desc, puzzles_solved desc)
  where is_official and status = 'completed';

-- Streak read: a user's completed runs by day.
create index if not exists rush_runs_user_completed_day_idx
  on public.rush_runs (user_id, run_date desc)
  where status = 'completed';

commit;

-- Backfill note (deliberately NOT run here): existing rush_runs rows predate
-- this column and have run_date null, so they are invisible to both the daily
-- leaderboard and the streak union. That is intentional — Rush has not shipped
-- to players, so there is no real history to preserve, and backfilling from
-- started_at would guess at a timezone the rows were never stamped with. If a
-- backfill is ever wanted:
--   update public.rush_runs
--      set run_date = (started_at at time zone 'America/Los_Angeles')::date
--    where run_date is null;
-- Run it BEFORE the unique index above would matter, and expect it to fail if
-- any user already has two runs that resolve to the same day with is_official.

-- Manual rollback:
-- begin;
-- drop index if exists public.rush_runs_user_completed_day_idx;
-- drop index if exists public.rush_runs_official_day_idx;
-- drop index if exists public.rush_runs_one_official_per_user_day_idx;
-- alter table public.rush_runs drop column if exists is_official;
-- alter table public.rush_runs drop column if exists run_date;
-- commit;
