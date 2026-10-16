#!/usr/bin/env bash
# Builds the OWNED, DISPOSABLE local database used by the terminal-completion recovery tests from the
# repository's real migrations (not a re-imagined fixture). Refuses anything but a local loopback
# PostgreSQL. Usage: PGHOST=127.0.0.1 PGPORT=55439 PGUSER=postgres setupTerminalCompletionTestDb.sh <dbname>
set -euo pipefail
DB="${1:?database name required}"
case "${PGHOST:-}" in 127.0.0.1|localhost) ;; *) echo "refusing non-loopback PGHOST=${PGHOST:-unset}" >&2; exit 2;; esac
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
M="$ROOT/supabase/migrations"
psql -X -q -At -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$DB' and pid <> pg_backend_pid()" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -c "drop database if exists \"$DB\"" -c "create database \"$DB\""
# Supabase databases run in UTC. Several room/ranking columns default to timezone('utc', now()), which is a UTC wall-clock
# value reinterpreted in the SESSION time zone; on a developer machine in another zone a raw-SQL insert would land hours in the
# future and be (correctly) ignored by every "older than cutoff" scan. Model production.
psql -X -q -v ON_ERROR_STOP=1 -c "alter database \"$DB\" set timezone to 'UTC'"
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
# Canonical cutover order (docs/ops/senior-audit-rating-rush-cutover.md): Ghost expand, Ghost
# reconciliation, Rush expand, ranked claim, ranked rating context. TERMINAL_TEST_SCHEMA selects
# the schema NEW sees: "pre-contract" (default; exactly what is live when NEW is deployed, BEFORE
# the Rush/Ghost contract migrations) or "post-contract" (adds both contracts).
SCHEMA="${TERMINAL_TEST_SCHEMA:-pre-contract}"
case "$SCHEMA" in pre-contract|post-contract) ;; *) echo "TERMINAL_TEST_SCHEMA must be pre-contract|post-contract" >&2; exit 2;; esac
ap "$ROOT/supabase/ghost.sql"
ap "$ROOT/supabase/verified_matches.sql"
ap "$M/2026-10-13_ghost_rating_idempotent_completion.sql"
ap "$M/2026-10-13_ghost_cutover_reconciliation.sql"
ap "$M/2026-08-20_puzzle_rush.sql"
ap "$M/2026-08-20_puzzle_rush_daily_official.sql"
ap "$M/2026-10-13_puzzle_rush_assignment_and_atomic_completion.sql"
ap "$M/2026-10-13_ranked_rating_claim.sql"
ap "$M/2026-10-15_ranked_rating_context.sql"
ap "$M/2026-10-15_ghost_precontract_deferral.sql"
ap "$M/2026-10-16_room_live_session_monotonic_fence.sql"
ap "$M/2026-10-16_room_live_session_generation_fence.sql"
ap "$M/2026-10-16_ranked_applied_state_monotonic.sql"
if [ "$SCHEMA" = "post-contract" ]; then
  ap "$M/2026-10-13_puzzle_rush_assignment_contract.sql"
  ap "$M/2026-10-13_ghost_user_match_uniqueness.sql"
fi
psql -X -q -d "$DB" -c "update public.rating_cutover_gate set quiesced=false where id"
psql -X -q -d "$DB" -c "grant usage on schema public to service_role, anon, authenticated" \
  -c "grant all on all tables in schema public to service_role" \
  -c "grant all on all sequences in schema public to service_role" \
  -c "grant execute on all functions in schema public to service_role" \
  -c "notify pgrst, 'reload schema'"
echo "database $DB ready ($SCHEMA)"
