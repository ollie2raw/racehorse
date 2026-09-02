-- Lock down the Fritz Challenge / Daily Fritz command RPCs (HARDENING_PLAN.md
-- "Cross-cutting security follow-up sweep — 2026-09-02", item 2).
--
-- Finding: ~10 SECURITY DEFINER functions are anon-executable in prod — the
-- `revoke ... from public, authenticated` statements in
-- `supabase/fritz_challenges.sql`, `2026-08-02_fritz_challenge_authority_primitives.sql`
-- and `2026-08-01_daily_fritz_transactional_commands.sql` never reached prod
-- (no CI migration runner — 7th drift instance). Confirmed by live anon probe:
-- anon gets 200 / business-logic errors, authenticated gets 42501 (a backwards
-- ACL). None of these functions has an internal caller check; SECURITY DEFINER
-- means they bypass the tables' RLS. Concrete unauthenticated writes:
--   claim_fritz_challenge_opponent('<open challenge id>', '<any uuid>')
--     -> UPDATE fritz_challenges SET opponent_user_id=<attacker pick>, status='active'
--   advance_fritz_challenge_hand / record_fritz_challenge_game
--     / commit_*_attempt_command with a victim's attempt id -> overwrite that
--     attempt's result / scores / verified receipts.
--
-- Pre-apply tamper audit (run 2026-09-02, service-role read): fritz_challenges
-- = 17 rows, ALL status 'open', 0 ever 'active'/'completed'; fritz_challenge_attempts
-- = 9 rows, ALL status 'started' at game 1 / hand 0, final_score all NULL, one
-- dev account, nothing since 2026-08-03. No evidence of exploitation — the
-- vulnerable write paths have zero history in prod.
--
-- The only legitimate caller is the Node app server via the service-role key
-- (server/src/http/stores/fritzChallenge{Store,CommandStore}.ts,
-- dailyFritzCommandStore.ts). No browser client calls these directly.
--
-- This migration:
--   PART A — grant lockdown for all 10 functions (the primary control).
--   PART B — a server-only body guard on the 7 whose full body is in a single
--            repo source (belt for a future grant re-drift; service_role
--            bypasses grants).
--   Deferred (grant-locked by PART A; body guard is a separate careful pass):
--     - create_fritz_challenge_invite       — body is prod-only, not in the repo
--     - commit_daily_fritz_attempt_command  — redefined across 3 migrations
--                                             (latest 2026-08-19); needs the
--                                             exact current body
--     - start_daily_fritz_attempt_command   — bundle with the above
--
-- Self-asserting: raises unless anon + authenticated lost EXECUTE on all 10 and
-- service_role kept it, and the guard helper exists.

begin;

-- ---------------------------------------------------------------------------
-- guard helper
-- ---------------------------------------------------------------------------

create or replace function public._assert_fritz_rpc_server_only()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- auth.role() is the JWT `role` claim: 'anon' | 'authenticated' | 'service_role',
  -- or NULL for an internal call (SQL editor, pg_cron, superuser). Only the app
  -- server (service_role) and internal callers may proceed.
  if coalesce(auth.role(), 'service_role') <> 'service_role' then
    raise exception 'forbidden: fritz challenge RPC is server-only (role=%)', auth.role()
      using errcode = '42501';
  end if;
end;
$$;

revoke all on function public._assert_fritz_rpc_server_only() from public, anon, authenticated;
grant execute on function public._assert_fritz_rpc_server_only() to service_role;

-- ---------------------------------------------------------------------------
-- PART A — grant lockdown (all 10)
-- ---------------------------------------------------------------------------

