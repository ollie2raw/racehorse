#!/usr/bin/env bash
# Builds the OWNED, DISPOSABLE local database used by the account-identity RLS suite from EVERY
# supabase/*.sql and supabase/migrations/*.sql in the repository (the whole client-reachable surface), with
# Supabase's default table privileges (anon/authenticated get ALL on new public tables) so that RLS and the
# migrations' explicit REVOKEs are the only barrier — exactly the production posture.
# Refuses anything but a local loopback PostgreSQL.
# Usage: PGHOST=127.0.0.1 PGPORT=55439 PGUSER=postgres setupIdentityAuditDb.sh <dbname>
set -euo pipefail
DB="${1:?database name required}"
case "${PGHOST:-}" in 127.0.0.1|localhost) ;; *) echo "refusing non-loopback PGHOST=${PGHOST:-unset}" >&2; exit 2;; esac
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
S="$ROOT/supabase"; M="$S/migrations"
psql -X -q -At -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$DB' and pid <> pg_backend_pid()" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -c "drop database if exists \"$DB\"" -c "create database \"$DB\""
ap() { local out; out="$(psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$1" 2>&1)" || { echo "$out" | grep -v NOTICE >&2; echo "FAILED: $1" >&2; exit 1; }; }
ap "$ROOT/server/test/fixtures/terminalCompletionBase.sql"
ap "$S/schema.sql"
for f in friends daily_puzzle daily_puzzle_v2 daily_puzzle_ladder_v1 daily_fritz fritz_challenges ghost room_live_sessions room_match_logs room_command_receipts verified_matches; do ap "$S/$f.sql"; done
# The expand/contract migrations are guarded by the rating cutover gate: create it first, close it, apply
# everything in file order, then reopen (the state a fully migrated database is left in).
ap "$M/2026-05-14_scheduled_tournaments.sql"
ap "$M/2026-10-13_rating_cutover_gate.sql"
psql -X -q -d "$DB" -c "update public.rating_cutover_gate set quiesced=true, quiesced_at=now() where id"
for f in "$M"/*.sql; do ap "$f"; done
psql -X -q -d "$DB" -c "update public.rating_cutover_gate set quiesced=false where id"
psql -X -q -d "$DB" -c "grant usage on schema public to service_role, anon, authenticated" \
  -c "grant all on all tables in schema public to service_role" \
  -c "grant all on all sequences in schema public to service_role" \
  -c "grant execute on all functions in schema public to service_role" >/dev/null
echo "database $DB ready (identity audit)"
