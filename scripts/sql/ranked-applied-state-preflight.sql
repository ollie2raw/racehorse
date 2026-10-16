-- READ-ONLY production preflight for 2026-10-16_ranked_applied_state_monotonic.sql.
--
--   psql -X -v ON_ERROR_STOP=1 "$DATABASE_URL" -f scripts/sql/ranked-applied-state-preflight.sql
--
-- Every statement runs inside a READ ONLY transaction that is rolled back. It reports:
--   * the total number of half-set ranked_games rows (applied fields neither all NULL nor all set);
--   * each row: id, owner, source match, shape, and what it does today;
--   * whether the ranked catch-up sweep SELECTS it   (the sweep reads `rating_after IS NULL`);
--   * whether it BLOCKS its owner as a pending predecessor (admit_ranked_rating_context refuses a new game while any
--     game of that owner has `rating_after IS NULL`).
--
-- VERDICT:  GO   -> zero half-set rows: the migration may proceed.
--           STOP -> one or more rows: do NOT apply the migration. Reconcile each row deliberately (rows listed below),
--                   re-run this preflight until it prints GO. The migration itself refuses to run while rows exist.
--
-- Disposition guide
--   pending_shaped (rating_after NULL, rd_after/delta set): selected by catch-up AND blocks the owner. Decide per row:
--       let the sweep apply it (commit_glicko_game_update sets all three together), or, if its rating was already
--       applied out of band, complete rd_after/rating_after/delta in ONE statement from the receipt in rating_periods.
--   applied_shaped (rating_after set, rd_after or delta NULL): not selected, does not block; the new CHECK would
--       freeze it. Complete the missing field(s) in ONE statement (rd_after is read as 350 by the app when NULL).
begin read only;
\pset pager off
\pset null '-'

select count(*) as half_set_rows,
       count(*) filter (where rating_after is null) as pending_shaped,
       count(*) filter (where rating_after is not null) as applied_shaped,
       case when count(*) = 0 then 'GO' else 'STOP - reconcile deliberately; do not apply the migration' end as verdict
from public.ranked_games
where not ((rating_after is null and rd_after is null and delta is null)
        or (rating_after is not null and rd_after is not null and delta is not null));

select g.id,
       g.player_id,
       g.opponent_id,
       g.source_type,
       g.source_match_id,
       g.played_at,
       g.rating_after, g.rd_after, g.delta,
       (g.rating_context is not null) as has_rating_context,
       case when g.rating_after is null then 'pending_shaped' else 'applied_shaped' end as shape,
       (g.rating_after is null) as selected_by_catch_up,
       (g.rating_after is null) as blocks_owner_as_predecessor,
       exists (select 1 from public.rating_periods rp where rp.ranked_game_id = g.id) as has_rating_period_receipt,
       (select count(*) from public.ranked_games o
         where o.player_id = g.player_id and o.rating_after is null and o.id <> g.id) as other_pending_games_for_owner
from public.ranked_games g
where not ((g.rating_after is null and g.rd_after is null and g.delta is null)
        or (g.rating_after is not null and g.rd_after is not null and g.delta is not null))
order by g.played_at, g.id;

-- Context for the operator: everything the catch-up sweep would select today, and the owners it blocks.
select count(*) as all_pending_rows_selected_by_catch_up,
       count(distinct player_id) as owners_with_a_pending_predecessor
from public.ranked_games where rating_after is null;

rollback;
