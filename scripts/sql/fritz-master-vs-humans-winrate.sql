-- D3 (oracle-strength-validation, 2026-09-19): READ-ONLY aggregate query.
-- Fritz Master's real win rate and game count vs rated human opponents,
-- broken down by human rating band.
--
-- DO NOT RUN THIS AGAINST PRODUCTION. This file is a deliverable to hand to
-- a human for review/execution -- it is not invoked by any script or CI job
-- in this repo. No PII is selected (no usernames, emails, or player_id
-- values are returned -- only aggregates).
--
-- Schema basis (read from actual migrations, not assumed):
--   supabase/migrations/2026-06-16_ranking_greenfield_baseline.sql (base
--     table: player_id, opponent_id, player_score, opponent_score,
--     game_type, played_at, rating_before, rd_before, rating_after, rd_after,
--     delta; plus profiles.glicko_rating et al.)
--   supabase/migrations/2026-08-28_ranked_games_outcome.sql (adds `outcome`
--     text: 'win'|'loss'|'draw' from player_id's point of view; authoritative
--     over the score comparison when non-null -- forfeits, for example,
--     aren't decided by the scoreboard.)
--
-- IMPORTANT tier-encoding finding (read the code, don't assume): the
-- `game_type` check constraint only allows
-- ('multiplayer','fritz','fritz_rookie','fritz_standard','fritz_elite') --
-- there is NO 'fritz_master' value. Despite that, every Fritz tier
-- (including Master and the unshipped Grandmaster) is actually written with
-- the single legacy value game_type = 'fritz'
-- (server/src/shared/fritzMatchLifecycle.ts:135-142,
-- getFritzIdentityForTier). Tier is instead distinguished by which
-- synthetic bot identity landed in `opponent_id`
-- (server/src/ranking/glicko2.ts:7-11):
--   Fritz Rookie      = 00000000-0000-0000-0000-000000000002
--   Fritz Standard    = 00000000-0000-0000-0000-000000000003
--   Fritz Elite       = 00000000-0000-0000-0000-000000000001
--   Fritz Master      = 00000000-0000-0000-0000-000000000004
--   Fritz Grandmaster = 00000000-0000-0000-0000-000000000005 (not wired
--     into fritzConfig.ts / chooseBotMove as a real live tier per
--     docs/fritz-difficulty-tiers-source-of-truth-audit.md -- included
--     below only so a human reviewer can confirm it really has zero rows)
--
-- Every `ranked_games` row belongs to the HUMAN's perspective (player_id is
-- always the human; opponent_id is the bot). So "Fritz Master's win rate" is
-- the complement of the human's outcome: Fritz won when the human's
-- outcome/derived-result is 'loss'.
--
-- Access note: ranked_games RLS (supabase/policy-manifest.json) restricts
-- SELECT to `auth.uid() = player_id`; a cross-player aggregate like this one
-- requires an appropriately authorized database-owner SQL session, not an
-- authenticated/anon client query. Human-run only: do not load service-role
-- credentials or execute this query through an agent.

with fritz_master_games as (
  select
    rg.rating_before,
    rg.player_score,
    rg.opponent_score,
    rg.outcome
  from public.ranked_games rg
  where rg.opponent_id = '00000000-0000-0000-0000-000000000004' -- Fritz Master only
    and rg.game_type = 'fritz'
),
resolved as (
  select
    rating_before,
    -- outcome is authoritative when set (e.g. forfeits); otherwise derive
    -- the human's result from the score comparison, per
    -- 2026-08-28_ranked_games_outcome.sql's own documented fallback rule.
    coalesce(
      outcome,
      case
        when player_score > opponent_score then 'win'
        when player_score < opponent_score then 'loss'
        else 'draw'
      end
    ) as human_result
  from fritz_master_games
),
banded as (
  select
    -- 200-point Glicko rating bands anchored at zero (for example 1400-1599).
    -- Adjust band width here if a human reviewer wants finer/coarser cuts.
    floor(rating_before / 200.0) * 200 as rating_band_floor,
    human_result
  from resolved
)
select
  rating_band_floor as human_rating_band_start,
  rating_band_floor + 199 as human_rating_band_end,
  count(*) as games,
  count(*) filter (where human_result = 'loss') as fritz_master_wins,
  count(*) filter (where human_result = 'win') as fritz_master_losses,
  count(*) filter (where human_result = 'draw') as draws,
  round(
    100.0 * count(*) filter (where human_result = 'loss') / nullif(count(*), 0),
    1
  ) as fritz_master_win_rate_pct
from banded
group by rating_band_floor
order by rating_band_floor;

-- Overall (unbanded) summary, for a single headline number alongside the
-- per-band breakdown above:
--
-- select
--   count(*) as games,
--   count(*) filter (where human_result = 'loss') as fritz_master_wins,
--   count(*) filter (where human_result = 'win') as fritz_master_losses,
--   count(*) filter (where human_result = 'draw') as draws,
--   round(100.0 * count(*) filter (where human_result = 'loss') / nullif(count(*), 0), 1)
--     as fritz_master_win_rate_pct
-- from (
--   select
--     coalesce(
--       outcome,
--       case
--         when player_score > opponent_score then 'win'
--         when player_score < opponent_score then 'loss'
--         else 'draw'
--       end
--     ) as human_result
--   from public.ranked_games
--   where opponent_id = '00000000-0000-0000-0000-000000000004'
--     and game_type = 'fritz'
-- ) t;
