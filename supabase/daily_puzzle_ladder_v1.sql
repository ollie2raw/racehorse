begin;

create extension if not exists pgcrypto;

alter table if exists public.daily_puzzles
  add column if not exists slot_index int,
  add column if not exists slot_title text,
  add column if not exists tier text,
  add column if not exists slot_max_points int,
  add column if not exists objective_type text,
  add column if not exists objective_payload jsonb not null default '{}'::jsonb,
  add column if not exists set_version int not null default 1,
  add column if not exists published boolean not null default true;

with ranked as (
  select
    id,
    puzzle_type,
    count(*) over (partition by puzzle_date) as rows_for_date,
    row_number() over (
      partition by puzzle_date
      order by
        case puzzle_type
          when 'reach_target' then 1
          when 'setup_and_strike' then 2
          when 'one_turn_high_score' then 3
          when 'branch_mastery' then 4
          else 5
        end,
        created_at,
        id
    ) as rn
  from public.daily_puzzles
)
update public.daily_puzzles p
set
  slot_index = coalesce(
    p.slot_index,
    case
      when ranked.rows_for_date = 1 and ranked.puzzle_type = 'one_turn_high_score' then 3
      when ranked.rn <= 3 then ranked.rn
      else 3
    end
  ),
  slot_title = coalesce(
    p.slot_title,
    case
      when ranked.rows_for_date = 1 and ranked.puzzle_type = 'one_turn_high_score' then 'Master Chain'
      when ranked.rn = 1 then 'Quick Line'
      when ranked.rn = 2 then 'Tactical Setup'
      else 'Master Chain'
    end
  ),
  tier = coalesce(
    p.tier,
    case
      when ranked.rows_for_date = 1 and ranked.puzzle_type = 'one_turn_high_score' then 'master_chain'
      when ranked.rn = 1 then 'quick_line'
      when ranked.rn = 2 then 'tactical_setup'
      else 'master_chain'
    end
  ),
  slot_max_points = coalesce(
    p.slot_max_points,
    case
      when ranked.rows_for_date = 1 and ranked.puzzle_type = 'one_turn_high_score' then 400
      when ranked.rn = 1 then 150
      when ranked.rn = 2 then 250
      else 400
    end
  ),
  objective_type = coalesce(p.objective_type, p.puzzle_type, 'one_turn_high_score'),
  set_version = case
    when p.set_version is not null and p.set_version > 0 then p.set_version
    when ranked.rows_for_date = 1 and ranked.puzzle_type = 'one_turn_high_score' then 1
    when ranked.rn <= 3 then 1
    else ranked.rn - 2
  end,
  published = coalesce(p.published, true)
from ranked
where p.id = ranked.id;

alter table public.daily_puzzles
  alter column slot_index set not null,
  alter column slot_title set not null,
  alter column tier set not null,
  alter column slot_max_points set not null,
  alter column objective_type set not null,
  alter column set_version set not null,
  alter column published set not null;

alter table public.daily_puzzles
  drop constraint if exists daily_puzzles_slot_index_check;

alter table public.daily_puzzles
  add constraint daily_puzzles_slot_index_check
  check (slot_index between 1 and 5);

alter table public.daily_puzzles
  drop constraint if exists daily_puzzles_slot_max_points_check;

alter table public.daily_puzzles
  add constraint daily_puzzles_slot_max_points_check
  check (slot_max_points > 0);

do $$
declare
  constraint_name text;
begin
  select tc.constraint_name
    into constraint_name
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on tc.constraint_name = kcu.constraint_name
   and tc.table_schema = kcu.table_schema
  where tc.table_schema = 'public'
    and tc.table_name = 'daily_puzzles'
    and tc.constraint_type = 'UNIQUE'
  group by tc.constraint_name
  having array_agg(kcu.column_name order by kcu.ordinal_position) = array['puzzle_date', 'puzzle_type']
  limit 1;

  if constraint_name is not null then
    execute format('alter table public.daily_puzzles drop constraint %I', constraint_name);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'daily_puzzles'
      and constraint_name = 'daily_puzzles_puzzle_date_slot_index_set_version_key'
  ) then
    alter table public.daily_puzzles
      add constraint daily_puzzles_puzzle_date_slot_index_set_version_key
      unique (puzzle_date, slot_index, set_version);
  end if;
end $$;

create index if not exists daily_puzzles_published_date_idx
  on public.daily_puzzles (puzzle_date, set_version, slot_index)
  where published = true;

