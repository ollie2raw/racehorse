-- Multiplayer game records (docs/review-game-record-architecture.md, "Multiplayer"; roadmap 3.9).
--
-- A finished multiplayer game is saved once per human participant, next to the Play vs Fritz records, so each player's Games archive can hold it. The deal is
-- not a seed here (a multiplayer deal is random and was never written down), so the explicit hands, the actions and the draw order are stored in `moves`, and
-- the server has already replayed them through the engine before saving: `verification` is replay_verified only if that replay landed on the same scores.
--
-- Two additive changes, nothing else:
--   1. `mode` also accepts 'mp'.
--   2. `opponent_name`: the opponent's display name AS IT WAS in that game, for the archive row ("vs Name"). It is a plain string on purpose, not a
--      reference to an account: a reference to auth.users would have to be nulled on account deletion (see scripts/checkCascadeDeleteCompleteness.ts),
--      and the record itself carries no account or seat id at all (the server relabels both seats "you" and "opponent" before saving).
--
-- Rows written before this migration are untouched. Safe to run more than once. Nothing writes an 'mp' row until the server flag MP_RECORDS_ENABLED is set
-- to "true", which must not happen before this is applied.

alter table public.game_records drop constraint if exists game_records_mode_check;
alter table public.game_records
  add constraint game_records_mode_check check (mode in ('pvf', 'mp'));

alter table public.game_records add column if not exists opponent_name text null;

alter table public.game_records drop constraint if exists game_records_opponent_name_len;
alter table public.game_records
  add constraint game_records_opponent_name_len check (opponent_name is null or char_length(opponent_name) between 1 and 64);

-- Rollback (only if no 'mp' row exists):
-- alter table public.game_records drop constraint if exists game_records_opponent_name_len;
-- alter table public.game_records drop column if exists opponent_name;
-- alter table public.game_records drop constraint if exists game_records_mode_check;
-- alter table public.game_records add constraint game_records_mode_check check (mode in ('pvf'));
