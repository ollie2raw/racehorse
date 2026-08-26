-- Supabase schema for Racehorse Dominoes fast-path auth + stats
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  created_at timestamptz not null default now()
);

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  mode text not null check (mode in ('bot', 'online', 'practice')),
  room_code text null,
  winner_user_id uuid null references auth.users(id) on delete set null,
  loser_user_id uuid null references auth.users(id) on delete set null,
  winner_score int null,
  loser_score int null,
  move_count int null,
  metadata jsonb not null default '{}'::jsonb
);

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
  style_profile jsonb null,
  games_played int not null default 0
);

alter table public.ghost_profiles add column if not exists style_profile jsonb null;

alter table public.profiles enable row level security;
alter table public.matches enable row level security;
alter table public.ghost_games enable row level security;
alter table public.ghost_profiles enable row level security;

-- profiles policies
drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated"
  on public.profiles
  for select
  to authenticated
  using (true);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles
  for insert
  to authenticated
  with check (id = auth.uid());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- matches policies
drop policy if exists "matches_insert_participant" on public.matches;
create policy "matches_insert_participant"
  on public.matches
  for insert
  to authenticated
  with check (
    auth.uid() = winner_user_id
    or auth.uid() = loser_user_id
  );

drop policy if exists "matches_select_participant" on public.matches;
create policy "matches_select_participant"
  on public.matches
  for select
  to authenticated
  using (
    auth.uid() = winner_user_id
    or auth.uid() = loser_user_id
  );

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

-- Bootstrap the profile row after signup, honouring the submitted username
-- and falling back to a placeholder handle when none is usable.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  fallback_username text := 'user_' || left(replace(new.id::text, '-', ''), 8);
  desired_username text;
begin
  desired_username := lower(trim(coalesce(
    nullif(new.raw_user_meta_data ->> 'username', ''),
    nullif(new.raw_user_meta_data ->> 'preferred_username', ''),
    ''
  )));

  -- Same rules the signup form enforces, plus the reserved placeholder
  -- namespace, which the app treats as "no handle chosen yet".
  if desired_username !~ '^[a-z0-9_]{3,}$'
    or desired_username like 'user\_%'
    or exists (select 1 from public.profiles p where p.username = desired_username)
  then
    desired_username := fallback_username;
  end if;

  begin
    insert into public.profiles (id, username)
    values (new.id, desired_username)
    on conflict (id) do nothing;
  exception
    when unique_violation then
      -- The handle was claimed between the check and the insert.
      insert into public.profiles (id, username)
      values (new.id, fallback_username)
      on conflict (id) do nothing;
  end;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
