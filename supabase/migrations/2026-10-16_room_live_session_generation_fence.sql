-- EXPAND (additive; no table rewrite). Room GENERATION fence + writer-epoch fence.
-- Supersedes the function body installed by 2026-10-16_room_live_session_monotonic_fence.sql
-- (apply that file first; this one replaces enforce_room_live_session_monotonic() in place).
--
-- Gaps in the first fence (it only ordered writes WITHIN one match):
--   G1 cross-match: random match ids cannot be ordered, so a stale writer of match A could overwrite
--      room R after R had advanced to match B (lobby / playing / hand-over / logged-terminal).
--   G2 delete/recreate: after A's row was retired and deleted, a stale writer of A could INSERT it
--      back (an UPDATE trigger never sees an INSERT, and the deleted row carried the only memory of A).
--   G3 equal sequence: (game_state_sequence, last_event_sequence) equal does not mean "same writer";
--      two processes can both hold sequence N with different shells / states.
--
-- ROOM GENERATION. public.room_live_session_generations is the durable owner of room-code history. It is
-- NOT the deletable live row: it outlives retirement, so deleting the live row cannot reopen the room to a
-- stale writer. One row per match ever seen in a room code: (match_id, room_code, generation, retired_at).
-- generation is assigned per room code, strictly increasing, the first time a match id is written
-- (a rematch / new session advances it; no writer cooperation is needed, so BRIDGE advances it too).
--   * A write for match M whose generation is LOWER than the room's newest generation is refused
--     (room_live_session_stale_generation), whatever state the newer match is in.
--   * A deleted live row retires its match (AFTER DELETE) and records the writer epoch of the snapshot it deleted
--     (retired_writer_epoch). A write that would recreate a retired match is refused (room_live_session_retired_match)
--     unless it comes from THE SAME WRITER PROCESS that last wrote the row (equal writer epoch) -- the legitimate
--     recreation: a reconnect revives the room in the process that owns it while the archive was deleting the row --
--     or from persist_room_live_session(..., p_restore => true) (NEW's explicit restore). In both cases the match must
--     still be the room's newest generation; an older generation is refused. A DIFFERENT process (a stale zombie, a
--     newer process that never held the room) can never recreate it.
--     Legacy writers (production 3a65ab1c, stock BRIDGE) all have epoch 0, so legacy-vs-legacy recreation is allowed:
--     that is exactly today's behaviour and the only way their reconnect-during-archive keeps working. It is closed
--     for any pair that includes a writer with an epoch (BRIDGE-with-epoch, NEW).
--   * A brand-new match id is a legitimate new generation. A new session using a retired room code
--     therefore survives; the old match is stale from then on.
--   BRIDGE's plain upserts cannot restore: in that one rare race the write fails closed. Documented.
--   Historical rows: every live row present at migration time is backfilled as generation 1. A match
--   retired BEFORE this migration is unknown; stale writers of those cannot be fenced (bounded, one-off).
--
-- WRITER EPOCH. next_room_writer_epoch() hands each server process a unique, increasing number, allocated
-- when persistence is configured at BOOT (so epoch order is process-boot order); it is stamped in
-- room_shell.writerEpoch. For one match: a snapshot whose epoch is LOWER than the stored one is refused
-- (room_live_session_stale_writer) even at an equal or higher sequence, so an older process can never
-- overwrite state last written by a newer process merely because the sequence tuple ties.
-- A missing / non-numeric epoch is 0, so a legacy (BRIDGE) writer is older than any epoch writer. Equal
-- epoch = the same process: its equal-sequence rewrites (ready flags, response-loss retry with a different
-- action) are legitimate and accepted. Legacy-vs-legacy (both 0) keeps the previous behaviour.
--
-- ORDERING KEY (explicit, NULL-safe): (effective game sequence, last_event_sequence) with
--   effective game sequence = greatest(game_state_sequence, game_state->>'sequence') when the state sequence is numeric,
--   otherwise game_state_sequence alone; NULL -> 0. Negative values order numerically (never clamped).
-- The columns are NOT NULL, but BEFORE triggers run before NOT NULL is enforced, so every component is
-- coalesced; a writer cannot bypass the fence by supplying NULL or a lying column.
--
-- Apply AFTER 2026-10-16_room_live_session_monotonic_fence.sql, with the other expand migrations, while the
-- serving artifact is BRIDGE 3ccd6ff8 (quiesced) -- see docs/ops/senior-audit-rating-rush-cutover.md.
begin;
set local lock_timeout = '5s';

