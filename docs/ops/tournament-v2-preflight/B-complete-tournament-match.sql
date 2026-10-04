-- Tournament v2 preflight, piece B: complete_tournament_match (requires piece A)
-- Source: supabase/migrations/2026-08-31_tournament_match_rpcs.sql (verbatim; generate_tournament_bracket deliberately excluded).
-- Safe to re-run: create or replace + idempotent grants. Paste the whole block into the Supabase SQL editor.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- complete_tournament_match — the important one.
--   T-INV-1..5, T-INV-10, T-INV-3 (conflict branch).
--   Callers: real game over, forfeit-on-leave, no-show reconciler,
--            bot-vs-bot auto-resolve, bye walkover.
-- Returns jsonb:
--   { status, winner_id, winner_source, player1_score, player2_score,
--     conflict, advanced_to_match_id, advanced_to_slot, advanced_to_status,
--     tournament_completed, round_now_complete }
-- Raises (message = the code the Node layer maps):
--   match_not_found, match_not_playable, game_over_on_non_started_match,
--   invalid_source_for_status, winner_not_participant, score_inconsistent
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.complete_tournament_match(
  p_match_id           uuid,
  p_winner_id          text,
  p_winner_source      text,     -- 'game_over' | 'no_show' | 'forfeit' | null (bye)
  p_status_reason      text default null,   -- e.g. 'bot_simulated', 'player1_no_show'
  p_reported_p1_score  integer default null,
  p_reported_p2_score  integer default null,
  p_no_show_user_id    text default null,
  p_forfeit_user_id    text default null,
  p_bye_walkover       boolean default false,
  p_actor              text default null    -- audit / log only; not persisted
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_match        scheduled_tournament_matches%rowtype;
  v_tournament   scheduled_tournaments%rowtype;
  v_loser_id     text;
  v_has_human    boolean;
  v_p1_score     integer;
  v_p2_score     integer;
  v_tgt_round    integer;
  v_tgt_number   integer;
  v_tgt_slot     text;
  v_tgt_id       uuid;
  v_tgt_status   text;
  v_round_done   boolean;
begin
  -- 1 ── lock the match row. Concurrent callers for this match serialise here.
  select * into v_match
    from scheduled_tournament_matches
   where id = p_match_id
   for update;
  if not found then
    raise exception 'match_not_found';
  end if;

  -- 2 ── already completed → idempotent / conflict-explicit (T-INV-1, T-INV-3).
  if v_match.status = 'completed' then
    return jsonb_build_object(
      'status',               v_match.status,
      'winner_id',            v_match.winner_id,
      'winner_source',        v_match.winner_source,
      'player1_score',        v_match.player1_score,
      'player2_score',        v_match.player2_score,
      'conflict',             (v_match.winner_id is distinct from p_winner_id),
      'applied',              false,   -- this call did not write
      'advanced_to_match_id', null,
      'tournament_completed',  (v_match.round = 3),
      'round_now_complete',    null,
      'placements',           null
    );
  end if;

  -- 3 ── the match must be in a playable state.
  if v_match.status = 'waiting' then
    raise exception 'match_not_playable' using detail = 'waiting';
  end if;
  if v_match.status = 'bye' and not p_bye_walkover then
    raise exception 'match_not_playable' using detail = 'bye';
  end if;

  select * into v_tournament from scheduled_tournaments where id = v_match.tournament_id;

  if not p_bye_walkover then
    v_has_human := not (public._tournament_is_bot(v_match.player1_id)
                        and public._tournament_is_bot(v_match.player2_id));

    -- 4 ── a real game-over can only come from a match a human actually
    --      played, i.e. one that reached 'in_progress'. A fully-bot match
    --      (v_has_human = false) auto-resolves via game_over from 'ready' —
    --      that is fine. Does not depend on p_status_reason: 'bot_simulated'
    --      is only ever set for bot-only matches (resolveBotOnlyMatch), so
    --      v_has_human already distinguishes the two.
    if p_winner_source = 'game_over'
       and v_has_human
       and v_match.status <> 'in_progress' then
      raise exception 'game_over_on_non_started_match' using detail = v_match.status;
    end if;

    -- 5 ── no_show / forfeit only from a live match.
    if p_winner_source in ('no_show', 'forfeit')
       and v_match.status not in ('ready', 'in_progress') then
      raise exception 'invalid_source_for_status' using detail = v_match.status;
    end if;

    -- 6 ── T-INV-2: winner is one of the two assigned participants.
    if v_match.player1_id is null or v_match.player2_id is null
       or p_winner_id not in (v_match.player1_id, v_match.player2_id) then
      raise exception 'winner_not_participant';
    end if;
  else
    -- bye: the single present player is the only legal winner.
    if p_winner_id is distinct from coalesce(v_match.player1_id, v_match.player2_id) then
      raise exception 'winner_not_participant';
    end if;
  end if;

  -- 7 ── canonical scores (T-INV-4).
  select cs.player1_score, cs.player2_score
    into v_p1_score, v_p2_score
    from public._tournament_canonical_scores(
      p_winner_id, v_match.player1_id, v_match.player2_id,
      p_winner_source, coalesce(v_tournament.win_target, 30),
      p_reported_p1_score, p_reported_p2_score
    ) cs;

  -- 8 ── write the completion (T-INV-1) — atomic with everything below.
  update scheduled_tournament_matches
     set status         = 'completed',
         winner_id      = p_winner_id,
         winner_source  = p_winner_source,
         status_reason  = p_status_reason,
         no_show_user_id = p_no_show_user_id,
         forfeit_user_id = p_forfeit_user_id,
         player1_score  = v_p1_score,
         player2_score  = v_p2_score,
         completed_at   = now()
   where id = p_match_id;

  -- 9 ── eliminate the human loser (T-INV-10). Byes have no loser.
  if not p_bye_walkover then
    v_loser_id := case
      when p_winner_id is not distinct from v_match.player1_id then v_match.player2_id
      when p_winner_id is not distinct from v_match.player2_id then v_match.player1_id
    end;
    if v_loser_id is not null and not public._tournament_is_bot(v_loser_id) then
      update scheduled_tournament_registrations
         set status = 'eliminated'
       where tournament_id = v_match.tournament_id
         and user_id = v_loser_id::uuid
         and status <> 'winner';
    end if;
  end if;

  -- 10 ── advance, or (round 3) complete the tournament (T-INV-5 / T-INV-10).
  if v_match.round = 3 then
    -- champion
    if not public._tournament_is_bot(p_winner_id) then
      update scheduled_tournament_registrations
         set status = 'winner', placement = 1
       where tournament_id = v_match.tournament_id
         and user_id = p_winner_id::uuid;
    end if;
    -- everyone else who played a completed match, placed by exit round
    update scheduled_tournament_registrations r
       set placement = case m.round when 3 then 2 when 2 then 3 when 1 then 5 end
      from scheduled_tournament_matches m
     where m.tournament_id = v_match.tournament_id
       and m.status = 'completed'
       and r.tournament_id = v_match.tournament_id
       and r.placement is null
       and r.user_id::text = case
             when m.winner_id is not distinct from m.player1_id then m.player2_id
             when m.winner_id is not distinct from m.player2_id then m.player1_id
           end
       and not public._tournament_is_bot(r.user_id::text);

    update scheduled_tournaments
       set status = 'completed', winner_id = p_winner_id
     where id = v_match.tournament_id
       and status = 'in_progress';

    select bool_and(status in ('completed', 'bye')) into v_round_done
      from scheduled_tournament_matches
     where tournament_id = v_match.tournament_id and round = v_match.round;

    return jsonb_build_object(
      'status',               'completed',
      'winner_id',            p_winner_id,
      'winner_source',        p_winner_source,
      'player1_score',        v_p1_score,
      'player2_score',        v_p2_score,
      'conflict',             false,
      'applied',              true,
      'advanced_to_match_id', null,
      'tournament_completed',  true,
      'round_now_complete',    coalesce(v_round_done, false),
      'placements',           coalesce((
        select jsonb_agg(jsonb_build_object('user_id', r.user_id, 'placement', r.placement))
          from scheduled_tournament_registrations r
         where r.tournament_id = v_match.tournament_id
           and r.placement is not null
           and not public._tournament_is_bot(r.user_id::text)
      ), '[]'::jsonb)
    );
  end if;

  -- rounds 1 & 2 → advance the winner into the fed slot, same transaction.
  select t.next_round, t.next_match_number, t.next_slot
    into v_tgt_round, v_tgt_number, v_tgt_slot
    from public._tournament_advance_target(v_match.round, v_match.match_number) t;

  if v_tgt_slot is null then
    -- unreachable for rounds 1/2, but fail loud rather than silently skip
    raise exception 'no_advance_target' using detail = v_match.round::text;
  end if;

  select id into v_tgt_id
    from scheduled_tournament_matches
   where tournament_id = v_match.tournament_id
     and round = v_tgt_round
     and match_number = v_tgt_number
   for update;      -- second row lock; order is always (feeder)→(target), no cycle
  if not found then
    -- A 7-row bracket always has this target. If it is missing the bracket is
    -- corrupt — but the completion above is real and durable, so do NOT roll it
    -- back: return with the flag and let the Node layer log/alert. (Raising here
    -- would also kill the whole reconciler tick on one bad match.)
    return jsonb_build_object(
      'status',               'completed',
      'winner_id',            p_winner_id,
      'winner_source',        p_winner_source,
      'player1_score',        v_p1_score,
      'player2_score',        v_p2_score,
      'applied',              true,
      'conflict',             false,
      'advance_target_missing', true,
      'advanced_to_match_id', null,
      'advanced_to_slot',     null,
      'advanced_to_status',   null,
      'tournament_completed',  false,
      'round_now_complete',    coalesce((
        select bool_and(status in ('completed','bye')) from scheduled_tournament_matches
         where tournament_id = v_match.tournament_id and round = v_match.round), false),
      'placements',            null
    );
  end if;

  if v_tgt_slot = 'player1' then
    update scheduled_tournament_matches
       set player1_id = p_winner_id,
           status = case when player2_id is not null then 'ready' else 'waiting' end,
           bot_tier = case
             when public._tournament_is_bot(p_winner_id) or public._tournament_is_bot(player2_id)
             then (case v_tgt_round when 3 then 'master' when 2 then 'elite' else 'standard' end)
             else null end
     where id = v_tgt_id
       and (player1_id is null or player1_id = p_winner_id)   -- repeat = no-op
     returning status into v_tgt_status;
  else
    update scheduled_tournament_matches
       set player2_id = p_winner_id,
           status = case when player1_id is not null then 'ready' else 'waiting' end,
           bot_tier = case
             when public._tournament_is_bot(p_winner_id) or public._tournament_is_bot(player1_id)
             then (case v_tgt_round when 3 then 'master' when 2 then 'elite' else 'standard' end)
             else null end
     where id = v_tgt_id
       and (player2_id is null or player2_id = p_winner_id)
     returning status into v_tgt_status;
  end if;

  select bool_and(status in ('completed', 'bye')) into v_round_done
    from scheduled_tournament_matches
   where tournament_id = v_match.tournament_id and round = v_match.round;

  return jsonb_build_object(
    'status',               'completed',
    'winner_id',            p_winner_id,
    'winner_source',        p_winner_source,
    'player1_score',        v_p1_score,
    'player2_score',        v_p2_score,
    'conflict',             false,
    'applied',              true,
    'advance_target_missing', false,
    'advanced_to_match_id', v_tgt_id,
    'advanced_to_slot',     v_tgt_slot,
    'advanced_to_status',   v_tgt_status,
    'tournament_completed',  false,
    'round_now_complete',    coalesce(v_round_done, false),
    'placements',            null
  );
end;
$$;

revoke execute on function
  public.complete_tournament_match(uuid, text, text, text, integer, integer, text, text, boolean, text)
  from public, anon, authenticated;
grant execute on function
  public.complete_tournament_match(uuid, text, text, text, integer, integer, text, text, boolean, text)
  to service_role;

commit;

notify pgrst, 'reload schema';
