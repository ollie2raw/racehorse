-- Scheduled-tournament match state machine, as three Postgres transaction
-- functions (RPCs). See HARDENING_PLAN.md §1.4.2 / §1.4.3 / Decisions D-2, D-5.
--
-- Why: match completion + bracket advancement were "8 non-atomic PATCHes" from
-- five producers (real game over, forfeit-on-leave, no-show reconciler,
-- bot-vs-bot auto-resolve, bye walkover). A plain read-then-write let two of
-- them both pass a `status <> 'completed'` check and each advance the bracket.
-- These functions move the read + validate + write into ONE transaction,
-- guarded by `SELECT ... FOR UPDATE` on the match row — the DB serialises
-- concurrent callers for the same match with no application-level locking.
--
-- Invariants enforced (HARDENING_PLAN.md §1.2, ratified D-3 / D-6):
--   T-INV-1  completion is atomic + terminal
--   T-INV-2  winner is a real participant (checked against the LOCKED row)
--   T-INV-3  idempotent; a winner disagreement returns conflict=true, no write
--   T-INV-4  scores derived by the RPC for no_show/forfeit/bye; validated for game_over
--   T-INV-5  exactly one advancement write, same transaction as completion
--   T-INV-10 elimination + final/tournament completion, same transaction
--
-- Column note: player1_id / player2_id / winner_id / *_user_id and
-- scheduled_tournaments.winner_id are `text` (not uuid) — bot ids like
-- 'bot:fritz:<tid>:<n>' are not UUIDs (see 2026-05-16_zz_tournament_bot_fill).
-- Only scheduled_tournament_registrations.user_id is still uuid.
--
-- These run under the service-role key from the Node server (BYPASSRLS), and
-- are additionally `security definer`. EXECUTE is granted to service_role only.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper: is this id a synthetic Fritz bot?
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public._tournament_is_bot(p_id text)
returns boolean
language sql
immutable
as $$
  select p_id is not null and p_id like 'bot:fritz:%';
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper: which next-round slot a finished match feeds.
--   QF1→SF1.player1  QF2→SF1.player2  QF3→SF2.player1  QF4→SF2.player2
--   SF1→F.player1     SF2→F.player2
--   Final (round 3)  → no target (returns no rows)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public._tournament_advance_target(
  p_round integer,
  p_match_number integer
)
returns table (next_round integer, next_match_number integer, next_slot text)
language sql
immutable
as $$
  select
    case when p_round = 1 then 2 when p_round = 2 then 3 end,
    case when p_round = 1 then (p_match_number + 1) / 2
         when p_round = 2 then 1 end,
    case when p_round = 1 then (case when p_match_number % 2 = 1 then 'player1' else 'player2' end)
         when p_round = 2 then (case when p_match_number = 1 then 'player1' else 'player2' end) end
  where p_round in (1, 2);
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper: the canonical score pair for a completion (T-INV-4).
--   no_show / forfeit / bye (null source)  → winner gets win_target, loser 0
--   game_over (incl. bot_simulated)         → use the reported pair, but
--                                             validate: both >= 0 and the
--                                             winner's score >= the loser's.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public._tournament_canonical_scores(
  p_winner_id     text,
  p_player1_id    text,
  p_player2_id    text,
  p_winner_source text,
  p_win_target    integer,
  p_reported_p1   integer,
  p_reported_p2   integer
)
returns table (player1_score integer, player2_score integer)
language plpgsql
immutable
as $$
declare
  r1 integer := coalesce(p_reported_p1, 0);
  r2 integer := coalesce(p_reported_p2, 0);
begin
  if p_winner_source is null or p_winner_source in ('no_show', 'forfeit') then
    return query select
      case when p_winner_id is not distinct from p_player1_id then p_win_target else 0 end,
      case when p_winner_id is not distinct from p_player2_id then p_win_target else 0 end;
    return;
  end if;

  -- game_over
  if r1 < 0 or r2 < 0 then
    raise exception 'score_inconsistent' using detail = 'negative score';
  end if;
  if (p_winner_id is not distinct from p_player1_id and r1 < r2)
     or (p_winner_id is not distinct from p_player2_id and r2 < r1) then
    raise exception 'score_inconsistent' using detail = 'winner score below loser';
  end if;
  return query select r1, r2;
end;
$$;

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
      'advanced_to_match_id', null,
      'tournament_completed',  (v_match.round = 3),
      'round_now_complete',    true
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

    -- 4 ── a real game-over cannot originate from a human match that never
    --      started. A fully-bot match auto-resolving from 'ready' is fine.
    if p_winner_source = 'game_over'
       and coalesce(p_status_reason, '') <> 'bot_simulated'
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
      'advanced_to_match_id', null,
      'tournament_completed',  true,
      'round_now_complete',    coalesce(v_round_done, false)
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
    raise exception 'advance_target_missing'
      using detail = format('r%s m%s', v_tgt_round, v_tgt_number);
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
    'advanced_to_match_id', v_tgt_id,
    'advanced_to_slot',     v_tgt_slot,
    'advanced_to_status',   v_tgt_status,
    'tournament_completed',  false,
    'round_now_complete',    coalesce(v_round_done, false)
  );
end;
$$;

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

