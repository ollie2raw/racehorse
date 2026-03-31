-- Daily Gauntlet schema + RPCs
-- Run after supabase/schema.sql.
-- IMPORTANT: Replace 'admin@example.com' in gauntlet_publish_day() with your real admin email
-- (same value used for VITE_ADMIN_EMAIL) before running in production.

create extension if not exists pgcrypto;

create table if not exists public.gauntlet_days (
  id serial primary key,
  date date unique not null,
  seed text not null,
  rounds jsonb not null,
  closes_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(rounds) = 'array'),
  check (jsonb_array_length(rounds) = 5)
);

create table if not exists public.gauntlet_day_solutions (
  gauntlet_day_id int primary key references public.gauntlet_days(id) on delete cascade,
  rounds_optimal jsonb not null,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(rounds_optimal) = 'array'),
  check (jsonb_array_length(rounds_optimal) = 5)
);

create table if not exists public.gauntlet_attempts (
  id serial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  gauntlet_day_id int not null references public.gauntlet_days(id) on delete cascade,
  status text not null default 'in_progress' check (status in ('in_progress', 'banked', 'finished')),
  started_at timestamptz not null default now(),
  finished_at timestamptz null,
  rounds_played int not null default 0 check (rounds_played >= 0 and rounds_played <= 5),
  banked_out boolean not null default false,
  total_score int not null default 0,
  elo_before int not null,
  elo_after int null,
  percentile double precision null check (percentile is null or (percentile >= 0 and percentile <= 1)),
  unique (user_id, gauntlet_day_id)
);

create table if not exists public.gauntlet_round_results (
  id serial primary key,
  attempt_id int not null references public.gauntlet_attempts(id) on delete cascade,
  round_number int not null check (round_number >= 1 and round_number <= 5),
  hand_played jsonb not null,
  replay_frames jsonb not null default '[]'::jsonb,
  time_taken_ms int not null check (time_taken_ms >= 0),
  base_score int not null,
  speed_bonus int not null,
  optimality_pct double precision not null check (optimality_pct >= 0 and optimality_pct <= 1),
  optimality_bonus int not null,
  round_total int not null,
  created_at timestamptz not null default now(),
  unique (attempt_id, round_number)
);

create table if not exists public.gauntlet_ratings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  rating int not null default 1000,
  peak_rating int not null default 1000,
  division text not null default 'Bronze',
  season int not null default 1,
  games_played int not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.gauntlet_seasons (
  id serial primary key,
  season_number int not null unique,
  starts_at date not null,
  ends_at date not null,
  division_cutoffs jsonb not null,
  created_at timestamptz not null default now(),
  check (starts_at <= ends_at)
);

create table if not exists public.gauntlet_replays (
  attempt_id int primary key references public.gauntlet_attempts(id) on delete cascade,
  replay_frames jsonb not null,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(replay_frames) = 'array')
);

create index if not exists idx_gauntlet_days_date on public.gauntlet_days(date);
create index if not exists idx_gauntlet_days_close on public.gauntlet_days(closes_at);
create index if not exists idx_gauntlet_attempts_day_score on public.gauntlet_attempts(gauntlet_day_id, total_score desc);
create index if not exists idx_gauntlet_attempts_user on public.gauntlet_attempts(user_id, started_at desc);
create index if not exists idx_gauntlet_round_attempt on public.gauntlet_round_results(attempt_id, round_number);

alter table public.gauntlet_days enable row level security;
alter table public.gauntlet_day_solutions enable row level security;
alter table public.gauntlet_attempts enable row level security;
alter table public.gauntlet_round_results enable row level security;
alter table public.gauntlet_ratings enable row level security;
alter table public.gauntlet_seasons enable row level security;
alter table public.gauntlet_replays enable row level security;

drop policy if exists "gauntlet_days_select_all" on public.gauntlet_days;
create policy "gauntlet_days_select_all"
  on public.gauntlet_days
  for select
  to anon, authenticated
  using (true);

drop policy if exists "gauntlet_solutions_none" on public.gauntlet_day_solutions;
create policy "gauntlet_solutions_none"
  on public.gauntlet_day_solutions
  for all
  to anon, authenticated
  using (false)
  with check (false);

