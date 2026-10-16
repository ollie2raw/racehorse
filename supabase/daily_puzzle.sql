-- Curated Daily Puzzles (v1)
-- Replace the admin email literal below with your actual admin email
-- and keep it in sync with VITE_ADMIN_EMAIL in the client.

create extension if not exists pgcrypto;

drop table if exists public.daily_puzzles cascade;

create table public.daily_puzzles (
  id uuid primary key default gen_random_uuid(),
  puzzle_date date unique not null,
  title text null,
  starting_board jsonb not null,
  starting_hand jsonb not null,
  max_moves int not null default 4,
  target_score int not null,
  created_at timestamptz default now()
);

alter table public.daily_puzzles enable row level security;

-- Read for everyone (anon + authenticated)
drop policy if exists "daily_puzzles_select_all" on public.daily_puzzles;
create policy "daily_puzzles_select_all"
  on public.daily_puzzles
  for select
  to anon, authenticated
  using (true);

-- No client write policies (2026-10-16_account_identity_rls_hardening.sql): publishing is service-role only.
drop policy if exists "daily_puzzles_insert_admin" on public.daily_puzzles;

drop policy if exists "daily_puzzles_update_admin" on public.daily_puzzles;

drop policy if exists "daily_puzzles_delete_admin" on public.daily_puzzles;

-- Example insert (replace with your real puzzle JSON)
-- insert into public.daily_puzzles (puzzle_date, title, starting_board, starting_hand, max_moves, target_score)
-- values (
--   current_date,
--   'Score Attack',
--   '{"mainLine":[{"tile":{"low":1,"high":4},"orientation":"horizontal-normal"},{"tile":{"low":4,"high":6},"orientation":"horizontal-normal"}],"leftEnd":1,"rightEnd":6,"leftEndIsDouble":false,"rightEndIsDouble":false,"hubDoubles":[]}'::jsonb,
--   '[{"low":1,"high":6},{"low":0,"high":1},{"low":2,"high":6}]'::jsonb,
--   4,
--   3
-- );
