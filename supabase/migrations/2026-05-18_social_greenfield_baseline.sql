-- Greenfield baseline for Racehorse social persistence.
--
-- player_presence, activity_feed, and rivals were previously checked in under
-- server/sql/social with instructions to run them manually in the SQL Editor.
-- That left fresh environments without tables the running server writes to.
-- This migration makes the existing social schema part of the ordered ledger.

create table if not exists public.player_presence (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null check (status in ('online', 'in_game', 'offline')) default 'offline',
  current_mode text,
  last_seen timestamptz not null default now()
);

alter table public.player_presence enable row level security;

drop policy if exists "authenticated read presence" on public.player_presence;
create policy "authenticated read presence"
  on public.player_presence for select to authenticated using (true);

drop policy if exists "own presence insert" on public.player_presence;
create policy "own presence insert"
  on public.player_presence for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "own presence update" on public.player_presence;
create policy "own presence update"
  on public.player_presence for update to authenticated
  using (user_id = auth.uid());

create table if not exists public.activity_feed (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('win', 'loss', 'streak', 'tournament', 'puzzle', 'daily_fritz')),
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists idx_activity_feed_user_created
  on public.activity_feed (user_id, created_at desc);

alter table public.activity_feed enable row level security;

drop policy if exists "read own and friends activity" on public.activity_feed;
create policy "read own and friends activity"
  on public.activity_feed for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.friends
      where status = 'accepted'
        and (
          (user_id = auth.uid() and friend_user_id = activity_feed.user_id)
          or (friend_user_id = auth.uid() and user_id = activity_feed.user_id)
        )
    )
  );

create table if not exists public.rivals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  rival_id uuid not null references auth.users(id) on delete cascade,
  h2h_record jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (user_id, rival_id)
);

create index if not exists idx_rivals_user_id on public.rivals (user_id);

alter table public.rivals enable row level security;

drop policy if exists "authenticated read own rivals" on public.rivals;
create policy "authenticated read own rivals"
  on public.rivals for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.friends
      where status = 'accepted'
        and (
          (friends.user_id = auth.uid() and friends.friend_user_id = rivals.user_id)
          or (friends.friend_user_id = auth.uid() and friends.user_id = rivals.user_id)
        )
    )
  );

drop policy if exists "own rivals insert" on public.rivals;
create policy "own rivals insert"
  on public.rivals for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "own rivals update" on public.rivals;
create policy "own rivals update"
  on public.rivals for update to authenticated
  using (user_id = auth.uid());

drop policy if exists "own rivals delete" on public.rivals;
create policy "own rivals delete"
  on public.rivals for delete to authenticated
  using (user_id = auth.uid());
