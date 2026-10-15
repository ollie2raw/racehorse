#!/usr/bin/env bash
# Builds the OWNED, DISPOSABLE local database used by the terminal-completion recovery tests from the
# repository's real migrations (not a re-imagined fixture). Refuses anything but a local loopback
# PostgreSQL. Usage: PGHOST=127.0.0.1 PGPORT=55439 PGUSER=postgres setupTerminalCompletionTestDb.sh <dbname>
set -euo pipefail
DB="${1:?database name required}"
case "${PGHOST:-}" in 127.0.0.1|localhost) ;; *) echo "refusing non-loopback PGHOST=${PGHOST:-unset}" >&2; exit 2;; esac
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
M="$ROOT/supabase/migrations"
psql -X -q -v ON_ERROR_STOP=1 -c "drop database if exists \"$DB\"" -c "create database \"$DB\""
ap() {
  local out; out="$(psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$1" 2>&1)" || { echo "$out" | grep -v NOTICE >&2; echo "FAILED: $1" >&2; exit 1; }
}
ap "$ROOT/server/test/fixtures/terminalCompletionBase.sql"
ap "$ROOT/supabase/schema.sql"
for f in \
  "$M/2026-05-12_bot_match_pending_greenfield_baseline.sql" \
  "$M/2026-05-13_matchmaking.sql" \
  "$M/2026-05-14_scheduled_tournaments.sql" \
  "$M/2026-05-16_tournament_match_dispatch_fields.sql" \
  "$M/2026-05-16_tournament_registration_placements.sql" \
  "$M/2026-06-16_ranking_greenfield_baseline.sql" \
  "$M/2026-06-17_ranked_games_source_idempotency.sql" \
  "$M/2026-06-18_ranked_games_source_conflict_target.sql" \
  "$M/2026-06-30_commit_glicko_game_update_rpc.sql" \
  "$M/2026-08-28_ranked_games_outcome.sql" \
  "$M/2026-08-11_authoritative_ranking_and_bot_pending.sql" \
  "$ROOT/supabase/friends.sql" \
  "$M/2026-05-18_social_greenfield_baseline.sql" \
  "$M/2026-08-20_mp_authority_events.sql" \
  "$M/2026-09-01_room_tables_schema_and_grant_lockdown.sql" \
  "$M/2026-09-01_gameover_sideeffect_idempotency.sql" \
  "$M/2026-09-01_commit_glicko_rpc_lockdown.sql" \
  "$M/2026-09-05_matches_insert_guest_only.sql" \
  "$M/2026-08-30_tournament_registration_rls_lockdown.sql" \
  "$M/2026-09-29_tournament_cancel_reason.sql" \
  "$M/2026-10-07_tournament_kind_fritz_cup.sql" \
  "$M/2026-10-05_room_live_session_entries.sql" \
  "$M/2026-08-01_room_command_receipts.sql" \
  "$M/2026-09-01_apply_room_command_receipts_and_mp_authority_events.sql" \
  "$M/2026-10-12_user_reports_and_blocks.sql" \
  "$M/2026-10-13_rating_cutover_gate.sql"; do ap "$f"; done
psql -X -q -d "$DB" -c "update public.rating_cutover_gate set quiesced=true, quiesced_at=now() where id"  # expand migrations require a closed gate
ap "$M/2026-10-13_ranked_rating_claim.sql"
ap "$M/2026-10-15_ranked_rating_context.sql"
ap "$ROOT/supabase/ghost.sql"
ap "$ROOT/supabase/verified_matches.sql"
ap "$M/2026-10-13_ghost_rating_idempotent_completion.sql"
ap "$M/2026-10-13_ghost_cutover_reconciliation.sql"
ap "$M/2026-10-13_ghost_user_match_uniqueness.sql"   # contract step: unique(user_id, match_id), as the remediated server expects
psql -X -q -d "$DB" -c "update public.rating_cutover_gate set quiesced=false where id"
psql -X -q -d "$DB" -c "grant usage on schema public to service_role, anon, authenticated" \
  -c "grant all on all tables in schema public to service_role" \
  -c "grant all on all sequences in schema public to service_role" \
  -c "grant execute on all functions in schema public to service_role" \
  -c "notify pgrst, 'reload schema'"
echo "database $DB ready"