create table if not exists public.daily_puzzle_attempts (
  id uuid primary key default gen_random_uuid(),
  puzzle_date date not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  username text null,
  status text not null default 'started',
  set_version int not null default 1,
  current_slot_index int not null default 1,
  puzzles_completed int not null default 0,
  total_score int not null default 0,
  master_chain_score int not null default 0,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz null,
  review_unlocked boolean not null default false,
  result jsonb not null default '{}'::jsonb,
  constraint daily_puzzle_attempts_status_check
    check (status in ('started', 'completed')),
  constraint daily_puzzle_attempts_current_slot_index_check
    check (current_slot_index between 1 and 5),
  constraint daily_puzzle_attempts_puzzles_completed_check
    check (puzzles_completed between 0 and 3),
  constraint daily_puzzle_attempts_total_score_check
    check (total_score >= 0),
  constraint daily_puzzle_attempts_master_chain_score_check
    check (master_chain_score >= 0),
  constraint daily_puzzle_attempts_puzzle_date_user_id_key
    unique (puzzle_date, user_id)
);

create table if not exists public.daily_puzzle_slot_results (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.daily_puzzle_attempts(id) on delete cascade,
  puzzle_id uuid not null references public.daily_puzzles(id) on delete restrict,
  puzzle_date date not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  slot_index int not null,
  tier text not null,
  slot_title text not null,
  puzzle_type text not null,
  raw_score int not null default 0,
  awarded_points int not null default 0,
  best_possible_score int not null default 0,
  slot_max_points int not null default 0,
  solved boolean not null default false,
  perfect boolean not null default false,
  moves_used int not null default 0,
  elapsed_seconds int not null default 0,
  submitted_line jsonb not null default '[]'::jsonb,
  result jsonb not null default '{}'::jsonb,
  completed_at timestamptz not null default now(),
  constraint daily_puzzle_slot_results_attempt_slot_key
    unique (attempt_id, slot_index),
  constraint daily_puzzle_slot_results_slot_index_check
    check (slot_index between 1 and 5),
  constraint daily_puzzle_slot_results_raw_score_check
    check (raw_score >= 0),
  constraint daily_puzzle_slot_results_awarded_points_check
    check (awarded_points >= 0),
  constraint daily_puzzle_slot_results_best_possible_score_check
    check (best_possible_score >= 0),
  constraint daily_puzzle_slot_results_slot_max_points_check
    check (slot_max_points >= 0),
  constraint daily_puzzle_slot_results_moves_used_check
    check (moves_used >= 0),
  constraint daily_puzzle_slot_results_elapsed_seconds_check
    check (elapsed_seconds >= 0)
);

create index if not exists daily_puzzle_attempts_leaderboard_idx
  on public.daily_puzzle_attempts (
    puzzle_date,
    puzzles_completed desc,
    total_score desc,
    master_chain_score desc,
    completed_at asc,
    id asc
  );

create index if not exists daily_puzzle_attempts_user_date_idx
  on public.daily_puzzle_attempts (user_id, puzzle_date desc);

create index if not exists daily_puzzle_slot_results_attempt_idx
  on public.daily_puzzle_slot_results (attempt_id, slot_index asc);

create index if not exists daily_puzzle_slot_results_leaderboard_idx
  on public.daily_puzzle_slot_results (puzzle_date, slot_index asc, completed_at asc);

alter table public.daily_puzzle_attempts enable row level security;
alter table public.daily_puzzle_slot_results enable row level security;
alter table public.daily_puzzles enable row level security;

drop policy if exists "daily_puzzle_attempts_select_own" on public.daily_puzzle_attempts;
create policy "daily_puzzle_attempts_select_own"
  on public.daily_puzzle_attempts
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "daily_puzzle_attempts_insert_own" on public.daily_puzzle_attempts;
create policy "daily_puzzle_attempts_insert_own"
  on public.daily_puzzle_attempts
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "daily_puzzle_attempts_update_own" on public.daily_puzzle_attempts;
create policy "daily_puzzle_attempts_update_own"
  on public.daily_puzzle_attempts
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "daily_puzzle_slot_results_select_own" on public.daily_puzzle_slot_results;
create policy "daily_puzzle_slot_results_select_own"
  on public.daily_puzzle_slot_results
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "daily_puzzle_slot_results_insert_own" on public.daily_puzzle_slot_results;
create policy "daily_puzzle_slot_results_insert_own"
  on public.daily_puzzle_slot_results
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "daily_puzzle_slot_results_update_own" on public.daily_puzzle_slot_results;
create policy "daily_puzzle_slot_results_update_own"
  on public.daily_puzzle_slot_results
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "daily_puzzles_select_all" on public.daily_puzzles;
create policy "daily_puzzles_select_all"
  on public.daily_puzzles
  for select
  to anon, authenticated
  using (published = true);

commit;
