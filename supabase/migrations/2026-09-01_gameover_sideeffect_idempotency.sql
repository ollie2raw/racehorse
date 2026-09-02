-- Game-over side-effect idempotency (MP-G4, HARDENING_PLAN.md §2.4.4).
--
-- persistGameOverOnce re-runs its whole side-effect sequence from step 1 on
-- every retry (up to 4x). Steps that run before the ranked-insert gate were
-- not idempotent, so a transient failure downstream double-wrote:
--   * public.matches           <- recordPublicOnlineMatch (read-then-write, no constraint)
--   * public.activity_feed     <- writeMatchActivity (no key at all)
--
-- Fix (mirrors ranked_games' 2026-06-17 source-idempotency): a stable key
-- derived from room.matchId + a partial unique index, and the server inserts
-- with `resolution=ignore-duplicates`. appendMatch (local JSONL file) and
-- recordMatchEnd (conditional PATCH) are handled in code, no schema.
--
-- Self-asserting: raises unless both indexes exist and are UNIQUE.
--
-- Applied to prod 2026-09-01 (SQL editor); self-assert passed. The unique index
-- on matches built without error => public.matches had no duplicate
-- metadata->>'roomMatchId' values (the pre-fix double-write never occurred).

begin;

-- ---------------------------------------------------------------------------
-- public.matches  <- recordPublicOnlineMatch
-- Key: metadata->>'roomMatchId' (already written by recordPublicOnlineMatch).
-- ---------------------------------------------------------------------------

create unique index if not exists matches_room_match_id_uidx
  on public.matches ((metadata->>'roomMatchId'))
  where (metadata->>'roomMatchId') is not null;

-- ---------------------------------------------------------------------------
-- public.activity_feed  <- writeMatchActivity / writeForfeitActivity
-- Key: "<sourceMatchId>:<userId>:<type>" (one row per side per match).
-- Nullable column so puzzle/streak/daily-fritz activity (no natural key) is
-- unconstrained and unchanged.
-- ---------------------------------------------------------------------------

alter table public.activity_feed
  add column if not exists dedupe_key text;

create unique index if not exists activity_feed_dedupe_key_uidx
  on public.activity_feed (dedupe_key)
  where dedupe_key is not null;

-- ---------------------------------------------------------------------------
-- self-assert
-- ---------------------------------------------------------------------------

do $$
declare
  ix record;
  expected text[] := array['matches_room_match_id_uidx', 'activity_feed_dedupe_key_uidx'];
  name text;
begin
  foreach name in array expected loop
    select i.indisunique, i.indpred is not null as partial
      into ix
      from pg_class c
      join pg_index i on i.indexrelid = c.oid
     where c.relname = name;

    if not found then
      raise exception 'idempotency migration failed: index % missing', name;
    end if;
    if not ix.indisunique then
      raise exception 'idempotency migration failed: index % is not UNIQUE', name;
    end if;
    if not ix.partial then
      raise exception 'idempotency migration failed: index % is not partial (WHERE ... IS NOT NULL)', name;
    end if;
  end loop;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'activity_feed' and column_name = 'dedupe_key'
  ) then
    raise exception 'idempotency migration failed: activity_feed.dedupe_key missing';
  end if;

  raise notice 'game-over side-effect idempotency: matches + activity_feed unique keys in place';
end $$;

commit;
