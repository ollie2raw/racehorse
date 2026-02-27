-- Friends feature schema + policies
create extension if not exists pgcrypto;

create table if not exists public.friends (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  friend_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null check (status in ('pending', 'accepted')),
  check (user_id <> friend_user_id)
);

-- Prevent duplicate relationships regardless of direction.
create unique index if not exists friends_pair_unique_idx
  on public.friends (least(user_id, friend_user_id), greatest(user_id, friend_user_id));

create index if not exists friends_user_id_idx on public.friends (user_id);
create index if not exists friends_friend_user_id_idx on public.friends (friend_user_id);

alter table public.friends enable row level security;

drop policy if exists "friends_select_participant" on public.friends;
create policy "friends_select_participant"
  on public.friends
  for select
  to authenticated
  using (auth.uid() = user_id or auth.uid() = friend_user_id);

drop policy if exists "friends_insert_sender" on public.friends;
create policy "friends_insert_sender"
  on public.friends
  for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and status = 'pending'
  );

drop policy if exists "friends_update_participant" on public.friends;
create policy "friends_update_participant"
  on public.friends
  for update
  to authenticated
  using (auth.uid() = user_id or auth.uid() = friend_user_id)
  with check (auth.uid() = user_id or auth.uid() = friend_user_id);

drop policy if exists "friends_delete_participant" on public.friends;
create policy "friends_delete_participant"
  on public.friends
  for delete
  to authenticated
  using (auth.uid() = user_id or auth.uid() = friend_user_id);
