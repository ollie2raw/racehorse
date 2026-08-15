-- Durable authority primitive for live multiplayer rooms.
--
-- A process may render/validate a command, but it may only publish a snapshot
-- when the revision it read is still current. This prevents a second instance
-- or a restarted worker from silently overwriting newer room state.

alter table public.room_live_sessions
  add column if not exists authority_revision bigint not null default 0
    check (authority_revision >= 0);

create table if not exists public.room_live_session_command_receipts (
  room_code text not null references public.room_live_sessions(room_code) on delete cascade,
  actor_seat_id text not null,
  request_id text not null check (char_length(request_id) between 1 and 128),
  request_digest text not null check (request_digest ~ '^[0-9a-f]{64}$'),
  expected_revision bigint not null check (expected_revision >= 0),
  committed_revision bigint null check (committed_revision >= 0),
  outcome text not null check (outcome in ('committed', 'rejected')),
  error_code text null,
  response jsonb null,
  created_at timestamptz not null default now(),
  committed_at timestamptz null,
  primary key (room_code, actor_seat_id, request_id),
  check (
    (outcome = 'committed' and committed_revision is not null and response is not null and error_code is null)
    or (outcome = 'rejected' and error_code is not null)
  )
);

-- Re-running this migration upgrades databases that received an earlier draft
-- whose request-id constraint required at least eight characters.
alter table public.room_live_session_command_receipts
  drop constraint if exists room_live_session_command_receipts_request_id_check;
alter table public.room_live_session_command_receipts
  add constraint room_live_session_command_receipts_request_id_check
  check (char_length(request_id) between 1 and 128);

create index if not exists idx_room_live_session_command_receipts_created
  on public.room_live_session_command_receipts (created_at desc);

alter table public.room_live_session_command_receipts enable row level security;
drop policy if exists "room_live_session_command_receipts_no_client_access" on public.room_live_session_command_receipts;
create policy "room_live_session_command_receipts_no_client_access"
  on public.room_live_session_command_receipts for all to authenticated using (false) with check (false);

-- Locking this row is intentionally the serialization boundary. The server
-- must invoke this in the same command path as its durable snapshot write.
create or replace function public.assert_room_live_session_revision(
  p_room_code text,
  p_expected_revision bigint,
  p_actor_seat_id text,
  p_request_id text,
  p_request_digest text
)
returns table (outcome text, error_code text, replayed boolean, authority_revision bigint, response jsonb)
language plpgsql security definer set search_path = public as $$
declare
  live_room public.room_live_sessions%rowtype;
  receipt public.room_live_session_command_receipts%rowtype;
begin
  select * into live_room from public.room_live_sessions where room_code = upper(trim(p_room_code)) for update;
  if not found then
    return query select 'rejected', 'room_not_persisted', false, null::bigint, null::jsonb; return;
  end if;

  select * into receipt from public.room_live_session_command_receipts
    where room_code = live_room.room_code and actor_seat_id = p_actor_seat_id and request_id = p_request_id;
  if found then
    if receipt.request_digest <> p_request_digest then
      return query select 'rejected', 'request_id_conflict', false, receipt.committed_revision, receipt.response; return;
    end if;
    return query select receipt.outcome, receipt.error_code, true, receipt.committed_revision, receipt.response; return;
  end if;

  if live_room.authority_revision <> p_expected_revision then
    insert into public.room_live_session_command_receipts (
      room_code, actor_seat_id, request_id, request_digest, expected_revision, outcome, error_code, response
    ) values (
      live_room.room_code, p_actor_seat_id, p_request_id, p_request_digest, p_expected_revision,
      'rejected', 'stale_revision', jsonb_build_object('authority_revision', live_room.authority_revision)
    );
    return query select 'rejected', 'stale_revision', false, live_room.authority_revision,
      jsonb_build_object('authority_revision', live_room.authority_revision); return;
  end if;

  return query select 'ready', null::text, false, live_room.authority_revision, null::jsonb;
end;
$$;

revoke all on function public.assert_room_live_session_revision(text, bigint, text, text, text) from public;
grant execute on function public.assert_room_live_session_revision(text, bigint, text, text, text) to service_role;

create or replace function public.commit_room_live_session_snapshot(
  p_room_code text, p_expected_revision bigint, p_snapshot jsonb
)
returns table (outcome text, authority_revision bigint)
language plpgsql security definer set search_path = public as $$
declare
  current_room public.room_live_sessions%rowtype;
  desired public.room_live_sessions%rowtype;
  next_revision bigint;
begin
  select * into current_room from public.room_live_sessions where room_code = upper(trim(p_room_code)) for update;
  if not found then return query select 'missing', null::bigint; return; end if;
  if current_room.authority_revision <> p_expected_revision then
    return query select 'stale_revision', current_room.authority_revision; return;
  end if;
  select * into desired from jsonb_populate_record(null::public.room_live_sessions, p_snapshot);
  if desired.room_code is distinct from current_room.room_code or desired.match_id is null then
    raise exception 'invalid_room_live_session_snapshot';
  end if;
  next_revision := current_room.authority_revision + 1;
  update public.room_live_sessions set
    match_id = desired.match_id, status = desired.status, source_type = desired.source_type,
    game_state = desired.game_state, game_state_sequence = desired.game_state_sequence,
    room_shell = desired.room_shell, engine_seat_ids = desired.engine_seat_ids, roster = desired.roster,
    event_log_version = desired.event_log_version, last_event_sequence = desired.last_event_sequence,
    events = desired.events, participant_user_ids = desired.participant_user_ids,
    matchmaking_match_id = desired.matchmaking_match_id, scheduled_tournament_id = desired.scheduled_tournament_id,
    scheduled_tournament_match_id = desired.scheduled_tournament_match_id, started_at = desired.started_at,
    updated_at = now(), authority_revision = next_revision
  where room_code = current_room.room_code and authority_revision = p_expected_revision;
  if not found then raise exception 'room_live_session_revision_changed_during_commit'; end if;
  return query select 'committed', next_revision;
