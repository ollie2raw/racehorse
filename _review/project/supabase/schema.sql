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

alter table public.profiles enable row level security;
alter table public.matches enable row level security;

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

-- Auto-bootstrap a temporary profile row after signup.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username)
  values (new.id, 'user_' || left(replace(new.id::text, '-', ''), 8))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
