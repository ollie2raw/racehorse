create extension if not exists pgcrypto;

create table if not exists public.verified_single_player_matches (
  match_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  local_match_id text not null,
  mode text not null check (mode in ('ghost', 'fritz')),
  opponent_user_id text null,
  fritz_tier text null,
  status text not null check (status in ('started', 'completed', 'abandoned')),
  started_at timestamptz not null default now(),
  completed_at timestamptz null,
  completion_hash text null,
  completion_result jsonb null,
  deal_snapshot jsonb null
);

create unique index if not exists idx_verified_single_player_matches_user_local
  on public.verified_single_player_matches (user_id, local_match_id);

create index if not exists idx_verified_single_player_matches_status
  on public.verified_single_player_matches (status, started_at desc);

alter table public.verified_single_player_matches enable row level security;

drop policy if exists "verified_single_player_matches_select_own" on public.verified_single_player_matches;
create policy "verified_single_player_matches_select_own"
  on public.verified_single_player_matches
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "verified_single_player_matches_no_client_write" on public.verified_single_player_matches;
create policy "verified_single_player_matches_no_client_write"
  on public.verified_single_player_matches
  for all
  to authenticated
  using (false)
  with check (false);
