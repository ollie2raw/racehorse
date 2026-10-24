-- Apply only after the server release using complete_ghost_rating_v2 is live.
-- The previous server's PostgREST on_conflict=match_id requires the global
-- uniqueness constraint. Once it is gone, two players in one match can each
-- retain a Ghost game row under the per-user unique index installed earlier.
begin;

-- Hard stop: the contract is irreversible for the old server. Refuse while any
-- Ghost/Fritz handoff partial is unresolved, and require the gate to be open
-- again only after the new server owns completions (gate state is not checked
-- here; the runbook's observation step is).
select public.ghost_cutover_assert_reconciled();

alter table public.ghost_games drop constraint if exists ghost_games_match_id_unique;
alter table public.ghost_games drop constraint if exists ghost_games_match_id_key;

commit;