-- ─────────────────────────────────────────────────────────────────────────────
-- generate_tournament_bracket — create the 7 rows once, atomically (T-INV-8).
--   Seeding (rating sort + bot fill + QF_SEED_PAIRS) stays in Node — it is not
--   the source of any bug and is awkward in SQL. Node passes the fully-resolved
--   QF pairings and the seed list; this function owns:
--     - pg_advisory_xact_lock so two closeRegistrationAndStart calls can't race
--     - idempotent INSERT of 4 QF + 2 empty SF + 1 empty Final
--     - tournament status → in_progress
--     - registrations → 'active' with their seed
--     - bye walkover for any QF with a null slot (calls complete_tournament_match)
--   p_qf_pairs : [{ "match_number":1, "player1_id":"...", "player2_id":null,
--                   "bot_tier":"standard"|null }, ...]  (length 4)
--   p_seeds    : [{ "user_id":"<uuid>", "seed":1 }, ...]  (human registrations)
-- Returns jsonb: { created boolean, matches: [ ...7 match rows... ] }
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.generate_tournament_bracket(
  p_tournament_id uuid,
  p_qf_pairs      jsonb,
  p_seeds         jsonb,
  p_actor         text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing   integer;
  v_created    boolean := false;
  v_pair       jsonb;
  v_seed       jsonb;
  v_qf         scheduled_tournament_matches%rowtype;
  v_win_target integer;
  v_bye_winner text;
begin
  perform pg_advisory_xact_lock(hashtext('tournament_bracket:' || p_tournament_id::text));

  select count(*) into v_existing
    from scheduled_tournament_matches where tournament_id = p_tournament_id;

  if v_existing = 0 then
    v_created := true;
    select coalesce(win_target, 30) into v_win_target
      from scheduled_tournaments where id = p_tournament_id;

    -- 4 quarterfinals
    for v_pair in select * from jsonb_array_elements(p_qf_pairs) loop
      insert into scheduled_tournament_matches
        (tournament_id, round, match_number, player1_id, player2_id, room_code, status, bot_tier)
      values (
        p_tournament_id, 1,
        (v_pair->>'match_number')::int,
        nullif(v_pair->>'player1_id', ''),
        nullif(v_pair->>'player2_id', ''),
        '',
        case when (v_pair->>'player1_id') is null or (v_pair->>'player2_id') is null
             then 'bye' else 'waiting' end,
        nullif(v_pair->>'bot_tier', '')
      )
      on conflict (tournament_id, round, match_number) do nothing;
    end loop;

    -- 2 empty semifinals + 1 empty final
    insert into scheduled_tournament_matches (tournament_id, round, match_number, room_code, status)
    values (p_tournament_id, 2, 1, '', 'waiting'),
           (p_tournament_id, 2, 2, '', 'waiting'),
           (p_tournament_id, 3, 1, '', 'waiting')
    on conflict (tournament_id, round, match_number) do nothing;

    -- registrations → active, with seed
    for v_seed in select * from jsonb_array_elements(p_seeds) loop
      update scheduled_tournament_registrations
         set status = 'active', seed = (v_seed->>'seed')::int
       where tournament_id = p_tournament_id
         and user_id = (v_seed->>'user_id')::uuid;
    end loop;

    update scheduled_tournaments
       set status = 'in_progress'
     where id = p_tournament_id and status <> 'in_progress';

    -- walk over any bye QF (one player vs null)
    for v_qf in
      select * from scheduled_tournament_matches
       where tournament_id = p_tournament_id and round = 1 and status = 'bye'
    loop
      v_bye_winner := coalesce(v_qf.player1_id, v_qf.player2_id);
      if v_bye_winner is not null then
        perform public.complete_tournament_match(
          p_match_id      => v_qf.id,
          p_winner_id     => v_bye_winner,
          p_winner_source => null,
          p_bye_walkover  => true,
          p_actor         => p_actor
        );
      end if;
    end loop;
  end if;

  return jsonb_build_object(
    'created', v_created,
    'matches', coalesce((
      select jsonb_agg(to_jsonb(m) order by m.round, m.match_number)
        from scheduled_tournament_matches m
       where m.tournament_id = p_tournament_id
    ), '[]'::jsonb)
  );
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Lock down EXECUTE: server-only, like every other write path on these tables.
-- ─────────────────────────────────────────────────────────────────────────────
revoke execute on function
  public.complete_tournament_match(uuid, text, text, text, integer, integer, text, text, boolean, text),
  public.promote_tournament_match(uuid, text, timestamptz, timestamptz, text, timestamptz, text),
  public.generate_tournament_bracket(uuid, jsonb, jsonb, text)
  from public, anon, authenticated;

grant execute on function
  public.complete_tournament_match(uuid, text, text, text, integer, integer, text, text, boolean, text),
  public.promote_tournament_match(uuid, text, timestamptz, timestamptz, text, timestamptz, text),
  public.generate_tournament_bracket(uuid, jsonb, jsonb, text)
  to service_role;

-- helpers are internal; no one needs EXECUTE but service_role (via the above).
revoke execute on function
  public._tournament_is_bot(text),
  public._tournament_advance_target(integer, integer),
  public._tournament_canonical_scores(text, text, text, text, integer, integer, integer)
  from public, anon, authenticated;

commit;
