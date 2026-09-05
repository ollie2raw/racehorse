-- Fixes a live, reproduced account-deletion bug — the same class as SA-6
-- (2026-09-05_bot_match_pending_cascade_delete.sql), found on Guardrail #6's
-- (ENGINEERING_GUARDRAILS.md §6) first real run against prod.
--
-- account/routes.ts deletes the auth.users row and relies entirely on
-- database-level ON DELETE behavior — there is no application-level cleanup.
-- Its own docstring asserts that ghost_profiles cascades and that
-- matches.winner_user_id / loser_user_id are ON DELETE SET NULL. Both claims
-- are WRONG in prod: list_cascade_delete_manifest() (the new Guardrail #6 RPC)
-- reports all four constraints below as confdeltype 'a' (NO ACTION), which
-- blocks the delete exactly as RESTRICT would.
--
-- The canonical reference files (supabase/ghost.sql, supabase/schema.sql) DO
-- say "on delete cascade" / "on delete set null" — so this is reference-file
-- drift: those files were written aspirationally and the applied DDL never
-- matched them. SA-6's own migration comment even says ghost_profiles "was
-- spot-checked against canonical DDL and confirmed correct" — against the
-- reference file, not the live catalog. That is precisely the gap Guardrail
-- #6 closes.
--
--   ghost_games.user_id     -> CASCADE   (407 live rows). Ghost is single-
--   ghost_profiles.user_id  -> CASCADE   (52 live rows).  player vs the AI;
--     a ghost game record and a ghost rating profile are the player's own
--     data, with no other human whose history they protect. Cascade matches
--     ghost.sql's stated intent and the ownership semantics of every sibling
--     table (ghost_games has no inbound FKs, so nothing ripples).
--
--   matches.winner_user_id  -> SET NULL  (87 live rows, both columns
--   matches.loser_user_id   -> SET NULL   nullable). A completed PvP match is
--     a historical result record shared with the opponent — the opponent's
--     match history must survive one player deleting their account. This is
--     the exact behavior account/routes.ts's docstring, schema.sql, and
--     System 11's ratified SA-INV set (HARDENING_PLAN.md D-20) all already
--     describe; this migration only makes prod match it. matches has no
--     inbound FKs. supabase/cascade-delete-allowlist.json records these two
--     as the deliberate exceptions (confdeltype "n").
--
-- Reproduced the failure live against prod before writing this: throwaway
-- user + one ghost_games row + the exact DELETE /auth/v1/admin/users/:id the
-- account route performs -> HTTP 500, code 23503, "violates foreign key
-- constraint ghost_games_user_id_fkey". Removing the ghost_games row let the
-- same delete succeed (HTTP 200), then verified the user was gone.
-- pg16-verified: pre-fix schema fails identically; post-ALTER, a delete of a
-- referenced user cascades ghost_* rows away and nulls the matches columns,
-- with the rows/nulls confirmed by follow-up query, not just absence of error.

alter table public.ghost_games
  drop constraint if exists ghost_games_user_id_fkey;
alter table public.ghost_games
  add constraint ghost_games_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.ghost_profiles
  drop constraint if exists ghost_profiles_user_id_fkey;
alter table public.ghost_profiles
  add constraint ghost_profiles_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.matches
  drop constraint if exists matches_winner_user_id_fkey;
alter table public.matches
  add constraint matches_winner_user_id_fkey
  foreign key (winner_user_id) references auth.users(id) on delete set null;

alter table public.matches
  drop constraint if exists matches_loser_user_id_fkey;
alter table public.matches
  add constraint matches_loser_user_id_fkey
  foreign key (loser_user_id) references auth.users(id) on delete set null;
