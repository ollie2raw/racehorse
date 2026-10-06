-- Incremental live-session logs (storage fix S1, docs/ops/hosting-cost-plan.md §7).
--
-- Every move used to upsert room_live_sessions with the room's whole event log
-- and both seats' ghost move logs inside it, so each write grew with the match
-- (182 KB late in a 30-point game; ~11 MB uploaded per match). With
-- LIVE_SESSION_LOG_ENTRIES=true on the server, a write sends the snapshot
-- without those two logs (their lengths are kept in room_shell) plus only the
-- entries added since the last confirmed write. Hydration rebuilds the logs
-- from this table, truncated to the lengths in the snapshot, so entries left
-- by a rolled-back action are never read and are overwritten by the next
-- entry at the same index.
--
-- Safe in any order: the server only uses this when the flag is on, and with
-- the flag off it keeps writing the old full rows. Apply on dev first.
--
-- Rollback: set LIVE_SESSION_LOG_ENTRIES=false (or unset) and redeploy; rows
-- written in entries mode during the window would hydrate without their logs
-- on an old server, so roll back between matches if possible. Dropping the
-- table and function is optional afterwards.

begin;

create table if not exists public.room_live_session_entries (
  room_code text not null references public.room_live_sessions (room_code) on delete cascade,
  -- 'events', or 'ghost:<engine seat id>'
  stream text not null,
  idx integer not null check (idx >= 0),
  entry jsonb not null,
  primary key (room_code, stream, idx)
);

alter table public.room_live_session_entries enable row level security;
-- No policies: server-only (service_role bypasses RLS). Same posture as
-- room_live_sessions, which allows no client reads either.
revoke all on table public.room_live_session_entries from anon, authenticated;
grant select, insert, update, delete on table public.room_live_session_entries to service_role;

-- One atomic write: the snapshot row plus its new entries, or neither.
--   p_session : one room_live_sessions row as JSON (the same keys the server
--               upserts today; events = [] and room_shell without ghostMoveLogs)
--   p_entries : [{ "stream": "events" | "ghost:<seat>", "idx": n, "entry": {...} }, ...]
create or replace function public.persist_room_live_session(
  p_session jsonb,
  p_entries jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.room_live_sessions;
begin
  v_row := jsonb_populate_record(null::public.room_live_sessions, p_session);
  if v_row.room_code is null then
    raise exception 'room_code_required';
  end if;

  insert into public.room_live_sessions (
    room_code, match_id, status, source_type, game_state, game_state_sequence,
    room_shell, engine_seat_ids, roster, event_log_version, last_event_sequence,
    events, participant_user_ids, matchmaking_match_id, scheduled_tournament_id,
    scheduled_tournament_match_id, started_at, updated_at
  ) values (
    v_row.room_code, v_row.match_id, v_row.status, v_row.source_type, v_row.game_state,
    coalesce(v_row.game_state_sequence, 0), coalesce(v_row.room_shell, '{}'::jsonb),
    coalesce(v_row.engine_seat_ids, '{}'), coalesce(v_row.roster, '[]'::jsonb),
    coalesce(v_row.event_log_version, 1), coalesce(v_row.last_event_sequence, 0),
    coalesce(v_row.events, '[]'::jsonb), coalesce(v_row.participant_user_ids, '{}'),
    v_row.matchmaking_match_id, v_row.scheduled_tournament_id,
    v_row.scheduled_tournament_match_id, v_row.started_at,
    coalesce(v_row.updated_at, timezone('utc', now()))
  )
  on conflict (room_code) do update set
    match_id = excluded.match_id,
    status = excluded.status,
    source_type = excluded.source_type,
    game_state = excluded.game_state,
    game_state_sequence = excluded.game_state_sequence,
    room_shell = excluded.room_shell,
    engine_seat_ids = excluded.engine_seat_ids,
    roster = excluded.roster,
    event_log_version = excluded.event_log_version,
    last_event_sequence = excluded.last_event_sequence,
    events = excluded.events,
    participant_user_ids = excluded.participant_user_ids,
    matchmaking_match_id = excluded.matchmaking_match_id,
    scheduled_tournament_id = excluded.scheduled_tournament_id,
    scheduled_tournament_match_id = excluded.scheduled_tournament_match_id,
    started_at = excluded.started_at,
    updated_at = excluded.updated_at;

  insert into public.room_live_session_entries (room_code, stream, idx, entry)
  select v_row.room_code, e.stream, e.idx, e.entry
    from jsonb_to_recordset(coalesce(p_entries, '[]'::jsonb)) as e(stream text, idx integer, entry jsonb)
  on conflict (room_code, stream, idx) do update set entry = excluded.entry;
end;
$$;

revoke execute on function public.persist_room_live_session(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.persist_room_live_session(jsonb, jsonb) to service_role;

commit;

notify pgrst, 'reload schema';
