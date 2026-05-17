# Racehorse Supabase / DB Debugging Skill

Use this whenever debugging tournaments, registrations, match history, leaderboards, Daily Fritz persistence, social activity, stale recovery, migrations, or any issue where database state may be involved.

## Goal

Debug database-backed issues using real Supabase state instead of guessing.

Many Racehorse bugs are not code-only bugs. They can come from stale rows, bad statuses, old test data, unapplied migrations, check constraints, or mismatched local/prod data.

## Core principles

1. Inspect DB state before guessing.
2. Never blindly update/delete production data.
3. Prefer SELECT first, UPDATE only after confirming.
4. Know table constraints before writing cleanup SQL.
5. Do not assume a status value is allowed.
6. Old test rows can poison recovery and UI state.
7. DB cleanup should be scoped and reversible when possible.
8. Migrations must match code expectations.

## Required audit questions

Before changing DB-related code or running cleanup SQL, answer:

1. Which table(s) are involved?
2. Is this local Supabase or production Supabase?
3. Is the issue stale data, missing data, wrong status, or schema mismatch?
4. Are there check constraints or enum-like status constraints?
5. Which rows are current vs historical?
6. Is the user being pulled into old data by recovery?
7. Is the frontend showing stale DB state correctly or incorrectly?
8. Is a migration needed?
9. Is a one-time cleanup needed?
10. Is the cleanup safe for production?

## Tables to inspect often

Tournament:
- public.scheduled_tournaments
- public.scheduled_tournament_registrations
- public.scheduled_tournament_matches

Matchmaking / multiplayer:
- matchmaking_matches
- public_match_rows if applicable
- match history tables

Daily:
- Daily Fritz tables
- Daily Puzzle / ladder tables

Social:
- activity feed tables
- rival/friend/social tables
- profiles

## Tournament debug queries

Recent active tournaments:

select
  id,
  scheduled_start,
  registration_open_at,
  registration_close_at,
  status,
  winner_id,
  created_at
from public.scheduled_tournaments
where status in ('upcoming', 'registration_open', 'in_progress')
order by scheduled_start desc;

Matches for tournament:

select
  id,
  tournament_id,
  round,
  match_number,
  player1_id,
  player2_id,
  winner_id,
  room_code,
  status,
  ready_at,
  ready_deadline_at,
  started_at,
  completed_at,
  player1_joined_at,
  player2_joined_at,
  winner_source,
  status_reason,
  forfeit_user_id,
  no_show_user_id
from public.scheduled_tournament_matches
where tournament_id = '<TOURNAMENT_ID>'
order by round, match_number;

Registrations for tournament:

select
  tournament_id,
  user_id,
  status,
  registered_at,
  seed,
  placement
from public.scheduled_tournament_registrations
where tournament_id = '<TOURNAMENT_ID>'
order by seed, registered_at;

Future registration timing:

select
  scheduled_start,
  registration_open_at,
  registration_close_at,
  scheduled_start - registration_close_at as close_lead
from public.scheduled_tournaments
where status in ('upcoming', 'registration_open')
  and scheduled_start > now()
order by scheduled_start
limit 10;

## Safe stale tournament cleanup pattern

First SELECT:

select
  id,
  scheduled_start,
  status,
  winner_id
from public.scheduled_tournaments
where status = 'in_progress'
  and scheduled_start < now() - interval '2 hours'
order by scheduled_start;

Then, only if confirmed stale:

update public.scheduled_tournaments
set status = 'cancelled'
where status = 'in_progress'
  and scheduled_start < now() - interval '2 hours'
  and winner_id is null;

Important:
scheduled_tournament_matches may not allow status = 'cancelled'. Check constraints first.

If child match rows need cleanup and cancelled is not allowed:

update public.scheduled_tournament_matches m
set
  status = 'completed',
  status_reason = 'dev_cleanup_cancelled_stale_test',
  completed_at = coalesce(completed_at, now())
from public.scheduled_tournaments t
where m.tournament_id = t.id
  and t.status = 'cancelled'
  and m.status in ('waiting', 'ready', 'in_progress');

## Constraint inspection

Use this before guessing allowed statuses:

select
  conname,
  pg_get_constraintdef(c.oid) as constraint_def
from pg_constraint c
join pg_class t on c.conrelid = t.oid
join pg_namespace n on n.oid = t.relnamespace
where n.nspname = 'public'
  and t.relname = '<TABLE_NAME>';

## Migration rules

If code expects new columns/statuses/tables:
- create migration
- include migration in commit
- update tests
- state whether Supabase needs manual migration
- provide verification query

Never add code that depends on a DB schema change without including the migration.

## Recovery-specific checks

If user is being forced into an old game/tournament, inspect:

1. Current browser localStorage/sessionStorage.
2. scheduled_tournaments with stale in_progress.
3. scheduled_tournament_matches with status ready/in_progress.
4. matches with room_code and completed_at null.
5. registrations with status active/registered/eliminated.
6. /api/tournaments/me output if available.

## Rules for agents

- Never tell the user to paste placeholder IDs like '<TOURNAMENT_ID>' directly.
- Always replace placeholders with actual IDs from SELECT results.
- Never update all rows without a status/time/user filter.
- Never assume cancelled is valid for child match rows.
- Always explain what the SQL will change before giving UPDATE.
- Prefer dev/test cleanup labels in status_reason.
- Do not expose secrets or Supabase keys.

## Final report format

Supabase DB Debug Review

Issue:
...

Tables inspected:
...

Key rows found:
...

Root cause from DB state:
...

SQL run or proposed:
...

Rows affected:
...

Code/migration needed:
...

Risks:
...

Verification query:
...
