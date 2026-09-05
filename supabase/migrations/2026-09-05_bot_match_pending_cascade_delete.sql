-- Fixes a live, reproduced bug: DELETE /api/account (account/routes.ts) fails
-- with a raw Postgres 500 for any user who has an unresolved bot_match_pending
-- row (the normal state for up to 30 minutes after starting any local
-- bot/Ghost/Fritz match, per bot-matches/cleanup-stale's own sweep window).
--
-- account/routes.ts's docstring states the deletion model plainly: delete the
-- auth.users row and rely on `on delete cascade` everywhere a table "belongs
-- to a player" -- explicitly naming profiles, friends, ranked_games.player_id,
-- ghost_profiles, daily_fritz_attempts, and Puzzle Rush runs. All of those
-- were spot-checked against their canonical DDL and confirmed correct.
--
-- bot_match_pending is the one table that breaks the model, and the one
-- table in the whole schema shaped this way: its own migration file
-- (2026-05-12_bot_match_pending_greenfield_baseline.sql) says plainly it was
-- "created manually in production... captured from the production catalog"
-- -- an out-of-band table that never got the same treatment as the rest of
-- the schema. Its `user_id` foreign key references public.profiles(id) (not
-- auth.users(id) directly -- that reference target is correct and unchanged
-- here) with no ON DELETE action at all, defaulting to RESTRICT.
--
-- Confirmed before writing this migration that nothing depends on a pending
-- match row surviving account deletion: every reader
-- (shared/fritzMatchLifecycle.ts, http/routes/botMatches.ts's
-- cleanup-stale sweep, index.ts's forfeit-on-disconnect path) only ever
-- queries/patches a row by its own room_code/id, keyed off an active
-- session -- none of them re-derive anything from a pending row after the
-- fact, and there is no audit/billing/analytics use that would need one to
-- outlive the account it belongs to. This matches the docstring's own
-- stated intent (delete everything belonging to the player) rather than
-- fighting it.
--
-- Reproduced the failure live against prod before writing this fix
-- (throwaway user + an unresolved bot_match_pending row + the exact DELETE
-- /auth/v1/admin/users/:id action the account route performs -> 23503).
-- Also reproduced and fixed against a disposable local Postgres 16 instance:
-- the pre-fix schema failed identically, and re-running the delete after
-- this migration's ALTER succeeded cleanly with both the profiles row and
-- the bot_match_pending row actually gone (confirmed by a follow-up count,
-- not just a lack of error).

alter table public.bot_match_pending
  drop constraint if exists bot_match_pending_user_id_fkey;

alter table public.bot_match_pending
  add constraint bot_match_pending_user_id_fkey
  foreign key (user_id) references public.profiles(id) on delete cascade;
