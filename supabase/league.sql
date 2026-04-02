-- League Mode schema (Step 1)
-- Run after supabase/schema.sql.
--
-- Design rule:
-- Fixtures/results are canonical. Standings must be recomputed from fixtures;
-- league_members intentionally stores identity/placement only, not W/D/L stats.

create extension if not exists pgcrypto;

create table if not exists public.league_bots (
  id text primary key,
  display_name text not null unique,
  division int not null check (division in (1, 2, 3)),
  personality text not null,
  difficulty int not null check (difficulty between 1 and 10),
  is_fritz boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.leagues (
  id uuid primary key default gen_random_uuid(),
  division int not null check (division in (1, 2, 3)),
  season int not null check (season >= 1),
  week_start date not null,
  week_end date not null,
  status text not null default 'active' check (status in ('active', 'completed')),
  created_at timestamptz not null default now(),
  check (week_end >= week_start)
);

create table if not exists public.league_members (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  slot int not null check (slot between 1 and 7),
  member_type text not null check (member_type in ('player', 'bot')),
  player_user_id uuid null references auth.users(id) on delete cascade,
  bot_id text null references public.league_bots(id) on delete restrict,
  display_name text not null,
  joined_at timestamptz not null default now(),
  check (
    (member_type = 'player' and player_user_id is not null and bot_id is null)
    or
    (member_type = 'bot' and bot_id is not null and player_user_id is null)
  ),
  unique (league_id, slot)
);

create table if not exists public.fixtures (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  season int not null check (season >= 1),
  matchday int not null check (matchday between 1 and 7),
  scheduled_date date not null,
  home_member_id uuid not null references public.league_members(id) on delete cascade,
  away_member_id uuid not null references public.league_members(id) on delete cascade,
  home_score int null check (home_score is null or home_score >= 0),
  away_score int null check (away_score is null or away_score >= 0),
  status text not null default 'scheduled' check (status in ('scheduled', 'completed', 'forfeit')),
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  check (home_member_id <> away_member_id),
  unique (league_id, matchday, home_member_id),
  unique (league_id, matchday, away_member_id)
);

create table if not exists public.player_league_history (
  id bigserial primary key,
  player_user_id uuid not null references auth.users(id) on delete cascade,
  season int not null check (season >= 1),
  division int not null check (division in (1, 2, 3)),
  league_id uuid not null references public.leagues(id) on delete cascade,
  final_position int not null check (final_position between 1 and 7),
  promoted boolean not null default false,
  relegated boolean not null default false,
  created_at timestamptz not null default now(),
  unique (player_user_id, season)
);

create unique index if not exists idx_league_bots_one_fritz
  on public.league_bots ((is_fritz))
  where is_fritz;

create unique index if not exists idx_league_members_player_once_per_league
  on public.league_members (league_id, player_user_id)
  where player_user_id is not null;

create unique index if not exists idx_league_members_bot_once_per_league
  on public.league_members (league_id, bot_id)
  where bot_id is not null;

create index if not exists idx_leagues_active_division_season
  on public.leagues (status, division, season desc);

create index if not exists idx_leagues_week_window
  on public.leagues (week_start, week_end);

create index if not exists idx_league_members_league
  on public.league_members (league_id, slot);

create index if not exists idx_league_members_player
  on public.league_members (player_user_id)
  where player_user_id is not null;

create index if not exists idx_fixtures_league_day
  on public.fixtures (league_id, scheduled_date, matchday);

create index if not exists idx_fixtures_status_day
  on public.fixtures (status, scheduled_date);

create index if not exists idx_fixtures_home_member
  on public.fixtures (home_member_id, scheduled_date);

create index if not exists idx_fixtures_away_member
  on public.fixtures (away_member_id, scheduled_date);

create index if not exists idx_player_league_history_player
  on public.player_league_history (player_user_id, season desc);

alter table public.league_bots enable row level security;
alter table public.leagues enable row level security;
alter table public.league_members enable row level security;
alter table public.fixtures enable row level security;
alter table public.player_league_history enable row level security;

drop policy if exists "league_bots_select_all" on public.league_bots;
create policy "league_bots_select_all"
  on public.league_bots
  for select
  to anon, authenticated
  using (true);

drop policy if exists "leagues_select_authenticated" on public.leagues;
create policy "leagues_select_authenticated"
  on public.leagues
  for select
  to authenticated
  using (true);

drop policy if exists "league_members_select_authenticated" on public.league_members;
create policy "league_members_select_authenticated"
  on public.league_members
  for select
  to authenticated
  using (true);

drop policy if exists "fixtures_select_authenticated" on public.fixtures;
create policy "fixtures_select_authenticated"
  on public.fixtures
  for select
  to authenticated
  using (true);

drop policy if exists "player_league_history_select_own" on public.player_league_history;
create policy "player_league_history_select_own"
  on public.player_league_history
  for select
  to authenticated
  using (player_user_id = auth.uid());

drop policy if exists "league_bots_no_client_write" on public.league_bots;
create policy "league_bots_no_client_write"
  on public.league_bots
  for all
  to anon, authenticated
  using (false)
  with check (false);

drop policy if exists "leagues_no_client_write" on public.leagues;
create policy "leagues_no_client_write"
  on public.leagues
  for all
  to anon, authenticated
  using (false)
  with check (false);

drop policy if exists "league_members_no_client_write" on public.league_members;
create policy "league_members_no_client_write"
  on public.league_members
  for all
  to anon, authenticated
  using (false)
  with check (false);

drop policy if exists "fixtures_no_client_write" on public.fixtures;
create policy "fixtures_no_client_write"
  on public.fixtures
  for all
  to anon, authenticated
  using (false)
  with check (false);

drop policy if exists "player_league_history_no_client_write" on public.player_league_history;
create policy "player_league_history_no_client_write"
  on public.player_league_history
  for all
  to anon, authenticated
  using (false)
  with check (false);

insert into public.league_bots (id, display_name, division, personality, difficulty, is_fritz)
values
  ('sunday-steve', 'Sunday Steve', 3, 'Relaxed, makes predictable plays', 1, false),
  ('nervous-nancy', 'Nervous Nancy', 3, 'Plays defensively, avoids risk', 2, false),
  ('rookie-ray', 'Rookie Ray', 3, 'Just learning, occasional blunder', 2, false),
  ('tile-tina', 'Tile Tina', 3, 'Plays fast, rarely thinks ahead', 3, false),
  ('mellow-marco', 'Mellow Marco', 3, 'Laid back, inconsistent', 3, false),
  ('old-bill', 'Old Bill', 3, 'Slow and steady, no flair', 4, false),
  ('tactical-teresa', 'Tactical Teresa', 2, 'Blocks well, reads the board', 5, false),
  ('clutch-carlos', 'Clutch Carlos', 2, 'Comes alive when trailing', 6, false),
  ('the-calculator', 'The Calculator', 2, 'Counts tiles, plays mathematically', 6, false),
  ('sharp-sarah', 'Sharp Sarah', 2, 'Aggressive scorer', 7, false),
  ('grinder-greg', 'Grinder Greg', 2, 'Never gives up, grinds every turn', 7, false),
  ('cold-eye-cole', 'Cold Eye Cole', 2, 'Emotionless, optimal play', 8, false),
  ('the-professor', 'The Professor', 1, 'Sophisticated, multi-move planning', 8, false),
  ('ruthless-rita', 'Ruthless Rita', 1, 'No mercy, exploits every opening', 9, false),
  ('machine-mike', 'Machine Mike', 1, 'Near perfect tile memory', 9, false),
  ('the-closer', 'The Closer', 1, 'Never loses when ahead', 9, false),
  ('the-phantom', 'The Phantom', 1, 'Unpredictable, hard to read', 9, false),
  ('fritz', 'Fritz', 1, 'The best player in the room', 10, true)
on conflict (id) do update set
  display_name = excluded.display_name,
  division = excluded.division,
  personality = excluded.personality,
  difficulty = excluded.difficulty,
  is_fritz = excluded.is_fritz,
  active = true;
