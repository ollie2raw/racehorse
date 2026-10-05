-- Tournament v2 preflight, piece C: promote_tournament_match
-- Source: supabase/migrations/2026-08-31_tournament_match_rpcs.sql (verbatim; generate_tournament_bracket deliberately excluded).
-- Safe to re-run: create or replace + idempotent grants. Paste the whole block into the Supabase SQL editor.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- promote_tournament_match — waiting→ready and ready→in_progress (T-d, T-e).
--   Callers: scheduler (dispatch a QF; promote a joined match), player attach.
--   The RPC owns only the status transition + the timestamps/room passed with
--   it; Node computes the ready window and reserves the in-memory room.
-- Returns jsonb: { status, ready_at, ready_deadline_at, started_at, room_code, conflict }
-- Raises: match_not_found, invalid_promotion
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.promote_tournament_match(
  p_match_id           uuid,
  p_to_status          text,     -- 'ready' | 'in_progress'
  p_ready_at           timestamptz default null,
  p_ready_deadline_at  timestamptz default null,
  p_room_code          text default null,
  p_started_at         timestamptz default null,
  p_actor              text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_match scheduled_tournament_matches%rowtype;
begin
  if p_to_status not in ('ready', 'in_progress') then
    raise exception 'invalid_promotion' using detail = 'bad target status';
  end if;

  select * into v_match
    from scheduled_tournament_matches
   where id = p_match_id
   for update;
  if not found then
    raise exception 'match_not_found';
  end if;

  -- a finished match can't be promoted; a completion race won — report, no write.
  if v_match.status in ('completed', 'bye') then
    return jsonb_build_object('status', v_match.status, 'conflict', true);
  end if;

  -- idempotent: already there.
  if v_match.status = p_to_status then
    return jsonb_build_object(
      'status', v_match.status, 'ready_at', v_match.ready_at,
      'ready_deadline_at', v_match.ready_deadline_at, 'started_at', v_match.started_at,
      'room_code', v_match.room_code, 'conflict', false
    );
  end if;

  if p_to_status = 'ready' then
    -- both slots must be filled (for SF/Final this is the two-feeder gate, T-INV-6).
    if v_match.status <> 'waiting'
       or v_match.player1_id is null or v_match.player2_id is null then
      raise exception 'invalid_promotion'
        using detail = format('status=%s p1=%s p2=%s',
                              v_match.status, v_match.player1_id is not null, v_match.player2_id is not null);
    end if;
    update scheduled_tournament_matches
       set status            = 'ready',
           ready_at          = coalesce(ready_at, p_ready_at, now()),
           ready_deadline_at = coalesce(ready_deadline_at, p_ready_deadline_at),
           room_code         = coalesce(p_room_code, room_code),
           status_reason     = null
     where id = p_match_id;
  else -- in_progress
    if v_match.status not in ('ready', 'in_progress') then
      raise exception 'invalid_promotion' using detail = v_match.status;
    end if;
    update scheduled_tournament_matches
       set status        = 'in_progress',
           started_at    = coalesce(started_at, p_started_at, now()),
           room_code     = coalesce(p_room_code, room_code),
           status_reason = null
     where id = p_match_id;
  end if;

  select * into v_match from scheduled_tournament_matches where id = p_match_id;
  return jsonb_build_object(
    'status', v_match.status, 'ready_at', v_match.ready_at,
    'ready_deadline_at', v_match.ready_deadline_at, 'started_at', v_match.started_at,
    'room_code', v_match.room_code, 'conflict', false
  );
end;
$$;

revoke execute on function
  public.promote_tournament_match(uuid, text, timestamptz, timestamptz, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function
  public.promote_tournament_match(uuid, text, timestamptz, timestamptz, text, timestamptz, text)
  to service_role;

commit;

notify pgrst, 'reload schema';