drop policy if exists "gauntlet_attempts_select_own" on public.gauntlet_attempts;
create policy "gauntlet_attempts_select_own"
  on public.gauntlet_attempts
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "gauntlet_attempts_insert_own" on public.gauntlet_attempts;
create policy "gauntlet_attempts_insert_own"
  on public.gauntlet_attempts
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "gauntlet_attempts_update_own" on public.gauntlet_attempts;
create policy "gauntlet_attempts_update_own"
  on public.gauntlet_attempts
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "gauntlet_round_results_select_own" on public.gauntlet_round_results;
create policy "gauntlet_round_results_select_own"
  on public.gauntlet_round_results
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.gauntlet_attempts a
      where a.id = gauntlet_round_results.attempt_id
        and a.user_id = auth.uid()
    )
  );

drop policy if exists "gauntlet_round_results_insert_own" on public.gauntlet_round_results;
create policy "gauntlet_round_results_insert_own"
  on public.gauntlet_round_results
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.gauntlet_attempts a
      where a.id = gauntlet_round_results.attempt_id
        and a.user_id = auth.uid()
    )
  );

drop policy if exists "gauntlet_round_results_update_own" on public.gauntlet_round_results;
create policy "gauntlet_round_results_update_own"
  on public.gauntlet_round_results
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.gauntlet_attempts a
      where a.id = gauntlet_round_results.attempt_id
        and a.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.gauntlet_attempts a
      where a.id = gauntlet_round_results.attempt_id
        and a.user_id = auth.uid()
    )
  );

drop policy if exists "gauntlet_ratings_select_all" on public.gauntlet_ratings;
create policy "gauntlet_ratings_select_all"
  on public.gauntlet_ratings
  for select
  to authenticated
  using (true);

drop policy if exists "gauntlet_ratings_insert_own" on public.gauntlet_ratings;
create policy "gauntlet_ratings_insert_own"
  on public.gauntlet_ratings
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "gauntlet_ratings_update_own" on public.gauntlet_ratings;
create policy "gauntlet_ratings_update_own"
  on public.gauntlet_ratings
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "gauntlet_seasons_select_all" on public.gauntlet_seasons;
create policy "gauntlet_seasons_select_all"
  on public.gauntlet_seasons
  for select
  to anon, authenticated
  using (true);

drop policy if exists "gauntlet_replays_select_closed" on public.gauntlet_replays;
create policy "gauntlet_replays_select_closed"
  on public.gauntlet_replays
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.gauntlet_attempts a
      join public.gauntlet_days d on d.id = a.gauntlet_day_id
      where a.id = gauntlet_replays.attempt_id
        and d.closes_at <= now()
    )
  );

drop policy if exists "gauntlet_replays_insert_own" on public.gauntlet_replays;
create policy "gauntlet_replays_insert_own"
  on public.gauntlet_replays
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.gauntlet_attempts a
      where a.id = gauntlet_replays.attempt_id
        and a.user_id = auth.uid()
    )
  );

create or replace function public.gauntlet_division_for_rating(p_rating int)
returns text
language sql
immutable
as $$
  select case
    when p_rating >= 1800 then 'Diamond'
    when p_rating >= 1600 then 'Platinum'
    when p_rating >= 1400 then 'Gold'
    when p_rating >= 1200 then 'Silver'
    else 'Bronze'
  end;
$$;

