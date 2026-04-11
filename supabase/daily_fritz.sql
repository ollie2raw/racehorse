create extension if not exists pgcrypto;

create table if not exists public.daily_fritz_runs (
  run_date date primary key,
  seed text not null,
  fritz_tier text not null,
  deal_size int not null check (deal_size in (7, 14)),
  winning_score int not null,
  status text not null check (status in ('live', 'archived', 'invalidated')),
  hand_deals jsonb not null,
  generated_at timestamptz not null default now(),
  invalidated_at timestamptz null,
  metadata jsonb null
);

create table if not exists public.daily_fritz_attempts (
  id uuid primary key default gen_random_uuid(),
  run_date date not null references public.daily_fritz_runs(run_date) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null check (status in ('started', 'completed', 'abandoned')),
  current_hand_index int not null default 0,
  started_at timestamptz not null default now(),
  completed_at timestamptz null,
  verified_match_id uuid null,
  completion_hash text null,
  result jsonb null,
  final_score int null,
  opponent_score int null,
  point_diff int null,
  won boolean null,
  moves_used int null,
  hands_played int null
);

create unique index if not exists idx_daily_fritz_attempts_run_user
  on public.daily_fritz_attempts (run_date, user_id);

create index if not exists idx_daily_fritz_attempts_run_status
  on public.daily_fritz_attempts (run_date, status, completed_at);

alter table public.daily_fritz_runs enable row level security;
alter table public.daily_fritz_attempts enable row level security;

drop policy if exists "daily_fritz_runs_read_all" on public.daily_fritz_runs;
create policy "daily_fritz_runs_read_all"
  on public.daily_fritz_runs
  for select
  to authenticated
  using (true);

drop policy if exists "daily_fritz_runs_no_client_write" on public.daily_fritz_runs;
create policy "daily_fritz_runs_no_client_write"
  on public.daily_fritz_runs
  for all
  to authenticated
  using (false)
  with check (false);

drop policy if exists "daily_fritz_attempts_select_own" on public.daily_fritz_attempts;
create policy "daily_fritz_attempts_select_own"
  on public.daily_fritz_attempts
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "daily_fritz_attempts_no_client_write" on public.daily_fritz_attempts;
create policy "daily_fritz_attempts_no_client_write"
  on public.daily_fritz_attempts
  for all
  to authenticated
  using (false)
  with check (false);

