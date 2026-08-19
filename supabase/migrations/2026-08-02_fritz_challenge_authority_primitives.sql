-- Fritz Challenge authority primitives. This is additive: existing challenge
-- flows continue to operate until the transactional command cutover is enabled.

alter table public.fritz_challenge_attempts
  add column if not exists revision bigint not null default 0,
  add column if not exists authority_schema_version int not null default 1;

create index if not exists idx_fritz_challenge_attempts_active_revision
  on public.fritz_challenge_attempts (id, revision)
  where status = 'started';

-- A challenge's deal-generating and verification contract is published at
-- creation. Status and opponent ownership may evolve, but no privileged
-- process may silently change the fairness contract mid-match.
create or replace function public.fritz_challenge_contract_is_immutable()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.seed is distinct from old.seed
    or new.format is distinct from old.format
    or new.fritz_tier is distinct from old.fritz_tier
    or new.deal_size is distinct from old.deal_size
    or new.winning_score is distinct from old.winning_score
    or new.rules_version is distinct from old.rules_version
    or new.fritz_policy_version is distinct from old.fritz_policy_version
    or new.verifier_version is distinct from old.verifier_version
    or new.generator_version is distinct from old.generator_version then
    raise exception 'fritz_challenge_contract_is_immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_fritz_challenge_contract on public.fritz_challenges;
create trigger protect_fritz_challenge_contract
before update on public.fritz_challenges
for each row execute function public.fritz_challenge_contract_is_immutable();

create or replace function public.fritz_challenge_hand_is_immutable()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  raise exception 'fritz_challenge_hand_is_immutable';
end;
$$;

drop trigger if exists protect_fritz_challenge_hand on public.fritz_challenge_hands;
create trigger protect_fritz_challenge_hand
before update on public.fritz_challenge_hands
for each row execute function public.fritz_challenge_hand_is_immutable();

create table if not exists public.fritz_challenge_attempt_operations (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.fritz_challenge_attempts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  challenge_id uuid not null references public.fritz_challenges(id) on delete cascade,
  operation_id text not null check (char_length(operation_id) between 8 and 160),
  command_type text not null check (command_type in (
    'start_attempt', 'accept_verified_hand', 'record_verified_game', 'finalize_verified_attempt'
  )),
  request_digest text not null check (request_digest ~ '^[0-9a-f]{64}$'),
  expected_revision bigint not null check (expected_revision >= 0),
  committed_revision bigint null check (committed_revision >= 0),
  status text not null check (status in ('committed', 'rejected')),
  response jsonb null,
  error_code text null,
  created_at timestamptz not null default now(),
  committed_at timestamptz null,
  unique (attempt_id, operation_id),
  unique (user_id, challenge_id, operation_id),
  check (
    (status = 'committed' and committed_revision is not null and response is not null and error_code is null)
    or (status = 'rejected' and error_code is not null)
  )
);

create table if not exists public.fritz_challenge_verified_hands (
  attempt_id uuid not null references public.fritz_challenge_attempts(id) on delete cascade,
  game_number int not null check (game_number between 1 and 3),
  hand_index int not null check (hand_index >= 0),
  operation_id text not null,
  transcript_digest text not null check (transcript_digest ~ '^[0-9a-f]{64}$'),
  action_count int not null check (action_count > 0),
  player_score_after int not null check (player_score_after >= 0),
  fritz_score_after int not null check (fritz_score_after >= 0),
  winner text null check (winner is null or winner in ('player', 'fritz')),
  verifier_version int not null,
  receipt jsonb not null,
  created_at timestamptz not null default now(),
  primary key (attempt_id, game_number, hand_index),
  unique (attempt_id, operation_id)
);

create table if not exists public.fritz_challenge_verified_games (
  attempt_id uuid not null references public.fritz_challenge_attempts(id) on delete cascade,
  game_number int not null check (game_number between 1 and 3),
  operation_id text not null,
  player_score int not null check (player_score >= 0),
  fritz_score int not null check (fritz_score >= 0),
  point_diff int not null,
  player_won boolean not null,
  action_count int not null check (action_count > 0),
  hands_played int not null check (hands_played > 0),
  result_digest text not null check (result_digest ~ '^[0-9a-f]{64}$'),
  receipt jsonb not null,
  created_at timestamptz not null default now(),
  primary key (attempt_id, game_number),
  unique (attempt_id, operation_id)
);

