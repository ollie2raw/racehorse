-- Friends feature schema + policies
--
-- SA-5 (HARDENING_PLAN.md §11.3, System 11): this file previously described
-- a materially looser RLS update policy (`friends_update_participant` —
-- either party could update, any status) than what was actually live in
-- prod (`friends_update_recipient` — only the recipient, only to
-- accepted/blocked). No live gap resulted (prod was already the safer,
-- correct version — confirmed by directly testing the exact self-accept
-- scenario the old text here would have permitted; RLS blocked it, 0 rows
-- affected), but a future migration authored against the stale text below
-- could have accidentally *regressed* prod to the weaker policy. Synced
-- 2026-09-05 against the live policies (`list_rls_policy_manifest()`) and
-- the live table CHECK constraint, not reconstructed from memory or intent.
create extension if not exists pgcrypto;

create table if not exists public.friends (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  friend_user_id uuid not null references auth.users(id) on delete cascade,
  -- 'blocked' confirmed live-accepted 2026-09-05 (a real insert with this
  -- status succeeded against prod's actual constraint) — this file's
  -- constraint previously only allowed ('pending', 'accepted'), which would
  -- have rejected the accepted-recipient policy's own 'blocked' branch below
  -- had it ever been re-applied from this file alone.
  status text not null check (status in ('pending', 'accepted', 'blocked')),
  check (user_id <> friend_user_id)
);

-- Prevent duplicate relationships regardless of direction.
create unique index if not exists friends_pair_unique_idx
  on public.friends (least(user_id, friend_user_id), greatest(user_id, friend_user_id));

create index if not exists friends_user_id_idx on public.friends (user_id);
create index if not exists friends_friend_user_id_idx on public.friends (friend_user_id);

alter table public.friends enable row level security;

drop policy if exists "friends_select_participant" on public.friends;
drop policy if exists "friends_select_own" on public.friends;
create policy "friends_select_own"
  on public.friends
  for select
  to authenticated
  using (auth.uid() = user_id or auth.uid() = friend_user_id);

-- Only the sender can create a request, and only in 'pending' status — a
-- client cannot insert a row that's already accepted/blocked.
drop policy if exists "friends_insert_sender" on public.friends;
drop policy if exists "friends_insert_own" on public.friends;
create policy "friends_insert_own"
  on public.friends
  for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and auth.uid() <> friend_user_id
    and status = 'pending'
  );

-- Only the RECIPIENT can update a request, and only to accepted/blocked —
-- the sender cannot self-accept or otherwise move their own outgoing
-- request's status via a direct authenticated write.
drop policy if exists "friends_update_participant" on public.friends;
drop policy if exists "friends_update_recipient" on public.friends;
create policy "friends_update_recipient"
  on public.friends
  for update
  to authenticated
  using (auth.uid() = friend_user_id)
  with check (
    auth.uid() = friend_user_id
    and status in ('accepted', 'blocked')
  );

drop policy if exists "friends_delete_participant" on public.friends;
create policy "friends_delete_participant"
  on public.friends
  for delete
  to authenticated
  using (auth.uid() = user_id or auth.uid() = friend_user_id);