create or replace function public.gauntlet_today_summary()
returns table (
  day_id int,
  day_date date,
  rounds jsonb,
  closes_at timestamptz,
  attempt_count int,
  attempt_id int,
  attempt_status text,
  rounds_played int,
  total_score int,
  rating int,
  division text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day public.gauntlet_days%rowtype;
begin
  select *
    into v_day
  from public.gauntlet_days
  where date = (now() at time zone 'utc')::date
  limit 1;

  if not found then
    return;
  end if;

  return query
  select
    v_day.id,
    v_day.date,
    v_day.rounds,
    v_day.closes_at,
    (select count(*)::int from public.gauntlet_attempts a where a.gauntlet_day_id = v_day.id),
    a.id,
    a.status,
    coalesce(a.rounds_played, 0),
    coalesce(a.total_score, 0),
    coalesce(r.rating, 1000),
    coalesce(r.division, 'Bronze')
  from (select 1) one
  left join public.gauntlet_attempts a
    on a.gauntlet_day_id = v_day.id
    and a.user_id = auth.uid()
  left join public.gauntlet_ratings r
    on r.user_id = auth.uid();
end;
$$;

create or replace function public.gauntlet_start_attempt()
returns table (
  attempt_id int,
  gauntlet_day_id int,
  elo_before int,
  rating_division text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day public.gauntlet_days%rowtype;
  v_rating public.gauntlet_ratings%rowtype;
  v_attempt public.gauntlet_attempts%rowtype;
  v_email text;
  v_is_admin boolean;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_is_admin := (v_email = lower('olivermorid@gmail.com'));

  select *
    into v_day
  from public.gauntlet_days
  where date = (now() at time zone 'utc')::date
  limit 1;

  if not found then
    raise exception 'No gauntlet configured for today';
  end if;

  insert into public.gauntlet_ratings (user_id)
  values (auth.uid())
  on conflict (user_id) do nothing;

  select *
    into v_rating
  from public.gauntlet_ratings
  where user_id = auth.uid();

  -- If an attempt already exists today:
  -- - normal users keep one-attempt/day behavior
  -- - admin can reset for iterative testing/demo
  select *
    into v_attempt
  from public.gauntlet_attempts
  where user_id = auth.uid()
    and gauntlet_day_id = v_day.id
  limit 1;

  if found then
    if v_attempt.status = 'in_progress' then
      return query
      select v_attempt.id, v_day.id, v_attempt.elo_before, coalesce(v_rating.division, 'Bronze');
      return;
    end if;

    if v_is_admin then
      delete from public.gauntlet_round_results where attempt_id = v_attempt.id;
      delete from public.gauntlet_replays where attempt_id = v_attempt.id;
      update public.gauntlet_attempts
      set
        status = 'in_progress',
        started_at = now(),
        finished_at = null,
        rounds_played = 0,
        banked_out = false,
        total_score = 0,
        elo_before = coalesce(v_rating.rating, 1000),
        elo_after = null,
        percentile = null
      where id = v_attempt.id
      returning * into v_attempt;

      return query
      select v_attempt.id, v_day.id, v_attempt.elo_before, coalesce(v_rating.division, 'Bronze');
      return;
    end if;

    raise exception 'Attempt already finalized';
  end if;

  insert into public.gauntlet_attempts (
    user_id,
    gauntlet_day_id,
    elo_before
  )
  values (
    auth.uid(),
    v_day.id,
    coalesce(v_rating.rating, 1000)
  )
  on conflict on constraint gauntlet_attempts_user_id_gauntlet_day_id_key do update
    set started_at = gauntlet_attempts.started_at
  returning * into v_attempt;

  return query
  select v_attempt.id, v_day.id, v_attempt.elo_before, coalesce(v_rating.division, 'Bronze');
end;
$$;

create or replace function public.gauntlet_submit_round(
  p_attempt_id int,
  p_round_number int,
  p_hand_played jsonb,
  p_time_taken_ms int,
  p_player_score int,
  p_replay_frames jsonb default '[]'::jsonb
)
returns table (
  base_score int,
  speed_bonus int,
  optimality_pct double precision,
  optimality_bonus int,
  round_total int,
  running_total int,
  rounds_played int,
  has_more_rounds boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt public.gauntlet_attempts%rowtype;
  v_day public.gauntlet_days%rowtype;
  v_optimal_score int;
  v_base_score int;
  v_speed_bonus int;
  v_optimality_pct double precision;
  v_optimality_bonus int;
  v_round_total int;
  v_rounds_played int;
  v_pre_total int;
  v_multiplier numeric;
  v_post_total int;
  v_solution jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if p_round_number < 1 or p_round_number > 5 then
    raise exception 'Round must be between 1 and 5';
  end if;
  if p_time_taken_ms < 0 then
    raise exception 'time_taken_ms must be >= 0';
  end if;

  select *
    into v_attempt
  from public.gauntlet_attempts
  where id = p_attempt_id
    and user_id = auth.uid()
  limit 1;

  if not found then
    raise exception 'Attempt not found';
  end if;

  if v_attempt.status <> 'in_progress' then
    raise exception 'Attempt is already finalized';
  end if;

  select *
    into v_day
  from public.gauntlet_days
  where id = v_attempt.gauntlet_day_id;

  if v_day.closes_at <= now() then
    raise exception 'Gauntlet day already closed';
  end if;

  select s.rounds_optimal -> (p_round_number - 1)
    into v_solution
  from public.gauntlet_day_solutions s
  where s.gauntlet_day_id = v_day.id;

  if v_solution is null then
    raise exception 'Missing round solution';
  end if;

  v_optimal_score := greatest(1, coalesce((v_solution ->> 'optimalScore')::int, 1));

  v_base_score := case p_round_number
    when 1 then 500
    when 2 then 800
    when 3 then 1200
    when 4 then 1800
    else 2500
  end;

  v_speed_bonus := greatest(0, round(500 * (1 - ((p_time_taken_ms::numeric / 1000.0) / 120.0))));
  v_optimality_pct := least(1.0, greatest(0.0, p_player_score::double precision / v_optimal_score::double precision));
  v_optimality_bonus := round(1000 * v_optimality_pct);
  v_round_total := v_base_score + v_speed_bonus + v_optimality_bonus;

  insert into public.gauntlet_round_results (
    attempt_id,
    round_number,
    hand_played,
    replay_frames,
    time_taken_ms,
    base_score,
    speed_bonus,
    optimality_pct,
    optimality_bonus,
    round_total
  )
  values (
    v_attempt.id,
    p_round_number,
    coalesce(p_hand_played, '[]'::jsonb),
    coalesce(p_replay_frames, '[]'::jsonb),
    p_time_taken_ms,
    v_base_score,
    v_speed_bonus,
    v_optimality_pct,
    v_optimality_bonus,
    v_round_total
  )
  on conflict (attempt_id, round_number) do update
  set
    hand_played = excluded.hand_played,
    replay_frames = excluded.replay_frames,
    time_taken_ms = excluded.time_taken_ms,
    base_score = excluded.base_score,
    speed_bonus = excluded.speed_bonus,
    optimality_pct = excluded.optimality_pct,
    optimality_bonus = excluded.optimality_bonus,
    round_total = excluded.round_total;

  select coalesce(sum(rr.round_total), 0), coalesce(max(rr.round_number), 0)
    into v_pre_total, v_rounds_played
  from public.gauntlet_round_results rr
  where rr.attempt_id = v_attempt.id;

  v_multiplier := case
    when v_rounds_played >= 5 then 1.35
    when v_rounds_played >= 4 then 1.15
    else 1.0
  end;

  v_post_total := round(v_pre_total * v_multiplier);

  update public.gauntlet_attempts
  set
    rounds_played = v_rounds_played,
    total_score = v_post_total
  where id = v_attempt.id;

  return query
  select
    v_base_score,
    v_speed_bonus,
    v_optimality_pct,
    v_optimality_bonus,
    v_round_total,
    v_post_total,
    v_rounds_played,
    (v_rounds_played < 5);
end;
$$;

create or replace function public.gauntlet_finalize_attempt(
  p_attempt_id int,
  p_banked boolean,
  p_replay_frames jsonb default null
)
returns table (
  total_score int,
  rounds_played int,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt public.gauntlet_attempts%rowtype;
  v_status text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select *
    into v_attempt
  from public.gauntlet_attempts
  where id = p_attempt_id
    and user_id = auth.uid()
  limit 1;

  if not found then
    raise exception 'Attempt not found';
  end if;

  v_status := case when p_banked then 'banked' else 'finished' end;

  update public.gauntlet_attempts
  set
    status = v_status,
    banked_out = p_banked,
    finished_at = coalesce(finished_at, now())
  where id = v_attempt.id;

  if p_replay_frames is not null then
    insert into public.gauntlet_replays (attempt_id, replay_frames)
    values (v_attempt.id, p_replay_frames)
    on conflict (attempt_id) do update
      set replay_frames = excluded.replay_frames;
  end if;

  return query
  select a.total_score, a.rounds_played, a.status
  from public.gauntlet_attempts a
  where a.id = v_attempt.id;
end;
$$;

create or replace function public.gauntlet_my_history(p_limit int default 30)
returns table (
  attempt_id int,
  day_date date,
  total_score int,
  rounds_played int,
  banked_out boolean,
  percentile double precision,
  elo_before int,
  elo_after int,
  finished_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    a.id,
    d.date,
    a.total_score,
    a.rounds_played,
    a.banked_out,
    a.percentile,
    a.elo_before,
    a.elo_after,
    a.finished_at
  from public.gauntlet_attempts a
  join public.gauntlet_days d on d.id = a.gauntlet_day_id
  where a.user_id = auth.uid()
  order by d.date desc
  limit greatest(1, least(coalesce(p_limit, 30), 90));
$$;

create or replace function public.gauntlet_rating(p_user_id uuid default null)
returns table (
  user_id uuid,
  rating int,
  peak_rating int,
  division text,
  season int,
  games_played int,
  season_rank bigint
)
language sql
security definer
set search_path = public
as $$
  with target as (
    select coalesce(p_user_id, auth.uid()) as uid
  )
  select
    r.user_id,
    r.rating,
    r.peak_rating,
    r.division,
    r.season,
    r.games_played,
    (
      select rank
      from (
        select user_id, rank() over (order by rating desc, updated_at asc) as rank
        from public.gauntlet_ratings
      ) ranks
      where ranks.user_id = r.user_id
    ) as season_rank
  from target t
  join public.gauntlet_ratings r on r.user_id = t.uid;
$$;

create or replace function public.gauntlet_leaderboard(
  p_day_date date,
  p_limit int default 100
)
returns table (
  rank bigint,
  user_id uuid,
  username text,
  total_score int,
  rounds_played int,
  finished_at timestamptz,
  division text,
  percentile double precision,
  is_caller boolean
)
language sql
security definer
set search_path = public
as $$
  with day_row as (
    select id from public.gauntlet_days where date = p_day_date limit 1
  ),
  ranked as (
    select
      a.user_id,
      coalesce(p.username, 'Player') as username,
      a.total_score,
      a.rounds_played,
      a.finished_at,
      coalesce(r.division, 'Bronze') as division,
      a.percentile,
      rank() over (order by a.total_score desc, a.rounds_played desc, a.finished_at asc, a.id asc) as rank
    from public.gauntlet_attempts a
    join day_row d on d.id = a.gauntlet_day_id
    left join public.profiles p on p.id = a.user_id
    left join public.gauntlet_ratings r on r.user_id = a.user_id
    where a.finished_at is not null
  )
  select
    ranked.rank,
    ranked.user_id,
    ranked.username,
    ranked.total_score,
    ranked.rounds_played,
    ranked.finished_at,
    ranked.division,
    ranked.percentile,
    ranked.user_id = auth.uid() as is_caller
  from ranked
  where ranked.rank <= greatest(1, least(coalesce(p_limit, 100), 250))
     or ranked.user_id = auth.uid()
  order by ranked.rank asc;
$$;

create or replace function public.gauntlet_replay_for_day(p_day_date date)
returns table (
  user_id uuid,
  username text,
  total_score int,
  replay_frames jsonb
)
language sql
security definer
set search_path = public
as $$
  with day_row as (
    select id, closes_at
    from public.gauntlet_days
    where date = p_day_date
    limit 1
  ),
  winner as (
    select a.*
    from public.gauntlet_attempts a
    join day_row d on d.id = a.gauntlet_day_id
    where d.closes_at <= now()
      and a.finished_at is not null
    order by a.total_score desc, a.rounds_played desc, a.finished_at asc, a.id asc
    limit 1
  )
  select
    w.user_id,
    coalesce(p.username, 'Player') as username,
    w.total_score,
    gr.replay_frames
  from winner w
  join public.gauntlet_replays gr on gr.attempt_id = w.id
  left join public.profiles p on p.id = w.user_id;
$$;

-- Admin publish helper: upsert a full day + hidden optimal solutions.
create or replace function public.gauntlet_publish_day(
  p_day_date date,
  p_seed text,
  p_rounds jsonb,
  p_rounds_optimal jsonb,
  p_closes_at timestamptz
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day_id int;
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  if v_email <> lower('admin@example.com') then
    raise exception 'Admin only';
  end if;

  if p_day_date is null then
    raise exception 'p_day_date is required';
  end if;
  if p_seed is null or length(trim(p_seed)) = 0 then
    raise exception 'p_seed is required';
  end if;
  if jsonb_typeof(p_rounds) <> 'array' or jsonb_array_length(p_rounds) <> 5 then
    raise exception 'p_rounds must be a 5-element array';
  end if;
  if jsonb_typeof(p_rounds_optimal) <> 'array' or jsonb_array_length(p_rounds_optimal) <> 5 then
    raise exception 'p_rounds_optimal must be a 5-element array';
  end if;

  insert into public.gauntlet_days (date, seed, rounds, closes_at)
  values (p_day_date, p_seed, p_rounds, p_closes_at)
  on conflict (date) do update
    set seed = excluded.seed,
        rounds = excluded.rounds,
        closes_at = excluded.closes_at
  returning id into v_day_id;

  insert into public.gauntlet_day_solutions (gauntlet_day_id, rounds_optimal)
  values (v_day_id, p_rounds_optimal)
  on conflict (gauntlet_day_id) do update
    set rounds_optimal = excluded.rounds_optimal;

  return v_day_id;
end;
$$;

-- Internal/admin function: run once after close to compute percentiles + Elo.
create or replace function public.gauntlet_close_day(p_day_date date)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day public.gauntlet_days%rowtype;
  v_count int := 0;
  v_row record;
  v_new_rating int;
  v_expected double precision;
  v_delta int;
begin
  select * into v_day from public.gauntlet_days where date = p_day_date limit 1;
  if not found then
    return 0;
  end if;

  -- Percentiles based on final rank.
  with ranked as (
    select
      a.id,
      rank() over (order by a.total_score desc, a.rounds_played desc, a.finished_at asc, a.id asc) as rnk,
      count(*) over () as total
    from public.gauntlet_attempts a
    where a.gauntlet_day_id = v_day.id
      and a.finished_at is not null
  )
  update public.gauntlet_attempts a
  set percentile = case
    when ranked.total <= 1 then 1.0
    else 1.0 - ((ranked.rnk - 1)::double precision / (ranked.total - 1)::double precision)
  end
  from ranked
  where ranked.id = a.id;

  for v_row in
    select
      a.id as attempt_id,
      a.user_id,
      a.percentile,
      coalesce(r.rating, 1000) as current_rating,
      coalesce(r.peak_rating, 1000) as peak_rating,
      coalesce(r.games_played, 0) as games_played,
      coalesce(r.season, 1) as season
    from public.gauntlet_attempts a
    left join public.gauntlet_ratings r on r.user_id = a.user_id
    where a.gauntlet_day_id = v_day.id
      and a.finished_at is not null
  loop
    v_expected := 1 / (1 + power(10, (((1000 + ((v_row.percentile - 0.5) * 400)) - v_row.current_rating) / 400.0)));
    v_delta := round(32 * (v_row.percentile - v_expected));
    v_new_rating := greatest(0, v_row.current_rating + v_delta);

    insert into public.gauntlet_ratings (user_id, rating, peak_rating, division, season, games_played, updated_at)
    values (
      v_row.user_id,
      v_new_rating,
      greatest(v_row.peak_rating, v_new_rating),
      public.gauntlet_division_for_rating(v_new_rating),
      v_row.season,
      v_row.games_played + 1,
      now()
    )
    on conflict (user_id) do update
      set rating = excluded.rating,
          peak_rating = excluded.peak_rating,
          division = excluded.division,
          season = excluded.season,
          games_played = excluded.games_played,
          updated_at = excluded.updated_at;

    update public.gauntlet_attempts
    set elo_after = v_new_rating
    where id = v_row.attempt_id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- Lock down function execution; then grant only app-facing RPCs.
revoke all on function public.gauntlet_today_summary() from public;
revoke all on function public.gauntlet_start_attempt() from public;
revoke all on function public.gauntlet_submit_round(int, int, jsonb, int, int, jsonb) from public;
revoke all on function public.gauntlet_finalize_attempt(int, boolean, jsonb) from public;
revoke all on function public.gauntlet_my_history(int) from public;
revoke all on function public.gauntlet_rating(uuid) from public;
revoke all on function public.gauntlet_leaderboard(date, int) from public;
revoke all on function public.gauntlet_replay_for_day(date) from public;
revoke all on function public.gauntlet_close_day(date) from public;
revoke all on function public.gauntlet_publish_day(date, text, jsonb, jsonb, timestamptz) from public;

grant execute on function public.gauntlet_today_summary() to authenticated;
grant execute on function public.gauntlet_start_attempt() to authenticated;
grant execute on function public.gauntlet_submit_round(int, int, jsonb, int, int, jsonb) to authenticated;
grant execute on function public.gauntlet_finalize_attempt(int, boolean, jsonb) to authenticated;
grant execute on function public.gauntlet_my_history(int) to authenticated;
grant execute on function public.gauntlet_rating(uuid) to authenticated;
grant execute on function public.gauntlet_leaderboard(date, int) to anon, authenticated;
grant execute on function public.gauntlet_replay_for_day(date) to anon, authenticated;
grant execute on function public.gauntlet_publish_day(date, text, jsonb, jsonb, timestamptz) to authenticated;

-- Deliberately no grant for gauntlet_close_day(date): run via service role / SQL console.