create sequence if not exists public.room_writer_epoch_seq;
revoke all on sequence public.room_writer_epoch_seq from public, anon, authenticated;
grant usage, select on sequence public.room_writer_epoch_seq to service_role;

create or replace function public.next_room_writer_epoch() returns bigint
language sql volatile security definer set search_path = public, pg_temp as $$
  select nextval('public.room_writer_epoch_seq')
$$;
revoke execute on function public.next_room_writer_epoch() from public, anon, authenticated;
grant execute on function public.next_room_writer_epoch() to service_role;

create table if not exists public.room_live_session_generations (
  match_id uuid primary key,
  room_code text not null,
  generation bigint not null check (generation >= 1),
  retired_at timestamptz null,
  retired_writer_epoch numeric not null default 0,
  created_at timestamptz not null default now(),
  unique (room_code, generation)
);
alter table public.room_live_session_generations add column if not exists retired_writer_epoch numeric not null default 0;
alter table public.room_live_session_generations enable row level security;
revoke all on public.room_live_session_generations from public, anon, authenticated;
grant select on public.room_live_session_generations to service_role;

insert into public.room_live_session_generations (match_id, room_code, generation)
select match_id, room_code, 1 from public.room_live_sessions
on conflict (match_id) do nothing;

-- ------------------------------------------------------------------ generation guard (INSERT and match-changing UPDATE)
create or replace function public.guard_room_live_session_generation()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  g public.room_live_session_generations%rowtype;
  newest bigint;
  restoring boolean := coalesce(current_setting('racehorse.room_restore', true), '') = 'on';
begin
  -- A same-match UPDATE cannot change the room's generation: the stored row already proved it.
  if tg_op = 'UPDATE' and new.match_id is not distinct from old.match_id then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('room_live_session_generation:' || new.room_code, 0));
  select max(generation) into newest from public.room_live_session_generations where room_code = new.room_code;
  select * into g from public.room_live_session_generations where match_id = new.match_id;
  if found then
    if g.room_code is distinct from new.room_code then
      raise exception 'room_live_session_stale_generation: match % belongs to room %, not %', new.match_id, g.room_code, new.room_code
        using errcode = 'P0001';
    end if;
    if g.generation < newest then
      raise exception 'room_live_session_stale_generation: room % match % is generation % but the room is at %',
        new.room_code, new.match_id, g.generation, newest using errcode = 'P0001';
    end if;
    if g.retired_at is not null then
      if not restoring and public.room_live_session_writer_epoch(new.room_shell) is distinct from g.retired_writer_epoch then
        raise exception 'room_live_session_retired_match: room % match % was retired by writer epoch %, incoming %', new.room_code, new.match_id,
          g.retired_writer_epoch, public.room_live_session_writer_epoch(new.room_shell) using errcode = 'P0001';
      end if;
      update public.room_live_session_generations set retired_at = null where match_id = new.match_id;
    end if;
  else
    insert into public.room_live_session_generations (match_id, room_code, generation)
    values (new.match_id, new.room_code, coalesce(newest, 0) + 1);
  end if;
  return new;
end $$;
revoke execute on function public.guard_room_live_session_generation() from public, anon, authenticated;

drop trigger if exists room_live_sessions_generation_guard on public.room_live_sessions;
create trigger room_live_sessions_generation_guard before insert or update on public.room_live_sessions
  for each row execute function public.guard_room_live_session_generation();

create or replace function public.retire_room_live_session_generation()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.room_live_session_generations
     set retired_at = coalesce(retired_at, now()),
         retired_writer_epoch = public.room_live_session_writer_epoch(old.room_shell)
   where match_id = old.match_id;
  return old;
end $$;
revoke execute on function public.retire_room_live_session_generation() from public, anon, authenticated;
drop trigger if exists room_live_sessions_retire_generation on public.room_live_sessions;
create trigger room_live_sessions_retire_generation after delete on public.room_live_sessions
  for each row execute function public.retire_room_live_session_generation();

-- ------------------------------------------------------------------ sequence / epoch / terminal / marker fence
create or replace function public.room_live_session_effective_sequence(seq integer, state jsonb)
returns numeric language sql immutable set search_path = public, pg_temp as $$
  select case when jsonb_typeof(state) = 'object' and jsonb_typeof(state -> 'sequence') = 'number'
              then greatest(coalesce(seq, 0)::numeric, (state ->> 'sequence')::numeric)
              else coalesce(seq, 0)::numeric end
