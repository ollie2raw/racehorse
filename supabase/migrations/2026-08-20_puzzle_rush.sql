-- Puzzle Rush phase 1: pre-validated puzzle pool + unbounded timed runs.
--
-- Three tables:
--   puzzle_pool      — the content bank rush selection reads. Seeded from
--                      daily_puzzles but deliberately a separate table so rush
--                      selection queries never contend with the daily ladder's
--                      readiness path, and so we can carry play_count /
--                      difficulty_score, which daily_puzzles has no column for.
--   rush_runs        — one row per run. No unique-per-day constraint: rush is
--                      replayable, which is the whole point of the mode.
--   rush_run_puzzles — one row per puzzle served in a run, keyed by ordinal
--                      rather than a slot index, because a pool puzzle can
--                      recur across runs and within the pool over time.
--
-- All three are server-authoritative: the browser never reads or writes them
-- directly (best_possible_score in particular must never reach a client mid-run).

begin;

create extension if not exists pgcrypto;

-- ─── Pool ────────────────────────────────────────────────────────────────

create table if not exists public.puzzle_pool (
  id uuid primary key default gen_random_uuid(),
  -- Provenance of a seeded row, so a re-run of the backfill is idempotent and
  -- we can trace a rush puzzle back to the daily row it came from.
  source text not null default 'daily_puzzles',
  source_puzzle_id uuid null,

  starting_board jsonb not null,
  starting_hand jsonb not null,
  max_moves int not null default 1,
  puzzle_type text not null,
  tier text not null,
  deal_size int not null default 14,
  target_score int not null default 999,

  best_possible_score int not null,
  -- Derived at seed time from tier + best_possible_score. Coarse on purpose;
  -- refined later from observed solve rates once runs produce data.
  difficulty_score int not null,
  play_count int not null default 0,

  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint puzzle_pool_tier_check
    check (tier in ('quick_line', 'tactical_setup', 'master_chain')),
  constraint puzzle_pool_best_possible_score_check
    check (best_possible_score > 0),
  constraint puzzle_pool_difficulty_score_check
    check (difficulty_score between 0 and 1000),
  constraint puzzle_pool_play_count_check
    check (play_count >= 0),
  -- Idempotent backfill: one pool row per source daily_puzzles row.
  constraint puzzle_pool_source_key
    unique (source, source_puzzle_id)
);

-- Selection reads: enabled rows within a difficulty band, least-played first.
create index if not exists puzzle_pool_selection_idx
  on public.puzzle_pool (enabled, difficulty_score asc, play_count asc)
  where enabled;

create index if not exists puzzle_pool_tier_idx
  on public.puzzle_pool (tier);

-- ─── Runs ────────────────────────────────────────────────────────────────

create table if not exists public.rush_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  username text null,

  status text not null default 'in_progress',
  started_at timestamptz not null default now(),
  ended_at timestamptz null,

  -- Authoritative values, written only by the server's end-of-run replay.
  total_score int not null default 0,
  puzzles_solved int not null default 0,
  -- What the client displayed. Kept for the mismatch audit trail; never trusted.
  client_reported_score int not null default 0,
  invalidated_reason text null,

  config_version int not null default 1,
  updated_at timestamptz not null default now(),

  constraint rush_runs_status_check
    check (status in ('in_progress', 'completed', 'invalidated')),
  constraint rush_runs_total_score_check
    check (total_score >= 0),
  constraint rush_runs_puzzles_solved_check
    check (puzzles_solved >= 0),
  constraint rush_runs_client_reported_score_check
    check (client_reported_score >= 0),
  -- A finished run must have an end stamp; an open one must not.
  constraint rush_runs_ended_at_status_check
    check ((status = 'in_progress') = (ended_at is null))
);

-- Leaderboard scan: best completed runs first.
create index if not exists rush_runs_leaderboard_idx
  on public.rush_runs (status, total_score desc, puzzles_solved desc)
  where status = 'completed';

-- "My runs" and the in-progress lookup used by the idempotent start path.
create index if not exists rush_runs_user_started_idx
  on public.rush_runs (user_id, started_at desc);

-- At most one open run per user. This is what makes run creation idempotent
-- under concurrent starts without forbidding replays: finished runs have
-- status <> 'in_progress' and drop out of the index.
create unique index if not exists rush_runs_one_open_per_user_idx
  on public.rush_runs (user_id)
  where status = 'in_progress';

-- ─── Per-puzzle rows ─────────────────────────────────────────────────────

create table if not exists public.rush_run_puzzles (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.rush_runs(id) on delete cascade,
  puzzle_id uuid not null references public.puzzle_pool(id) on delete restrict,
  -- Position within this run. Not a slot index: the same pool puzzle may
  -- appear at different ordinals in different runs.
  ordinal int not null,

  raw_score int not null default 0,
  awarded_points int not null default 0,
  client_raw_score int not null default 0,
  solved boolean not null default false,
  perfect boolean not null default false,
  moves_used int not null default 0,
  bonus_seconds int not null default 0,

  submitted_line jsonb not null default '[]'::jsonb,
  client_reported_at timestamptz not null default now(),
  graded_at timestamptz null,
  grading_error text null,

  constraint rush_run_puzzles_run_ordinal_key
    unique (run_id, ordinal),
  constraint rush_run_puzzles_ordinal_check
    check (ordinal >= 1 and ordinal <= 100),
  constraint rush_run_puzzles_raw_score_check
    check (raw_score >= 0),
  constraint rush_run_puzzles_awarded_points_check
    check (awarded_points >= 0),
  constraint rush_run_puzzles_client_raw_score_check
    check (client_raw_score >= 0)
);

create index if not exists rush_run_puzzles_run_idx
  on public.rush_run_puzzles (run_id, ordinal asc);

create index if not exists rush_run_puzzles_puzzle_idx
  on public.rush_run_puzzles (puzzle_id);

-- ─── Server-authoritative access ─────────────────────────────────────────

alter table public.puzzle_pool enable row level security;
alter table public.rush_runs enable row level security;
alter table public.rush_run_puzzles enable row level security;

drop policy if exists "puzzle_pool_no_client_access" on public.puzzle_pool;
drop policy if exists "rush_runs_no_client_access" on public.rush_runs;
drop policy if exists "rush_run_puzzles_no_client_access" on public.rush_run_puzzles;

create policy "puzzle_pool_no_client_access"
  on public.puzzle_pool
  for all
  to anon, authenticated
  using (false)
  with check (false);

create policy "rush_runs_no_client_access"
  on public.rush_runs
  for all
  to anon, authenticated
  using (false)
  with check (false);

create policy "rush_run_puzzles_no_client_access"
  on public.rush_run_puzzles
  for all
  to anon, authenticated
  using (false)
  with check (false);

revoke all privileges on table public.puzzle_pool from public, anon, authenticated;
revoke all privileges on table public.rush_runs from public, anon, authenticated;
revoke all privileges on table public.rush_run_puzzles from public, anon, authenticated;

grant all privileges on table public.puzzle_pool to service_role;
grant all privileges on table public.rush_runs to service_role;
grant all privileges on table public.rush_run_puzzles to service_role;

commit;

-- Manual rollback (destroys all rush history; the pool can be re-seeded):
-- begin;
-- drop table if exists public.rush_run_puzzles;
-- drop table if exists public.rush_runs;
-- drop table if exists public.puzzle_pool;
-- commit;
