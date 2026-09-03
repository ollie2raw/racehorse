-- Legacy League / Legacy Tournament decommission — 2026-09-03
--
-- The weekly round-robin "league" (server/src/league/**,
-- server/src/legacyTournament/**, http/routes/league.ts, the legacy socket
-- handlers tournament:{create,join,add_bot,remove_bot,start}) was retired at the
-- April 2026 architecture overhaul. Confirmed DEAD in prod 2026-09-03:
--   * no writes to any league_* table since 2026-04-29 (fixture_match_results:
--     2026-04-05; league_bots: 2026-04-01); player_league_history: 0 rows;
--     no fixture ever reached status='completed'; no fixtures.live_room_code
--     was ever set.
--   * zero client emitters — no /league/* HTTP call, no legacy tournament:*
--     socket emit anywhere in client/src.
--   * the legacy socket handlers were already gated behind
--     ENABLE_LEGACY_TOURNAMENTS (default false, off in prod).
--
-- The server code (routes, handlers, admin jobs, server/src/league/**,
-- server/src/legacyTournament/**, the gameOverPersistence.ts live-fixture
-- branch, config.enableLegacyTournaments) is removed in the same change as this
-- migration.
--
-- DROP, not archive (contrast with the Daily Puzzle Ladder, which was archived
-- read-only because live server paths still read daily_puzzle_attempts): the
-- league_* tables have ZERO remaining readers after the decommission — nothing
-- in server/src or client/src touches them — and the ~200 rows are abandoned
-- March-April 2026 test-season state with no display surface anywhere.
-- `supabase/league.sql` is preserved in git history if the feature is ever
-- revived. Nothing outside the league_* cluster has an FK into these tables.
--
-- `league.sql` carried no functions, triggers, or views — only tables, indexes
-- and RLS policies, all of which drop with the table.
--
-- Idempotent. Self-asserting. Safe to run more than once.

begin;

-- Leaf-first (FK dependency order); `cascade` is a backstop, not load-bearing.
drop table if exists public.fixture_match_results  cascade;
drop table if exists public.fixtures               cascade;
drop table if exists public.player_league_history  cascade;
drop table if exists public.league_members         cascade;
drop table if exists public.league_bots            cascade;
drop table if exists public.leagues                cascade;

do $$
declare
  leftover text;
begin
  select string_agg(t, ', ') into leftover
  from unnest(array[
    'leagues', 'league_members', 'fixtures', 'fixture_match_results',
    'player_league_history', 'league_bots'
  ]) as t
  where to_regclass('public.' || t) is not null;

  if leftover is not null then
    raise exception 'legacy_league_decommission: table(s) still present: %', leftover;
  end if;

  raise notice 'legacy_league_decommission: all 6 league_* tables dropped';
end $$;

commit;