$$;
create or replace function public.room_live_session_writer_epoch(shell jsonb)
returns numeric language sql immutable set search_path = public, pg_temp as $$
  select case when jsonb_typeof(shell) = 'object' and jsonb_typeof(shell -> 'writerEpoch') = 'number'
              then (shell ->> 'writerEpoch')::numeric else 0 end
$$;

create or replace function public.enforce_room_live_session_monotonic()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  old_shell jsonb := case when jsonb_typeof(old.room_shell) = 'object' then old.room_shell else '{}'::jsonb end;
  new_shell jsonb := case when jsonb_typeof(new.room_shell) = 'object' then new.room_shell else '{}'::jsonb end;
  old_terminal boolean := old.status in ('game_over', 'abandoned');
  new_terminal boolean := new.status in ('game_over', 'abandoned');
  old_logged boolean := old_shell ->> 'matchLogged' = 'true';
  old_pending boolean := old_shell ->> 'completionPending' = 'true';
  new_logged boolean := new_shell ->> 'matchLogged' = 'true';
  old_seq numeric := public.room_live_session_effective_sequence(old.game_state_sequence, old.game_state);
  new_seq numeric := public.room_live_session_effective_sequence(new.game_state_sequence, new.game_state);
  old_ev bigint := coalesce(old.last_event_sequence, 0);
  new_ev bigint := coalesce(new.last_event_sequence, 0);
begin
  if new.match_id is distinct from old.match_id then
    if old_terminal and old_pending and not old_logged then
      raise exception 'room_live_session_owes_completion: room % match % still owes its completion', old.room_code, old.match_id
        using errcode = 'P0001';
    end if;
    return new;
  end if;

  if public.room_live_session_writer_epoch(new_shell) < public.room_live_session_writer_epoch(old_shell) then
    raise exception 'room_live_session_stale_writer: room % stored epoch % incoming %', old.room_code,
      public.room_live_session_writer_epoch(old_shell), public.room_live_session_writer_epoch(new_shell)
      using errcode = 'P0001';
  end if;

  if (new_seq, new_ev) < (old_seq, old_ev) then
    raise exception 'room_live_session_stale_write: room % stored (%, %) incoming (%, %)', old.room_code,
      old_seq, old_ev, new_seq, new_ev using errcode = 'P0001';
  end if;

  if old_terminal and not new_terminal then
    raise exception 'room_live_session_terminal_regression: room % is % and cannot become %', old.room_code, old.status, new.status
      using errcode = 'P0001';
  end if;

  if old_logged then
    new_shell := (new_shell - 'completionRecovery') || jsonb_build_object('matchLogged', true, 'completionPending', false);
    new.room_shell := new_shell;
  else
    if old_pending and not new_logged and new_shell ->> 'completionPending' is distinct from 'true' then
      new_shell := new_shell || jsonb_build_object('completionPending', true);
    end if;
    if old_shell ? 'completionRecovery' and not new_logged and not (new_shell ? 'completionRecovery') then
      new_shell := new_shell || jsonb_build_object('completionRecovery', old_shell -> 'completionRecovery');
    end if;
    if new_shell is distinct from new.room_shell and jsonb_typeof(new.room_shell) = 'object' then
      new.room_shell := new_shell;
    end if;
  end if;
  return new;
end $$;

-- ------------------------------------------------------------------ RPC: explicit restore intent
drop function if exists public.persist_room_live_session(jsonb, jsonb);
create or replace function public.persist_room_live_session(
  p_session jsonb,
  p_entries jsonb default '[]'::jsonb,
  p_restore boolean default false
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.room_live_sessions;
begin
  perform set_config('racehorse.room_restore', case when p_restore then 'on' else 'off' end, true);
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
revoke execute on function public.persist_room_live_session(jsonb, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.persist_room_live_session(jsonb, jsonb, boolean) to service_role;

do $$ begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.room_live_sessions'::regclass and tgname = 'room_live_sessions_generation_guard' and not tgisinternal)
     or not exists (select 1 from pg_trigger where tgrelid = 'public.room_live_sessions'::regclass and tgname = 'room_live_sessions_retire_generation' and not tgisinternal)
     or not exists (select 1 from pg_trigger where tgrelid = 'public.room_live_sessions'::regclass and tgname = 'room_live_sessions_monotonic_fence' and not tgisinternal) then
    raise exception 'room live session generation fence not fully installed (apply 2026-10-16_room_live_session_monotonic_fence.sql first)';
  end if;
end $$;
commit;
notify pgrst, 'reload schema';
