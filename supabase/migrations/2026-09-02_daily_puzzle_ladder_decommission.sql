-- Daily Puzzle Ladder decommission — 2026-09-02
--
-- The 5-slot "Daily Puzzle Ladder" was retired ~2026-08-20 when
-- `2026-08-20_puzzle_rush_daily_official.sql` landed ("Puzzle Rush becomes the
-- Daily Puzzle"). The client routes (`/daily`, `/daily/leaderboard`), the
-- `/api/daily-puzzle/*` HTTP routes, and the nightly ladder warm job were all
-- removed in the same change as this migration.
--
-- This migration closes DF-CAND-1 (HARDENING_PLAN.md §3.1.4 / §3.1.8):
-- `public.daily_puzzle_attempts` and `public.daily_puzzle_slot_results` carried
-- `insert_own` / `update_own` RLS policies (`with check auth.uid() = user_id`),
-- so any authenticated client could `POST /rest/v1/daily_puzzle_attempts` with
-- its own `user_id` and an arbitrary `total_score` — HTTP 201, bypassing the
-- server's `validateDailyPuzzleSubmission` engine replay. Confirmed live.
--
-- Archive strategy: the two tables are kept in `public` as READ-ONLY historical
-- data rather than dropped or moved to another schema, because two server reads
-- still consume them and the pre-2026-08-20 rows are worth keeping:
--   * server/src/social/socialProfile.ts        — profile "daily puzzles solved" count
--   * server/src/http/stores/homeCompletionDates.ts — streak-calendar frozen history
-- Both read via the service-role key. `select_own` is kept so a player can still
-- read their own archived attempt. All client write access (grants + policies)
-- is removed.
--
-- Not touched (separate parked items DF-CAND-3 / DF-CAND-4): `daily_puzzles`,
-- `daily_puzzle_scores`, `daily_puzzle_submissions`, `daily_puzzle_completions`.
--
-- Idempotent. Self-asserting. Safe to run more than once.

begin;

-- 1. Drop the client write policies (the DF-CAND-1 vector).
drop policy if exists "daily_puzzle_attempts_insert_own"     on public.daily_puzzle_attempts;
drop policy if exists "daily_puzzle_attempts_update_own"     on public.daily_puzzle_attempts;
drop policy if exists "daily_puzzle_slot_results_insert_own" on public.daily_puzzle_slot_results;
drop policy if exists "daily_puzzle_slot_results_update_own" on public.daily_puzzle_slot_results;

-- 2. Remove client write grants. `select_own` (policy) + SELECT grant stay so a
--    player can still read their own archived rows; the server uses service_role.
revoke insert, update, delete, truncate on public.daily_puzzle_attempts     from anon, authenticated;
revoke insert, update, delete, truncate on public.daily_puzzle_slot_results from anon, authenticated;

-- 3. RLS stays enabled: with no INSERT/UPDATE policy, writes are denied even if a
--    grant were somehow re-added. Defence in depth.
alter table public.daily_puzzle_attempts     enable row level security;
alter table public.daily_puzzle_slot_results enable row level security;

comment on table public.daily_puzzle_attempts is
  'RETIRED 2026-08-20 (Daily Puzzle Ladder -> Puzzle Rush). Read-only historical. No client writes (DF-CAND-1 closed). Server reads via service_role only.';
comment on table public.daily_puzzle_slot_results is
  'RETIRED 2026-08-20 (Daily Puzzle Ladder -> Puzzle Rush). Read-only historical. No client writes (DF-CAND-1 closed).';

-- 4. Self-assert.
do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename in ('daily_puzzle_attempts', 'daily_puzzle_slot_results')
      and cmd in ('INSERT', 'UPDATE')
  ) then
    raise exception 'DF-CAND-1: an INSERT/UPDATE policy still exists on a daily_puzzle ladder table';
  end if;

  if has_table_privilege('authenticated', 'public.daily_puzzle_attempts', 'INSERT')
     or has_table_privilege('authenticated', 'public.daily_puzzle_attempts', 'UPDATE')
     or has_table_privilege('anon', 'public.daily_puzzle_attempts', 'INSERT')
     or has_table_privilege('anon', 'public.daily_puzzle_attempts', 'UPDATE') then
    raise exception 'DF-CAND-1: client still holds a write grant on public.daily_puzzle_attempts';
  end if;

  if has_table_privilege('authenticated', 'public.daily_puzzle_slot_results', 'INSERT')
     or has_table_privilege('authenticated', 'public.daily_puzzle_slot_results', 'UPDATE')
     or has_table_privilege('anon', 'public.daily_puzzle_slot_results', 'INSERT')
     or has_table_privilege('anon', 'public.daily_puzzle_slot_results', 'UPDATE') then
    raise exception 'DF-CAND-1: client still holds a write grant on public.daily_puzzle_slot_results';
  end if;

  if not has_table_privilege('service_role', 'public.daily_puzzle_attempts', 'SELECT') then
    raise exception 'service_role lost SELECT on public.daily_puzzle_attempts (historical reads would break)';
  end if;

  raise notice 'daily_puzzle_ladder decommission: DF-CAND-1 write vector closed; tables read-only historical';
end $$;

commit;
