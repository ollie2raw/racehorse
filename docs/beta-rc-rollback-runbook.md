# Beta RC rollback runbook

This runbook applies to the 2026-08-11 controlled-beta candidate. It assumes a
single Render server, a Vercel client, and Supabase. It does not authorize a
production deploy; the release owner must select the deployment and rollback
SHAs.

## Before release

1. Record the candidate SHA and the currently live client and server SHAs.
2. Confirm Vercel and Render are both configured to build the intended branch.
3. Apply the checked-in Supabase ledger before enabling application code that
   depends on it. Verify `/ready` reports Supabase, room logs, Daily Fritz
   authority, and the five-slot puzzle ladder healthy.
4. Keep a Supabase point-in-time recovery/backup boundary for the release.
5. Schedule the server deploy outside a tournament or known active-game window.

## Application rollback

1. Stop new beta traffic or announce a short maintenance window.
2. In Vercel, promote/redeploy the recorded previous client deployment.
3. In Render, roll back/redeploy the recorded previous server SHA. Run one
   instance until multi-instance ownership is explicitly certified.
4. Do not delete `room_live_sessions`; a restarted compatible server uses these
   rows to hydrate active rooms.
5. Verify, in order: `/health`, `/ready`, Daily Puzzle `/today`, Daily Fritz
   `/today`, private-room create/join/action, and restart/rejoin hydration.

## Feature containment

- `DAILY_FRITZ_TRANSACTIONAL_COMMANDS=false` disables new transactional Daily
  Fritz commands. Existing challenge-bound attempts fail closed while disabled;
  they must never fall back to legacy writes.
- `RANKED_GAMES_SOURCE_COLUMNS_ENABLED=false` removes source columns from new
  ranked-game inserts if ranking persistence itself must be contained. This
  reduces idempotency protection and is an incident-only measure.
- Challenge HTTP exposure must remain off unless the pending Challenge branch
  is deliberately included and separately reviewed.

Changing a server environment variable requires a Render redeploy. Record every
flag change and its timestamp.

## Database rollback policy

The candidate migrations are additive or forward-correcting. Leave these
objects in place during an application rollback:

- the production-derived `bot_match_pending` greenfield baseline;
- the ranking greenfield baseline;
- the non-partial unique index on
  `ranked_games(player_id, source_match_id)`;
- Daily Fritz authority/receipt tables;
- durable room session tables.

Do not recreate the old partial ranking index: PostgREST cannot infer it for
`on_conflict=player_id,source_match_id`, and ranked-game persistence fails with
PostgreSQL `42P10`. Do not drop columns/tables while rows written by the
candidate may depend on them. Any schema reversal requires a separate reviewed
forward migration and a verified backup.

## Rollback acceptance checks

- `/ready` is HTTP 200 and all required checks are `ok:true`.
- A duplicate Daily Puzzle submit returns its stored receipt.
- A duplicate Daily Fritz command returns its stored operation receipt.
- A private room persists a move, survives one process restart, preserves both
  seats, and accepts the next move.
- A repeated ranked-game source insert creates exactly one row.
- Server/client Sentry events arrive with the rollback release tag when staging
  DSNs are configured.