create table if not exists public.fritz_challenge_outbox (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.fritz_challenge_attempts(id) on delete cascade,
  challenge_id uuid not null references public.fritz_challenges(id) on delete cascade,
  operation_id text not null,
  event_type text not null,
  payload jsonb not null,
  occurred_at timestamptz not null default now(),
  available_at timestamptz not null default now(),
  delivered_at timestamptz null,
  delivery_attempts int not null default 0 check (delivery_attempts >= 0),
  last_error text null,
  unique (attempt_id, operation_id, event_type)
);

create index if not exists idx_fritz_challenge_outbox_pending
  on public.fritz_challenge_outbox (available_at, occurred_at)
  where delivered_at is null;

alter table public.fritz_challenge_attempt_operations enable row level security;
alter table public.fritz_challenge_verified_hands enable row level security;
alter table public.fritz_challenge_verified_games enable row level security;
alter table public.fritz_challenge_outbox enable row level security;

create policy "fritz_challenge_attempt_operations_no_client_access"
  on public.fritz_challenge_attempt_operations for all to authenticated using (false) with check (false);
create policy "fritz_challenge_verified_hands_no_client_access"
  on public.fritz_challenge_verified_hands for all to authenticated using (false) with check (false);
create policy "fritz_challenge_verified_games_no_client_access"
  on public.fritz_challenge_verified_games for all to authenticated using (false) with check (false);
create policy "fritz_challenge_outbox_no_client_access"
  on public.fritz_challenge_outbox for all to authenticated using (false) with check (false);

create or replace function public.commit_fritz_challenge_attempt_command(
  p_user_id uuid, p_attempt_id uuid, p_operation_id text, p_command_type text,
  p_request_digest text, p_expected_revision bigint, p_new_status text,
  p_new_current_game_number int, p_new_current_hand_index int, p_new_result jsonb,
  p_final_score int default null, p_opponent_score int default null, p_point_diff int default null,
  p_won boolean default null, p_moves_used int default null, p_hands_played int default null,
  p_hand_receipt jsonb default null, p_game_receipt jsonb default null,
  p_outbox_event_type text default null, p_outbox_payload jsonb default '{}'::jsonb
)
returns table (outcome text, error_code text, replayed boolean, committed_revision bigint, response jsonb)
language plpgsql security definer set search_path = public as $$
declare
  attempt public.fritz_challenge_attempts%rowtype;
  existing_operation public.fritz_challenge_attempt_operations%rowtype;
  next_revision bigint;
  command_response jsonb;
