-- Fix: allow Game 1 instant-skunk sets to finalize under transactional authority.
-- Regression: finalize_verified_attempt required 2–3 games, so G1 skunk (1 game,
-- mechanical 2–0 / 0–2) failed with daily_fritz_invalid_finalize_transition and
-- never reached the leaderboard despite record-game + activity succeeding.

create or replace function public.commit_daily_fritz_attempt_command(
  p_user_id uuid,
  p_attempt_id uuid,
  p_operation_id text,
  p_command_type text,
  p_request_digest text,
  p_expected_revision bigint,
  p_new_status text,
  p_new_current_game_number int,
  p_new_current_hand_index int,
  p_new_result jsonb,
  p_final_score int default null,
  p_opponent_score int default null,
  p_point_diff int default null,
  p_won boolean default null,
  p_moves_used int default null,
  p_hands_played int default null,
  p_completion_hash text default null,
  p_hand_receipt jsonb default null,
  p_game_receipt jsonb default null,
  p_outbox_event_type text default null,
  p_outbox_payload jsonb default '{}'::jsonb
)
returns table (
  outcome text,
  error_code text,
  replayed boolean,
  committed_revision bigint,
  response jsonb
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  attempt public.daily_fritz_attempts%rowtype;
  existing_operation public.daily_fritz_attempt_operations%rowtype;
  command_response jsonb;
  receipt_game int;
  receipt_hand int;
begin
  if p_command_type not in (
    'accept_verified_hand', 'record_verified_game',
    'finalize_verified_attempt', 'abandon_attempt'
  ) then
    return query select 'rejected', 'unsupported_command', false, null::bigint, null::jsonb;
    return;
  end if;

  select * into attempt
    from public.daily_fritz_attempts
    where id = p_attempt_id and user_id = p_user_id
    for update;
  if not found then
    return query select 'rejected', 'attempt_not_found', false, null::bigint, null::jsonb;
    return;
  end if;
  -- Receipt lookup must occur after the attempt lock. Otherwise two server
  -- instances can both observe "no receipt" before either commits.
  select * into existing_operation
    from public.daily_fritz_attempt_operations
    where attempt_id = p_attempt_id and operation_id = p_operation_id;
  if found then
    if existing_operation.command_type <> p_command_type
      or existing_operation.request_digest <> p_request_digest then
      return query select 'conflict', 'command_slot_conflict', false,
        existing_operation.committed_revision, existing_operation.response;
      return;
    end if;
    return query select existing_operation.status, existing_operation.error_code, true,
      existing_operation.committed_revision, existing_operation.response;
    return;
  end if;
  if attempt.challenge_id is null then
    return query select 'rejected', 'legacy_attempt_read_only', false,
      attempt.revision, jsonb_build_object('attempt_id', attempt.id, 'revision', attempt.revision);
    return;
  end if;
  if attempt.revision <> p_expected_revision then
    command_response := jsonb_build_object(
      'attempt_id', attempt.id, 'status', attempt.status, 'revision', attempt.revision,
      'current_game_number', attempt.current_game_number,
      'current_hand_index', attempt.current_hand_index, 'result', attempt.result
    );
    insert into public.daily_fritz_attempt_operations (
      operation_id, attempt_id, user_id, challenge_id, command_type,
      request_digest, expected_revision, status, response, error_code
    ) values (
      p_operation_id, attempt.id, p_user_id, attempt.challenge_id, p_command_type,
      p_request_digest, p_expected_revision, 'rejected', command_response, 'stale_revision'
    );
    return query select 'rejected', 'stale_revision', false, attempt.revision, command_response;
    return;
  end if;
  if attempt.status <> 'started' then
    return query select 'rejected', 'attempt_not_active', false, attempt.revision,
      jsonb_build_object('attempt_id', attempt.id, 'status', attempt.status, 'revision', attempt.revision);
    return;
  end if;

  if p_command_type = 'accept_verified_hand' then
    if p_hand_receipt is null then raise exception 'daily_fritz_hand_receipt_required'; end if;
    receipt_game := (p_hand_receipt->>'gameNumber')::int;
    receipt_hand := (p_hand_receipt->>'handIndex')::int;
    if receipt_game <> attempt.current_game_number
      or receipt_hand <> attempt.current_hand_index
      or p_new_status <> 'started'
      or p_new_current_game_number <> attempt.current_game_number
      or p_new_current_hand_index <> attempt.current_hand_index + 1 then
      raise exception 'daily_fritz_invalid_hand_transition';
    end if;
    insert into public.daily_fritz_verified_hands (
      attempt_id, game_number, hand_index, operation_id, transcript_digest,
      action_count, player_score_after, fritz_score_after, winner,
      verifier_version, receipt
    ) values (
      attempt.id, receipt_game, receipt_hand, p_operation_id,
      p_hand_receipt->>'transcriptDigest', (p_hand_receipt->>'actionCount')::int,
      (p_hand_receipt->>'playerScoreAfter')::int, (p_hand_receipt->>'fritzScoreAfter')::int,
      p_hand_receipt->>'winner', (p_hand_receipt->>'verificationVersion')::int,
      p_hand_receipt
    );
  elsif p_command_type = 'record_verified_game' then
    if p_game_receipt is null then raise exception 'daily_fritz_game_receipt_required'; end if;
    if p_hand_receipt is null then raise exception 'daily_fritz_terminal_hand_receipt_required'; end if;
    receipt_game := (p_game_receipt->>'gameNumber')::int;
    receipt_hand := (p_hand_receipt->>'handIndex')::int;
    if receipt_game <> attempt.current_game_number
      or (p_hand_receipt->>'gameNumber')::int <> receipt_game
      or receipt_hand <> attempt.current_hand_index
      or p_new_status <> 'started'
      or jsonb_typeof(p_new_result->'games') <> 'array'
      or jsonb_array_length(p_new_result->'games') <> receipt_game
      or (
        p_new_result ? 'setWinner'
        and (
          p_new_current_game_number <> attempt.current_game_number
          or p_new_current_hand_index <> attempt.current_hand_index
        )
      )
      or (
        not (p_new_result ? 'setWinner')
        and (
          attempt.current_game_number = 3
          or p_new_current_game_number <> attempt.current_game_number + 1
          or p_new_current_hand_index <> 0
        )
      ) then
      raise exception 'daily_fritz_invalid_game_transition';
    end if;
    insert into public.daily_fritz_verified_hands (
      attempt_id, game_number, hand_index, operation_id, transcript_digest,
      action_count, player_score_after, fritz_score_after, winner,
      verifier_version, receipt
    ) values (
      attempt.id, receipt_game, receipt_hand, p_operation_id,
      p_hand_receipt->>'transcriptDigest', (p_hand_receipt->>'actionCount')::int,
      (p_hand_receipt->>'playerScoreAfter')::int, (p_hand_receipt->>'fritzScoreAfter')::int,
      p_hand_receipt->>'winner', (p_hand_receipt->>'verificationVersion')::int,
      p_hand_receipt
    );
    insert into public.daily_fritz_verified_games (
      attempt_id, game_number, operation_id, player_score, fritz_score,
      point_diff, player_won, action_count, hands_played, result_digest, receipt
    ) values (
      attempt.id, receipt_game, p_operation_id,
      (p_game_receipt->>'playerScore')::int, (p_game_receipt->>'fritzScore')::int,
      (p_game_receipt->>'pointDiff')::int, (p_game_receipt->>'playerWon')::boolean,
      (p_game_receipt->>'actionCount')::int, (p_game_receipt->>'handsPlayed')::int,
      p_game_receipt->>'resultDigest', p_game_receipt
    );
  elsif p_command_type = 'finalize_verified_attempt' then
    -- Normal BO3 finishes with 2–3 games. Game-1 instant skunk ends the set with
    -- exactly one verified game (mechanical 2–0 / 0–2) and must also finalize.
    if p_new_status <> 'completed'
      or coalesce(p_new_result->>'verification_status', '') <> 'verified'
      or not (p_new_result ? 'setWinner')
      or jsonb_typeof(p_new_result->'games') <> 'array'
      or not (
        (
          jsonb_array_length(p_new_result->'games') in (2, 3)
          and (select count(*) from public.daily_fritz_verified_games where attempt_id = attempt.id) >= 2
        )
        or (
          coalesce((p_new_result->>'instantSkunk')::boolean, false)
          and coalesce((p_new_result->>'skunkGameNumber')::int, 0) = 1
          and jsonb_array_length(p_new_result->'games') = 1
          and (select count(*) from public.daily_fritz_verified_games where attempt_id = attempt.id) >= 1
        )
      ) then
      raise exception 'daily_fritz_invalid_finalize_transition';
    end if;
  elsif p_command_type = 'abandon_attempt' and p_new_status <> 'abandoned' then
    raise exception 'daily_fritz_invalid_abandon_transition';
  end if;

  update public.daily_fritz_attempts set
    status = p_new_status,
    current_game_number = p_new_current_game_number,
    current_hand_index = p_new_current_hand_index,
    result = p_new_result,
    final_score = p_final_score,
    opponent_score = p_opponent_score,
    point_diff = p_point_diff,
    won = p_won,
    moves_used = p_moves_used,
    hands_played = p_hands_played,
    completion_hash = p_completion_hash,
    completed_at = case when p_new_status in ('completed', 'abandoned') then now() else completed_at end,
    revision = revision + 1
  where id = attempt.id and revision = p_expected_revision
  returning * into attempt;

  if not found then raise exception 'daily_fritz_revision_changed_during_commit'; end if;

  if p_command_type in ('finalize_verified_attempt', 'abandon_attempt')
    and attempt.verified_match_id is not null then
    update public.verified_single_player_matches set
      status = attempt.status,
      completed_at = attempt.completed_at,
      completion_hash = attempt.completion_hash,
      completion_result = attempt.result
    where match_id = attempt.verified_match_id and user_id = p_user_id;
    if not found then raise exception 'daily_fritz_verified_match_missing'; end if;
  end if;

  command_response := jsonb_build_object(
    'attempt_id', attempt.id, 'verified_match_id', attempt.verified_match_id,
    'challenge_id', attempt.challenge_id, 'run_date', attempt.run_date,
    'status', attempt.status, 'revision', attempt.revision,
    'current_game_number', attempt.current_game_number,
    'current_hand_index', attempt.current_hand_index, 'result', attempt.result,
    'final_score', attempt.final_score, 'opponent_score', attempt.opponent_score,
    'point_diff', attempt.point_diff, 'won', attempt.won,
    'moves_used', attempt.moves_used, 'hands_played', attempt.hands_played,
    'completion_hash', attempt.completion_hash, 'completed_at', attempt.completed_at
  );

  insert into public.daily_fritz_attempt_operations (
    operation_id, attempt_id, user_id, challenge_id, command_type,
    request_digest, expected_revision, committed_revision, status,
    response, committed_at
  ) values (
    p_operation_id, attempt.id, p_user_id, attempt.challenge_id, p_command_type,
    p_request_digest, p_expected_revision, attempt.revision, 'committed',
    command_response, now()
  );

  if p_outbox_event_type is not null then
    insert into public.daily_fritz_outbox (
      attempt_id, challenge_id, operation_id, event_type, payload
    ) values (
      attempt.id, attempt.challenge_id, p_operation_id, p_outbox_event_type,
      p_outbox_payload || jsonb_build_object('revision', attempt.revision)
    ) on conflict (attempt_id, operation_id, event_type) do nothing;
  end if;

  return query select 'committed', null::text, false, attempt.revision, command_response;
end;
$$;

revoke all on function public.commit_daily_fritz_attempt_command(
  uuid, uuid, text, text, text, bigint, text, int, int, jsonb,
  int, int, int, boolean, int, int, text, jsonb, jsonb, text, jsonb
) from public;
revoke all on function public.commit_daily_fritz_attempt_command(
  uuid, uuid, text, text, text, bigint, text, int, int, jsonb,
  int, int, int, boolean, int, int, text, jsonb, jsonb, text, jsonb
) from authenticated;
grant execute on function public.commit_daily_fritz_attempt_command(
  uuid, uuid, text, text, text, bigint, text, int, int, jsonb,
  int, int, int, boolean, int, int, text, jsonb, jsonb, text, jsonb
) to service_role;
