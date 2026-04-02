create extension if not exists pgcrypto;

create table if not exists public.ghost_games (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  played_at timestamptz not null default now(),
  final_score int not null,
  opponent_score int not null,
  move_log jsonb not null default '[]'::jsonb
);

create table if not exists public.ghost_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  ghost_rating int not null default 800,
  last_updated timestamptz null,
  composite_log jsonb null,
  games_played int not null default 0
);

alter table public.ghost_games enable row level security;
alter table public.ghost_profiles enable row level security;

drop policy if exists "ghost_games_insert_own" on public.ghost_games;
create policy "ghost_games_insert_own"
  on public.ghost_games
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "ghost_games_select_own" on public.ghost_games;
create policy "ghost_games_select_own"
  on public.ghost_games
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "ghost_profiles_select_own" on public.ghost_profiles;
create policy "ghost_profiles_select_own"
  on public.ghost_profiles
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "ghost_profiles_insert_own" on public.ghost_profiles;
create policy "ghost_profiles_insert_own"
  on public.ghost_profiles
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "ghost_profiles_update_own" on public.ghost_profiles;
create policy "ghost_profiles_update_own"
  on public.ghost_profiles
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
