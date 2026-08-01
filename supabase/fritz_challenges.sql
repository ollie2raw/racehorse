create extension if not exists pgcrypto;

create table if not exists public.fritz_challenges (
  id uuid primary key default gen_random_uuid(),
  share_code text not null unique
    check (share_code ~ '^[23456789A-HJ-NP-Z]{8}$'),
  creator_user_id uuid not null references auth.users(id) on delete cascade,
  opponent_user_id uuid null references auth.users(id) on delete set null,
  seed text not null,
  format text not null default 'best_of_3'
    check (format = 'best_of_3'),
  fritz_tier text not null
    check (fritz_tier in ('rookie', 'standard', 'elite', 'master')),
  deal_size int not null
    check (deal_size in (7, 14)),
  winning_score int not null default 60
    check (winning_score = 60),
  rules_version int not null,
  fritz_policy_version int not null,
  verifier_version int not null,
  generator_version int not null,
  status text not null default 'open'
    check (status in ('open', 'active', 'completed', 'expired', 'cancelled')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  completed_at timestamptz null,
  constraint fritz_challenges_distinct_players
    check (opponent_user_id is null or opponent_user_id <> creator_user_id)
);

create index if not exists idx_fritz_challenges_creator_created
  on public.fritz_challenges (creator_user_id, created_at desc);

create index if not exists idx_fritz_challenges_opponent_created
  on public.fritz_challenges (opponent_user_id, created_at desc)
  where opponent_user_id is not null;

create table if not exists public.fritz_challenge_attempts (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.fritz_challenges(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'started'
    check (status in ('started', 'completed', 'abandoned')),
  current_game_number int not null default 1
    check (current_game_number between 1 and 3),
  current_hand_index int not null default 0
    check (current_hand_index >= 0),
  verified_match_id uuid null,
  completion_hash text null,
  result jsonb null,
  final_score int null,
  opponent_score int null,
  point_diff int null,
  won boolean null,
  moves_used int null,
  hands_played int null,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz null,
  unique (challenge_id, user_id)
);

alter table public.fritz_challenge_attempts
  add column if not exists verified_match_id uuid null,
  add column if not exists completion_hash text null,
  add column if not exists won boolean null,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_fritz_challenge_attempts_challenge_status
  on public.fritz_challenge_attempts (challenge_id, status, completed_at);

create table if not exists public.fritz_challenge_hands (
  challenge_id uuid not null references public.fritz_challenges(id) on delete cascade,
  game_number int not null check (game_number between 1 and 3),
  hand_index int not null check (hand_index >= 0),
  deal jsonb not null,
  generated_at timestamptz not null default now(),
  primary key (challenge_id, game_number, hand_index)
);

alter table public.fritz_challenges enable row level security;
alter table public.fritz_challenge_attempts enable row level security;
alter table public.fritz_challenge_hands enable row level security;

-- Challenge state is served by authenticated server endpoints only. The service
-- role bypasses RLS; browser clients receive sanitized records without seeds.
drop policy if exists "fritz_challenges_no_client_access" on public.fritz_challenges;
create policy "fritz_challenges_no_client_access"
  on public.fritz_challenges
  for all
  to authenticated
  using (false)
  with check (false);

drop policy if exists "fritz_challenge_attempts_no_client_access" on public.fritz_challenge_attempts;
create policy "fritz_challenge_attempts_no_client_access"
  on public.fritz_challenge_attempts
  for all
  to authenticated
  using (false)
  with check (false);

drop policy if exists "fritz_challenge_hands_no_client_access" on public.fritz_challenge_hands;
create policy "fritz_challenge_hands_no_client_access"
  on public.fritz_challenge_hands
  for all
  to authenticated
  using (false)
  with check (false);

create or replace function public.claim_fritz_challenge_opponent(
  p_challenge_id uuid,
  p_user_id uuid
)
returns table (
  challenge_id uuid,
  opponent_user_id uuid,
  challenge_status text
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  current_challenge public.fritz_challenges%rowtype;
begin
  select *
    into current_challenge
    from public.fritz_challenges
    where id = p_challenge_id
    for update;

  if not found then
    return;
  end if;

  if current_challenge.expires_at <= now() then
    update public.fritz_challenges
      set status = 'expired'
      where id = p_challenge_id
        and status in ('open', 'active');
    return;
  end if;

  if current_challenge.creator_user_id = p_user_id then
    return;
  end if;

  if current_challenge.opponent_user_id is null
    and current_challenge.status = 'open' then
    update public.fritz_challenges
      set opponent_user_id = p_user_id,
          status = 'active'
      where id = p_challenge_id
        and opponent_user_id is null
        and status = 'open'
      returning * into current_challenge;
  elsif current_challenge.opponent_user_id <> p_user_id then
    return;
  end if;

  return query
    select current_challenge.id,
           current_challenge.opponent_user_id,
           current_challenge.status;
end;
$$;

revoke all on function public.claim_fritz_challenge_opponent(uuid, uuid) from public;
revoke all on function public.claim_fritz_challenge_opponent(uuid, uuid) from authenticated;
grant execute on function public.claim_fritz_challenge_opponent(uuid, uuid) to service_role;

create or replace function public.start_fritz_challenge_attempt(
  p_challenge_id uuid,
  p_user_id uuid
)
returns table (
  attempt_id uuid,
  challenge_id uuid,
  user_id uuid,
  attempt_status text,
  current_game_number int,
  current_hand_index int,
  attempt_result jsonb,
  final_score int,
  opponent_score int,
  point_diff int,
  won boolean,
  moves_used int,
  hands_played int,
  started_at timestamptz,
  updated_at timestamptz,
  completed_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  current_challenge public.fritz_challenges%rowtype;
  current_attempt public.fritz_challenge_attempts%rowtype;
begin
  select *
    into current_challenge
    from public.fritz_challenges
    where id = p_challenge_id
    for update;

  if not found then
    return;
  end if;

  if current_challenge.expires_at <= now() then
    update public.fritz_challenges
      set status = 'expired'
      where id = p_challenge_id
        and status in ('open', 'active');
    return;
  end if;

  if p_user_id <> current_challenge.creator_user_id
    and p_user_id is distinct from current_challenge.opponent_user_id then
    return;
  end if;

  execute 'insert into public.fritz_challenge_attempts (challenge_id, user_id, status, current_game_number, current_hand_index) values ($1, $2, ''started'', 1, 0) on conflict do nothing'
    using p_challenge_id, p_user_id;

  select *
    into current_attempt
    from public.fritz_challenge_attempts
    where fritz_challenge_attempts.challenge_id = p_challenge_id
      and fritz_challenge_attempts.user_id = p_user_id;

  return query
    select current_attempt.id,
           current_attempt.challenge_id,
           current_attempt.user_id,
           current_attempt.status,
           current_attempt.current_game_number,
           current_attempt.current_hand_index,
           current_attempt.result,
           current_attempt.final_score,
           current_attempt.opponent_score,
           current_attempt.point_diff,
           current_attempt.won,
           current_attempt.moves_used,
           current_attempt.hands_played,
           current_attempt.started_at,
           current_attempt.updated_at,
           current_attempt.completed_at;
end;
$$;

revoke all on function public.start_fritz_challenge_attempt(uuid, uuid) from public;
revoke all on function public.start_fritz_challenge_attempt(uuid, uuid) from authenticated;
grant execute on function public.start_fritz_challenge_attempt(uuid, uuid) to service_role;

create or replace function public.get_or_create_fritz_challenge_hand(
  p_challenge_id uuid,
  p_game_number int,
  p_hand_index int,
  p_deal jsonb
)
returns table (
  challenge_id uuid,
  game_number int,
  hand_index int,
  deal jsonb,
  generated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  execute 'insert into public.fritz_challenge_hands (challenge_id, game_number, hand_index, deal) values ($1, $2, $3, $4) on conflict do nothing'
    using p_challenge_id, p_game_number, p_hand_index, p_deal;

  return query
    select stored.challenge_id,
           stored.game_number,
           stored.hand_index,
           stored.deal,
           stored.generated_at
      from public.fritz_challenge_hands as stored
      where stored.challenge_id = p_challenge_id
        and stored.game_number = p_game_number
        and stored.hand_index = p_hand_index;
end;
$$;

revoke all on function public.get_or_create_fritz_challenge_hand(uuid, int, int, jsonb) from public;
revoke all on function public.get_or_create_fritz_challenge_hand(uuid, int, int, jsonb) from authenticated;
grant execute on function public.get_or_create_fritz_challenge_hand(uuid, int, int, jsonb) to service_role;

-- Hand/game advancement is compare-and-set at the database boundary. The
-- verifier runs before these functions; these functions prevent two Render
-- instances from advancing the same participant attempt twice.
create or replace function public.advance_fritz_challenge_hand(
  p_attempt_id uuid,
  p_game_number int,
  p_hand_index int,
  p_attempt_result jsonb,
  p_player_score int,
  p_fritz_score int,
  p_moves_used int,
  p_hands_played int
)
returns setof public.fritz_challenge_attempts
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  current_attempt public.fritz_challenge_attempts%rowtype;
begin
  select * into current_attempt
    from public.fritz_challenge_attempts
    where id = p_attempt_id
    for update;
  if not found
    or current_attempt.status <> 'started'
    or current_attempt.current_game_number <> p_game_number
    or current_attempt.current_hand_index <> p_hand_index then
    return;
  end if;

  update public.fritz_challenge_attempts
    set result = p_attempt_result,
        current_hand_index = p_hand_index + 1,
        moves_used = p_moves_used,
        hands_played = p_hands_played,
        updated_at = now()
    where id = p_attempt_id
    returning * into current_attempt;
  return next current_attempt;
end;
$$;

revoke all on function public.advance_fritz_challenge_hand(uuid, int, int, jsonb, int, int, int, int) from public;
revoke all on function public.advance_fritz_challenge_hand(uuid, int, int, jsonb, int, int, int, int) from authenticated;
grant execute on function public.advance_fritz_challenge_hand(uuid, int, int, jsonb, int, int, int, int) to service_role;

create or replace function public.record_fritz_challenge_game(
  p_attempt_id uuid,
  p_game_number int,
  p_attempt_result jsonb,
  p_final_score int,
  p_opponent_score int,
  p_point_diff int,
  p_won boolean,
  p_moves_used int,
  p_hands_played int,
  p_completed boolean,
  p_next_game_number int
)
returns setof public.fritz_challenge_attempts
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  current_attempt public.fritz_challenge_attempts%rowtype;
begin
  select * into current_attempt
    from public.fritz_challenge_attempts
    where id = p_attempt_id
    for update;
  if not found
    or current_attempt.status <> 'started'
    or current_attempt.current_game_number <> p_game_number then
    return;
  end if;

  update public.fritz_challenge_attempts
    set result = p_attempt_result,
        status = case when p_completed then 'completed' else 'started' end,
        current_game_number = coalesce(p_next_game_number, p_game_number),
        current_hand_index = case when p_completed then current_hand_index else 0 end,
        final_score = case when p_completed then p_final_score else final_score end,
        opponent_score = case when p_completed then p_opponent_score else opponent_score end,
        point_diff = case when p_completed then p_point_diff else point_diff end,
        won = case when p_completed then p_won else won end,
        moves_used = p_moves_used,
        hands_played = p_hands_played,
        completed_at = case when p_completed then now() else completed_at end,
        updated_at = now()
    where id = p_attempt_id
    returning * into current_attempt;

  if p_completed then
    update public.fritz_challenges
      set status = 'completed', completed_at = now()
      where id = current_attempt.challenge_id;
  end if;
  return next current_attempt;
end;
$$;

revoke all on function public.record_fritz_challenge_game(uuid, int, jsonb, int, int, int, boolean, int, int, boolean, int) from public;
revoke all on function public.record_fritz_challenge_game(uuid, int, jsonb, int, int, int, boolean, int, int, boolean, int) from authenticated;
grant execute on function public.record_fritz_challenge_game(uuid, int, jsonb, int, int, int, boolean, int, int, boolean, int) to service_role;