end;
$$;

revoke all on function public.commit_room_live_session_snapshot(text, bigint, jsonb) from public;
grant execute on function public.commit_room_live_session_snapshot(text, bigint, jsonb) to service_role;

-- Atomic gameplay command boundary. Unlike the two compatibility helpers
-- above, this function holds the live-room row lock while it checks command
-- identity, compares the authority revision, commits the full snapshot, and
-- stores the replayable response. A process crash cannot leave a committed
-- snapshot without its idempotency receipt (or vice versa).
create or replace function public.commit_room_live_session_command(
  p_room_code text,
  p_actor_seat_id text,
  p_request_id text,
  p_request_digest text,
  p_expected_revision bigint,
  p_snapshot jsonb,
  p_response jsonb
)
returns table (
  outcome text,
  error_code text,
  replayed boolean,
  authority_revision bigint,
  response jsonb
)
language plpgsql security definer set search_path = public as $$
declare
  current_room public.room_live_sessions%rowtype;
  desired public.room_live_sessions%rowtype;
  receipt public.room_live_session_command_receipts%rowtype;
  next_revision bigint;
  committed_response jsonb;
begin
  if p_actor_seat_id is null or btrim(p_actor_seat_id) = '' then
    raise exception 'invalid_room_live_session_actor';
  end if;
  if p_request_id is null or char_length(btrim(p_request_id)) not between 1 and 128 then
    raise exception 'invalid_room_live_session_request_id';
  end if;
  if p_request_digest is null or p_request_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_room_live_session_request_digest';
  end if;
  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'invalid_room_live_session_expected_revision';
  end if;

  select * into current_room
    from public.room_live_sessions
    where room_code = upper(trim(p_room_code))
    for update;
  if not found then
    return query select 'rejected', 'room_not_persisted', false, null::bigint, null::jsonb;
    return;
  end if;

  select * into receipt
    from public.room_live_session_command_receipts
    where room_code = current_room.room_code
      and actor_seat_id = p_actor_seat_id
      and request_id = btrim(p_request_id);
  if found then
    if receipt.request_digest <> p_request_digest then
      return query select
        'rejected', 'request_id_conflict', false,
        coalesce(receipt.committed_revision, current_room.authority_revision),
        receipt.response;
      return;
    end if;
    return query select
      receipt.outcome, receipt.error_code, true,
      coalesce(receipt.committed_revision, current_room.authority_revision),
      receipt.response;
    return;
  end if;

  if current_room.authority_revision <> p_expected_revision then
    committed_response := jsonb_build_object(
      'ok', false,
      'error', 'stale_revision',
      'authorityRevision', current_room.authority_revision,
      'sequence', current_room.game_state_sequence
    );
    insert into public.room_live_session_command_receipts (
      room_code, actor_seat_id, request_id, request_digest,
      expected_revision, outcome, error_code, response
    ) values (
      current_room.room_code, p_actor_seat_id, btrim(p_request_id), p_request_digest,
      p_expected_revision, 'rejected', 'stale_revision', committed_response
    );
    return query select
      'rejected', 'stale_revision', false,
      current_room.authority_revision, committed_response;
    return;
  end if;

  select * into desired
    from jsonb_populate_record(null::public.room_live_sessions, p_snapshot);
  if desired.room_code is distinct from current_room.room_code
    or desired.match_id is null
    or desired.game_state_sequence < current_room.game_state_sequence then
    raise exception 'invalid_room_live_session_snapshot';
  end if;

  next_revision := current_room.authority_revision + 1;
  committed_response := coalesce(p_response, '{}'::jsonb) || jsonb_build_object(
    'authorityRevision', next_revision
  );

  update public.room_live_sessions set
    match_id = desired.match_id,
    status = desired.status,
    source_type = desired.source_type,
    game_state = desired.game_state,
    game_state_sequence = desired.game_state_sequence,
    room_shell = desired.room_shell,
    engine_seat_ids = desired.engine_seat_ids,
    roster = desired.roster,
    event_log_version = desired.event_log_version,
    last_event_sequence = desired.last_event_sequence,
    events = desired.events,
    participant_user_ids = desired.participant_user_ids,
    matchmaking_match_id = desired.matchmaking_match_id,
    scheduled_tournament_id = desired.scheduled_tournament_id,
    scheduled_tournament_match_id = desired.scheduled_tournament_match_id,
    started_at = desired.started_at,
    updated_at = now(),
    authority_revision = next_revision
  where room_code = current_room.room_code
    and authority_revision = p_expected_revision;
  if not found then
    raise exception 'room_live_session_revision_changed_during_commit';
  end if;

  insert into public.room_live_session_command_receipts (
    room_code, actor_seat_id, request_id, request_digest,
    expected_revision, committed_revision, outcome, response, committed_at
  ) values (
    current_room.room_code, p_actor_seat_id, btrim(p_request_id), p_request_digest,
    p_expected_revision, next_revision, 'committed', committed_response, now()
  );

  return query select 'committed', null::text, false, next_revision, committed_response;
end;
$$;

revoke all on function public.commit_room_live_session_command(
  text, text, text, text, bigint, jsonb, jsonb
) from public;
grant execute on function public.commit_room_live_session_command(
  text, text, text, text, bigint, jsonb, jsonb
) to service_role;