begin
  if p_command_type not in ('accept_verified_hand', 'record_verified_game', 'finalize_verified_attempt') then
    return query select 'rejected', 'unsupported_command', false, null::bigint, null::jsonb; return;
  end if;
  select * into attempt from public.fritz_challenge_attempts
    where id = p_attempt_id and user_id = p_user_id for update;
  if not found then
    return query select 'rejected', 'attempt_not_found', false, null::bigint, null::jsonb; return;
  end if;
  select * into existing_operation from public.fritz_challenge_attempt_operations
    where attempt_id = p_attempt_id and operation_id = p_operation_id;
  if found then
    if existing_operation.command_type <> p_command_type or existing_operation.request_digest <> p_request_digest then
      return query select 'conflict', 'command_slot_conflict', false, existing_operation.committed_revision, existing_operation.response; return;
    end if;
    return query select existing_operation.status, existing_operation.error_code, true, existing_operation.committed_revision, existing_operation.response; return;
  end if;
  if attempt.status <> 'started' then
    return query select 'rejected', 'attempt_inactive', false, attempt.revision, null::jsonb; return;
  end if;
  if attempt.revision <> p_expected_revision then
    return query select 'conflict', 'stale_revision', false, attempt.revision,
      jsonb_build_object('attempt_id', attempt.id, 'revision', attempt.revision, 'status', attempt.status); return;
  end if;
  if p_new_status not in ('started', 'completed') or p_new_current_game_number not between 1 and 3 or p_new_current_hand_index < 0 then
    return query select 'rejected', 'invalid_transition', false, attempt.revision, null::jsonb; return;
  end if;
  if p_command_type = 'accept_verified_hand' and p_hand_receipt is null then
    return query select 'rejected', 'hand_receipt_required', false, attempt.revision, null::jsonb; return;
  end if;
  if p_command_type = 'record_verified_game' and p_game_receipt is null then
    return query select 'rejected', 'game_receipt_required', false, attempt.revision, null::jsonb; return;
  end if;
  next_revision := attempt.revision + 1;
  update public.fritz_challenge_attempts set
    status = p_new_status, current_game_number = p_new_current_game_number,
    current_hand_index = p_new_current_hand_index, result = p_new_result,
    final_score = coalesce(p_final_score, final_score), opponent_score = coalesce(p_opponent_score, opponent_score),
    point_diff = coalesce(p_point_diff, point_diff), won = coalesce(p_won, won),
    moves_used = coalesce(p_moves_used, moves_used), hands_played = coalesce(p_hands_played, hands_played),
    revision = next_revision, completed_at = case when p_new_status = 'completed' then coalesce(completed_at, now()) else completed_at end,
    updated_at = now()
    where id = attempt.id returning * into attempt;
  if p_hand_receipt is not null then
    insert into public.fritz_challenge_verified_hands (attempt_id, game_number, hand_index, operation_id, transcript_digest, action_count, player_score_after, fritz_score_after, winner, verifier_version, receipt)
    values (attempt.id, (p_hand_receipt->>'gameNumber')::int, (p_hand_receipt->>'handIndex')::int, p_operation_id, p_hand_receipt->>'transcriptDigest', (p_hand_receipt->>'actionCount')::int, (p_hand_receipt->>'playerScoreAfter')::int, (p_hand_receipt->>'fritzScoreAfter')::int, p_hand_receipt->>'winner', coalesce((p_hand_receipt->>'verificationVersion')::int, 1), p_hand_receipt);
  end if;
  if p_game_receipt is not null then
    insert into public.fritz_challenge_verified_games (attempt_id, game_number, operation_id, player_score, fritz_score, point_diff, player_won, action_count, hands_played, result_digest, receipt)
    values (attempt.id, (p_game_receipt->>'gameNumber')::int, p_operation_id, (p_game_receipt->>'playerScore')::int, (p_game_receipt->>'fritzScore')::int, (p_game_receipt->>'pointDiff')::int, (p_game_receipt->>'playerWon')::boolean, (p_game_receipt->>'actionCount')::int, (p_game_receipt->>'handsPlayed')::int, p_game_receipt->>'resultDigest', p_game_receipt);
  end if;
  command_response := jsonb_build_object('attempt_id', attempt.id, 'revision', attempt.revision, 'status', attempt.status, 'current_game_number', attempt.current_game_number, 'current_hand_index', attempt.current_hand_index, 'result', attempt.result);
  insert into public.fritz_challenge_attempt_operations (attempt_id, user_id, challenge_id, operation_id, command_type, request_digest, expected_revision, committed_revision, status, response, committed_at)
    values (attempt.id, p_user_id, attempt.challenge_id, p_operation_id, p_command_type, p_request_digest, p_expected_revision, attempt.revision, 'committed', command_response, now());
  insert into public.fritz_challenge_outbox (attempt_id, challenge_id, operation_id, event_type, payload)
    values (attempt.id, attempt.challenge_id, p_operation_id, coalesce(p_outbox_event_type, p_command_type), p_outbox_payload)
    on conflict (attempt_id, operation_id, event_type) do nothing;
  return query select 'committed', null::text, false, attempt.revision, command_response;
end;
$$;

revoke all on function public.commit_fritz_challenge_attempt_command(uuid, uuid, text, text, text, bigint, text, int, int, jsonb, int, int, int, boolean, int, int, jsonb, jsonb, text, jsonb) from public, authenticated;
grant execute on function public.commit_fritz_challenge_attempt_command(uuid, uuid, text, text, text, bigint, text, int, int, jsonb, int, int, int, boolean, int, int, jsonb, jsonb, text, jsonb) to service_role;

