-- Apply only after the server release using complete_ghost_rating_v2 is live.
-- The previous server's PostgREST on_conflict=match_id requires the global
-- uniqueness constraint. Once it is gone, two players in one match can each
-- retain a Ghost game row under the per-user unique index installed earlier.
begin;

alter table public.ghost_games drop constraint if exists ghost_games_match_id_unique;
alter table public.ghost_games drop constraint if exists ghost_games_match_id_key;

commit;
