-- Tournament v2 preflight, piece A: internal helpers
-- Source: supabase/migrations/2026-08-31_tournament_match_rpcs.sql (verbatim; generate_tournament_bracket deliberately excluded).
-- Safe to re-run: create or replace + idempotent grants. Paste the whole block into the Supabase SQL editor.

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

revoke execute on function
  public._tournament_is_bot(text),
  public._tournament_advance_target(integer, integer),
  public._tournament_canonical_scores(text, text, text, text, integer, integer, integer)
  from public, anon, authenticated;

commit;