-- Starting an attempt is also a command.  There is no attempt row to lock on
-- the first request, so serialize the participant/challenge pair explicitly.
-- This prevents two tabs or two server instances from creating divergent
-- starts before the per-attempt revision lock exists.
create or replace function public.start_fritz_challenge_attempt_command(
  p_user_id uuid, p_challenge_id uuid, p_operation_id text,
  p_request_digest text, p_authority_result jsonb
)
returns table (outcome text, error_code text, replayed boolean, committed_revision bigint, response jsonb)
language plpgsql security definer set search_path = public as $$
declare
  challenge public.fritz_challenges%rowtype;
  attempt public.fritz_challenge_attempts%rowtype;
  existing_operation public.fritz_challenge_attempt_operations%rowtype;
  created_attempt boolean := false;
  command_response jsonb;
begin
  if char_length(p_operation_id) < 8 or char_length(p_operation_id) > 160
    or p_request_digest !~ '^[0-9a-f]{64}$' then
    return query select 'rejected', 'invalid_start_command', false, null::bigint, null::jsonb; return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_challenge_id::text, 0));

  select * into existing_operation
    from public.fritz_challenge_attempt_operations
    where user_id = p_user_id and challenge_id = p_challenge_id and operation_id = p_operation_id;
  if found then
    if existing_operation.command_type <> 'start_attempt'
      or existing_operation.request_digest <> p_request_digest then
      return query select 'conflict', 'operation_id_reused', false,
        existing_operation.committed_revision, existing_operation.response; return;
    end if;
    return query select existing_operation.status, existing_operation.error_code, true,
      existing_operation.committed_revision, existing_operation.response; return;
  end if;

  select * into challenge from public.fritz_challenges where id = p_challenge_id for update;
  if not found then
    return query select 'rejected', 'challenge_not_found', false, null::bigint, null::jsonb; return;
  end if;
  if challenge.expires_at <= now() then
    update public.fritz_challenges set status = 'expired'
      where id = challenge.id and status in ('open', 'active');
    return query select 'rejected', 'challenge_expired', false, null::bigint, null::jsonb; return;
  end if;
  if p_user_id <> challenge.creator_user_id
    and p_user_id is distinct from challenge.opponent_user_id then
    return query select 'rejected', 'not_participant', false, null::bigint, null::jsonb; return;
  end if;

  select * into attempt from public.fritz_challenge_attempts
    where challenge_id = p_challenge_id and user_id = p_user_id for update;
  if not found then
    insert into public.fritz_challenge_attempts (
      challenge_id, user_id, status, current_game_number, current_hand_index,
      revision, authority_schema_version, result
    ) values (
      p_challenge_id, p_user_id, 'started', 1, 0, 1, 1, p_authority_result
    ) returning * into attempt;
    created_attempt := true;
  elsif attempt.status <> 'started' then
    return query select 'rejected', 'attempt_not_startable', false, attempt.revision,
      jsonb_build_object('attempt_id', attempt.id, 'status', attempt.status, 'revision', attempt.revision); return;
  end if;

  command_response := jsonb_build_object(
    'attempt_id', attempt.id, 'challenge_id', attempt.challenge_id,
    'status', attempt.status, 'revision', attempt.revision,
    'current_game_number', attempt.current_game_number,
    'current_hand_index', attempt.current_hand_index,
    'created', created_attempt
  );
  insert into public.fritz_challenge_attempt_operations (
    attempt_id, user_id, challenge_id, operation_id, command_type, request_digest,
    expected_revision, committed_revision, status, response, committed_at
  ) values (
    attempt.id, p_user_id, p_challenge_id, p_operation_id, 'start_attempt', p_request_digest,
    0, attempt.revision, 'committed', command_response, now()
  );
  insert into public.fritz_challenge_outbox (attempt_id, challenge_id, operation_id, event_type, payload)
    values (
      attempt.id, p_challenge_id, p_operation_id,
      case when created_attempt then 'attempt_started' else 'attempt_resumed' end,
      jsonb_build_object('revision', attempt.revision, 'created', created_attempt)
    ) on conflict (attempt_id, operation_id, event_type) do nothing;
  return query select 'committed', null::text, false, attempt.revision, command_response;
end;
$$;

revoke all on function public.start_fritz_challenge_attempt_command(uuid, uuid, text, text, jsonb) from public, authenticated;
grant execute on function public.start_fritz_challenge_attempt_command(uuid, uuid, text, text, jsonb) to service_role;
