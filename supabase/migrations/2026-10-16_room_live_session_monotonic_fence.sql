-- EXPAND (additive; no table rewrite; BRIDGE- and NEW-compatible). Durable room-state monotonicity.
--
-- Defect (reproduced against real PostgreSQL): both writers of room_live_sessions
-- (the PostgREST `merge-duplicates` upsert and persist_room_live_session) overwrite
-- the stored row unconditionally. A process holding an OLDER snapshot -- e.g. the old
-- instance during Render's zero-downtime replacement -- turned
--     game_over + completionPending=true   into   playing + empty shell,
-- erasing completionPending / completionRecovery, so the terminal-completion scan could
-- no longer find the row and the roomRetentionReaper later deleted it.
-- `inFlightPersistByRoomCode` only serialises one process; it cannot fence two.
--
-- The fence lives in PostgreSQL, in one BEFORE UPDATE trigger, so it covers every writer
-- (upsert ON CONFLICT DO UPDATE, the RPC, and the recovery path's PATCH) with no change
-- to a deployed server. ON CONFLICT DO UPDATE fires BEFORE UPDATE row triggers.
--
-- Ordering key: the gameplay sequence already persisted in the row -- the tuple
--   (game_state_sequence, last_event_sequence)    compared lexicographically.
-- It is NOT updated_at: updated_at is stamped by the writer's clock and is rewritten by
-- recovery bookkeeping, so it does not order game state.
--
-- Rules, for a row UPDATE where match_id is unchanged (one match):
--   R1 lower tuple              -> REJECT  room_live_session_stale_write
--   R2 terminal -> active       -> REJECT  room_live_session_terminal_regression
--      (terminal = game_over | abandoned; any sequence, including equal or higher)
--   R3 equal tuple              -> ACCEPT. Same payload is an idempotent retry. A different
--      payload at the same sequence is also accepted: that is the response-loss retry
--      (a committed-but-unacknowledged action rolled back in memory and re-applied) and
--      terminal bookkeeping, which advances no gameplay sequence.
--   R4 higher tuple             -> ACCEPT
--   Completion markers are made monotonic on every accepted write (never rejected):
--   M1 stored matchLogged=true  -> keep matchLogged=true, completionPending=false and drop
--                                  completionRecovery (exactly what markTerminalCompletionLogged writes)
--   M2 stored completionPending=true is cleared only together with matchLogged=true
--   M3 stored completionRecovery (attempts/quarantine) survives a write that omits it
-- For a row UPDATE that replaces a DIFFERENT match (rematch / room-code reuse):
--   X1 the stored row is terminal, completionPending=true and not matchLogged
--                               -> REJECT  room_live_session_owes_completion
--      (a rematch already waits for the logged completion; this stops any other writer from
--      overwriting the only durable replay source). Otherwise ACCEPT.
--
-- Not covered (documented residual, needs a per-room generation number): a stale writer
-- of an OLDER match overwriting a NEWER match's non-terminal row, and re-INSERT of a row
-- after it was deleted.
--
-- Placement: with the other expand migrations, any time before NEW is deployed (it does not
-- depend on, or read, the rating cutover gate). Safe to apply with BRIDGE live.
begin;
set local lock_timeout = '5s';

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
begin
  if new.match_id is distinct from old.match_id then
    if old_terminal and old_pending and not old_logged then
      raise exception 'room_live_session_owes_completion: room % match % still owes its completion', old.room_code, old.match_id
        using errcode = 'P0001';
    end if;
    return new;
  end if;

  if (new.game_state_sequence, new.last_event_sequence) < (old.game_state_sequence, old.last_event_sequence) then
    raise exception 'room_live_session_stale_write: room % stored (%, %) incoming (%, %)', old.room_code,
      old.game_state_sequence, old.last_event_sequence, new.game_state_sequence, new.last_event_sequence
      using errcode = 'P0001';
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

revoke execute on function public.enforce_room_live_session_monotonic() from public, anon, authenticated;

drop trigger if exists room_live_sessions_monotonic_fence on public.room_live_sessions;
create trigger room_live_sessions_monotonic_fence before update on public.room_live_sessions
  for each row execute function public.enforce_room_live_session_monotonic();

do $$ begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.room_live_sessions'::regclass
                   and tgname = 'room_live_sessions_monotonic_fence' and not tgisinternal) then
    raise exception 'room live session monotonic fence not installed';
  end if;
end $$;
commit;
