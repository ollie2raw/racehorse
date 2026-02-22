-- Daily Puzzle v1 schema
create extension if not exists pgcrypto;

create table if not exists public.daily_puzzles (
  id uuid primary key default gen_random_uuid(),
  puzzle_date date unique not null,
  title text not null default 'Daily Puzzle',
  seed text,
  config jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.daily_puzzle_submissions (
  id uuid primary key default gen_random_uuid(),
  puzzle_id uuid not null references public.daily_puzzles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  moves int not null,
  milliseconds int not null,
  solved boolean not null,
  attempt_hash text,
  constraint daily_puzzle_submissions_puzzle_user_unique unique (puzzle_id, user_id)
);

alter table public.daily_puzzles enable row level security;
alter table public.daily_puzzle_submissions enable row level security;

-- daily puzzles are public read
 drop policy if exists "daily_puzzles_select_public" on public.daily_puzzles;
create policy "daily_puzzles_select_public"
  on public.daily_puzzles
  for select
  to anon, authenticated
  using (true);

-- submissions: user can insert/update/select own
 drop policy if exists "daily_submissions_insert_own" on public.daily_puzzle_submissions;
create policy "daily_submissions_insert_own"
  on public.daily_puzzle_submissions
  for insert
  to authenticated
  with check (user_id = auth.uid());

 drop policy if exists "daily_submissions_update_own" on public.daily_puzzle_submissions;
create policy "daily_submissions_update_own"
  on public.daily_puzzle_submissions
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

 drop policy if exists "daily_submissions_select_public" on public.daily_puzzle_submissions;
create policy "daily_submissions_select_public"
  on public.daily_puzzle_submissions
  for select
  to anon, authenticated
  using (true);

-- Example insert for today's UTC puzzle (replace config JSON as needed)
insert into public.daily_puzzles (puzzle_date, title, seed, config)
values (
  (now() at time zone 'utc')::date,
  'Daily Puzzle',
  'manual-seed-001',
  jsonb_build_object(
    'startingHand', jsonb_build_array(
      jsonb_build_object('low', 0, 'high', 5),
      jsonb_build_object('low', 1, 'high', 6),
      jsonb_build_object('low', 2, 'high', 4),
      jsonb_build_object('low', 3, 'high', 6),
      jsonb_build_object('low', 0, 'high', 2)
    ),
    'startingBoard', jsonb_build_array(),
    'startingTurn', 'you',
    'objective', jsonb_build_object('type', 'finish_in_moves', 'maxMoves', 7),
    'notes', 'Clear your hand within move limit.'
  )
)
on conflict (puzzle_date) do update
set title = excluded.title,
    seed = excluded.seed,
    config = excluded.config;
