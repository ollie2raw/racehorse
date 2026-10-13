do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role service_role; exception when duplicate_object then null; end $$;
create schema auth;
create table auth.users (id uuid primary key);
create extension if not exists pgcrypto;
create table public.puzzle_pool (
  id uuid primary key default gen_random_uuid(),
  source text, source_puzzle_id uuid, starting_board jsonb not null default '{}',
  starting_hand jsonb not null default '[]', max_moves integer, puzzle_type text,
  tier text, deal_size integer, target_score integer, best_possible_score integer,
  difficulty_score integer, play_count integer, enabled boolean,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create table public.rush_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id), username text,
  status text not null default 'in_progress', started_at timestamptz not null default now(),
  ended_at timestamptz, total_score integer not null default 0,
  puzzles_solved integer not null default 0, client_reported_score integer not null default 0,
  invalidated_reason text, config_version integer not null default 1,
  updated_at timestamptz not null default now(), run_date date, is_official boolean default false,
  constraint rush_runs_status_check check (status in ('in_progress','completed','invalidated')),
  constraint rush_runs_ended_at_status_check check ((status = 'in_progress') = (ended_at is null))
);
create unique index rush_runs_one_open_per_user_idx on public.rush_runs (user_id) where status = 'in_progress';
create table public.rush_run_puzzles (
  id uuid primary key default gen_random_uuid(), run_id uuid not null references public.rush_runs(id),
  puzzle_id uuid not null references public.puzzle_pool(id), ordinal integer not null,
  raw_score integer not null default 0, awarded_points integer not null default 0,
  client_raw_score integer not null default 0, solved boolean not null default false,
  perfect boolean not null default false, moves_used integer not null default 0,
  bonus_seconds integer not null default 0, submitted_line jsonb not null default '[]',
  client_reported_at timestamptz not null default now(), graded_at timestamptz,
  grading_error text, stage_reached_key text, unique (run_id,ordinal)
);
insert into auth.users (id) values ('11111111-1111-4111-8111-111111111111');
insert into public.puzzle_pool (id) values
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
('cccccccc-cccc-4ccc-8ccc-cccccccccccc');

create table public.profiles (
  id uuid primary key references auth.users(id), username text,
  glicko_rating double precision not null default 800,
  glicko_rd double precision not null default 350,
  glicko_vol double precision not null default 0.06,
  glicko_last_period timestamptz,
  provisional boolean not null default true,
  peak_rating double precision not null default 800,
  ranked_games_played integer not null default 0
);
create table public.ranked_games (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references auth.users(id),
  opponent_id text not null default 'bot:fritz:elite',
  played_at timestamptz not null default now(),
  rating_after double precision, rd_after double precision, delta double precision
);
create table public.rating_periods (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
  rating_before double precision, rating_after double precision,
  rd_before double precision, rd_after double precision,
  vol_before double precision, vol_after double precision,
  processed_at timestamptz
);
insert into public.profiles (id,username) values ('11111111-1111-4111-8111-111111111111','Test');

create table public.ghost_profiles (
  user_id uuid primary key references auth.users(id),
  ghost_rating integer not null default 800,
  last_updated timestamptz, composite_log jsonb, style_profile jsonb,
  games_played integer not null default 0
);
create table public.ghost_games (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  played_at timestamptz not null default now(),
  final_score integer not null, opponent_score integer not null,
  move_log jsonb not null default '[]', match_id uuid unique
);
