do $$
declare
  missing text[] := array[]::text[];
  object_name text;
begin
  foreach object_name in array array[
    'daily_puzzles',
    'daily_puzzle_attempts',
    'daily_puzzle_slot_results',
    'daily_puzzle_events',
    'daily_fritz_attempts',
    'daily_fritz_published_challenges',
    'daily_fritz_attempt_operations',
    'daily_fritz_verified_hands',
    'daily_fritz_verified_games',
    'daily_fritz_outbox',
    'fritz_challenges',
    'fritz_challenge_attempts',
    'fritz_challenge_attempt_operations',
    'fritz_challenge_verified_hands',
    'fritz_challenge_verified_games',
    'fritz_challenge_outbox',
    'room_live_sessions',
    'room_live_session_command_receipts',
    'multiplayer_invites',
    'multiplayer_operational_events',
    'daily_puzzle_event_funnel',
    'daily_puzzle_failure_metrics',
    'multiplayer_operational_metrics',
    'room_match_logs',
    'verified_single_player_matches'
  ] loop
    if to_regclass('public.' || object_name) is null then
      missing := array_append(missing, object_name);
    end if;
  end loop;

  if cardinality(missing) > 0 then
    raise exception 'application_schema_missing_relations:%', array_to_string(missing, ',');
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'daily_puzzle_attempts_puzzles_completed_check'
      and pg_get_constraintdef(oid) ~ 'puzzles_completed.*5'
  ) then
    raise exception 'daily_puzzle_five_slot_completion_constraint_missing';
  end if;

  foreach object_name in array array[
    'start_daily_fritz_attempt_command',
    'commit_daily_fritz_attempt_command',
    'start_fritz_challenge_attempt_command',
    'commit_fritz_challenge_attempt_command',
    'assert_room_live_session_revision',
    'commit_room_live_session_snapshot',
    'commit_room_live_session_command',
    'create_multiplayer_invite',
    'resolve_multiplayer_invite'
  ] loop
    if not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = object_name
    ) then
      missing := array_append(missing, object_name || '()');
    end if;
  end loop;

  if cardinality(missing) > 0 then
    raise exception 'application_schema_missing_objects:%', array_to_string(missing, ',');
  end if;
end $$;

select 'application schema verified' as result;