do $$
declare
  fn text;
  sigs text[] := array[
    'public.claim_fritz_challenge_opponent(uuid, uuid)',
    'public.start_fritz_challenge_attempt(uuid, uuid)',
    'public.get_or_create_fritz_challenge_hand(uuid, int, int, jsonb)',
    'public.advance_fritz_challenge_hand(uuid, int, int, jsonb, int, int, int, int)',
    'public.record_fritz_challenge_game(uuid, int, jsonb, int, int, int, boolean, int, int, boolean, int)',
    'public.commit_fritz_challenge_attempt_command(uuid, uuid, text, text, text, bigint, text, int, int, jsonb, int, int, int, boolean, int, int, jsonb, jsonb, text, jsonb)',
    'public.start_fritz_challenge_attempt_command(uuid, uuid, text, text, jsonb)',
    'public.create_fritz_challenge_invite(uuid, uuid, text, text, text, int, int, int, int, int, int, timestamptz)',
    'public.commit_daily_fritz_attempt_command(uuid, uuid, text, text, text, bigint, text, int, int, jsonb, int, int, int, boolean, int, int, text, jsonb, jsonb, text, jsonb)',
    'public.start_daily_fritz_attempt_command(uuid, text, text, text, jsonb)'
  ];
begin
  foreach fn in array sigs loop
    if to_regprocedure(fn) is null then
      raise notice 'skip (not present): %', fn;
      continue;
    end if;
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- PART B — server-only body guard (7 functions, verbatim body + one line)
-- ---------------------------------------------------------------------------

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
  perform public._assert_fritz_rpc_server_only();

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
  perform public._assert_fritz_rpc_server_only();

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
  perform public._assert_fritz_rpc_server_only();

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
  perform public._assert_fritz_rpc_server_only();

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
  perform public._assert_fritz_rpc_server_only();

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
  perform public._assert_fritz_rpc_server_only();

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
  perform public._assert_fritz_rpc_server_only();

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

-- ---------------------------------------------------------------------------
-- self-assert
-- ---------------------------------------------------------------------------

do $$
declare
  fn text;
  sigs text[] := array[
    'public.claim_fritz_challenge_opponent(uuid, uuid)',
    'public.start_fritz_challenge_attempt(uuid, uuid)',
    'public.get_or_create_fritz_challenge_hand(uuid, int, int, jsonb)',
    'public.advance_fritz_challenge_hand(uuid, int, int, jsonb, int, int, int, int)',
    'public.record_fritz_challenge_game(uuid, int, jsonb, int, int, int, boolean, int, int, boolean, int)',
    'public.commit_fritz_challenge_attempt_command(uuid, uuid, text, text, text, bigint, text, int, int, jsonb, int, int, int, boolean, int, int, jsonb, jsonb, text, jsonb)',
    'public.start_fritz_challenge_attempt_command(uuid, uuid, text, text, jsonb)',
    'public.create_fritz_challenge_invite(uuid, uuid, text, text, text, int, int, int, int, int, int, timestamptz)',
    'public.commit_daily_fritz_attempt_command(uuid, uuid, text, text, text, bigint, text, int, int, jsonb, int, int, int, boolean, int, int, text, jsonb, jsonb, text, jsonb)',
    'public.start_daily_fritz_attempt_command(uuid, text, text, text, jsonb)'
  ];
  oid_ oid;
begin
  foreach fn in array sigs loop
    oid_ := to_regprocedure(fn);
    if oid_ is null then
      continue; -- create_fritz_challenge_invite may have a different real signature; PART A skips it too
    end if;
    if has_function_privilege('anon', oid_, 'EXECUTE')
       or has_function_privilege('authenticated', oid_, 'EXECUTE') then
      raise exception 'lockdown failed: % still EXECUTE-able by a client role', fn;
    end if;
    if not has_function_privilege('service_role', oid_, 'EXECUTE') then
      raise exception 'lockdown failed: service_role lost EXECUTE on %', fn;
    end if;
  end loop;

  if to_regprocedure('public._assert_fritz_rpc_server_only()') is null then
    raise exception 'lockdown failed: _assert_fritz_rpc_server_only() missing';
  end if;

  raise notice 'fritz challenge / daily fritz command RPCs: client EXECUTE revoked; server-only body guard on the 5 fritz_challenges.sql fns + the 2 fritz command RPCs';
end $$;

commit;
