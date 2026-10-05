-- C1: remove stored ghost compositeLog copies from verified_single_player_matches
-- (docs/ops/hosting-cost-plan.md §5; PR S2 stops new rows storing them).
--
-- NOT NEEDED NOW (2026-10-04: 33 MB of a 158 MB database). Run only if the
-- §6 size check says so. Paste one block at a time into the SQL editor.
--
-- Safe: completion_result is read only to replay a retried completion, which
-- happens within seconds; rows older than a day are never replayed, and since
-- S2 a replay rebuilds compositeLog from the profile when it's missing.

-- 1. Preview (read-only)
select count(*) as rows_to_compact,
       pg_size_pretty(coalesce(sum(pg_column_size(completion_result)), 0)) as stored_size_now
  from public.verified_single_player_matches
 where completion_result ? 'compositeLog'
   and completed_at < now() - interval '1 day';

-- 2. Compact 100 rows per run; repeat until it reports UPDATE 0
with batch as (
  select match_id
    from public.verified_single_player_matches
   where completion_result ? 'compositeLog'
     and completed_at < now() - interval '1 day'
   limit 100
)
update public.verified_single_player_matches v
   set completion_result = v.completion_result - 'compositeLog'
  from batch
 where v.match_id = batch.match_id;

-- 3. Optional, on its own, at a quiet hour: return the space to the
--    database-size number (locks the table briefly).
-- vacuum full public.verified_single_player_matches;
