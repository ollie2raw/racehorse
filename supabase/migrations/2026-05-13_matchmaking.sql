-- Matchmaking match records for H2H queue-based games.
-- Records are inserted in 'in_progress' on match-found and patched on game-end.

create table if not exists public.matchmaking_matches (
  id uuid primary key default gen_random_uuid(),
  room_code text not null,
  player_a_id uuid not null references auth.users(id) on delete cascade,
  player_b_id uuid not null references auth.users(id) on delete cascade,
  player_a_rating numeric not null,
  player_b_rating numeric not null,
  status text not null check (status in ('in_progress','completed','abandoned','forfeit')),
  winner_id uuid references auth.users(id) on delete set null,
  player_a_rating_change numeric,
  player_b_rating_change numeric,
  is_sim boolean not null default false,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_mm_matches_player_a on public.matchmaking_matches(player_a_id, started_at desc);
create index if not exists idx_mm_matches_player_b on public.matchmaking_matches(player_b_id, started_at desc);
create index if not exists idx_mm_matches_status on public.matchmaking_matches(status) where status = 'in_progress';

alter table public.matchmaking_matches enable row level security;

drop policy if exists "matchmaking_matches_select_own" on public.matchmaking_matches;
create policy "matchmaking_matches_select_own"
  on public.matchmaking_matches for select
  using (auth.uid() = player_a_id or auth.uid() = player_b_id);
