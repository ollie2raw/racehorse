#!/usr/bin/env bash
#
# tournament-db-verify.sh — local-only verification of the tournament DB layer.
#
# LOCAL ONLY. This script spins its OWN throwaway PostgreSQL 16 instance in a
# temp directory, does everything against that, and deletes it on exit. It has
# NO code path that reads server/.env, client/.env, SUPABASE_URL,
# VITE_SUPABASE_URL, or any postgres:// / *.supabase.co connection string, and
# it aborts if one is present in the environment or arguments. Nothing here can
# reach production.
#
# It is NOT run in CI (there is no Postgres service and no migration runner —
# that gap is exactly why this exists as a manual check). See
# docs/ops/tournament-db-verify.md.
#
# What it proves:
#   1. Greenfield apply — the curated tournament migration chain applies
#      cleanly, in order, to a fresh pg16 (the 2026-08-30 RLS lockdown
#      self-asserts as part of this).
#   2. FOR UPDATE serialization — two concurrent complete_tournament_match()
#      calls on the same match row serialize: the second blocks until the first
#      commits, then takes the idempotent/conflict branch. Guards against the
#      T-3/T-4 double-advancement / wrong-champion / un-eliminated-loser bug
#      recurring if the row lock is ever weakened.
#   3. RLS registrations lockdown — the three diagnostics come back clean on
#      the freshly-migrated schema.
#   4. assert_security_posture() catches a planted RLS violation.

set -euo pipefail

# ── 0. refuse to run anywhere near a remote / Supabase target ────────────────
for var in PGHOST PGHOSTADDR PGURL PGURI DATABASE_URL SUPABASE_URL SUPABASE_DB_URL VITE_SUPABASE_URL; do
  val="${!var:-}"
  if [[ -n "$val" && "$val" == *supabase* ]] || [[ -n "$val" && "$val" == *"://"* ]]; then
    echo "ABORT: \$$var is set to a remote target ('$val'). This script is local-only." >&2
    exit 2
  fi
done
for arg in "$@"; do
  if [[ "$arg" == *supabase* || "$arg" == *"://"* ]]; then
    echo "ABORT: argument '$arg' looks like a remote connection target. Local-only." >&2
    exit 2
  fi
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS="$REPO_ROOT/supabase/migrations"
HELPERS="$REPO_ROOT/scripts/tournament-db-verify"

# ── 1. locate a pg16 toolchain ──────────────────────────────────────────────
PGBIN=""
for c in \
  "$(command -v pg_ctl || true)" \
  /opt/homebrew/opt/postgresql@16/bin/pg_ctl \
  /usr/local/opt/postgresql@16/bin/pg_ctl \
  /usr/lib/postgresql/16/bin/pg_ctl; do
  if [[ -x "$c" ]] && "$c" --version 2>/dev/null | grep -q ' 16'; then
    PGBIN="$(dirname "$c")"; break
  fi
done
if [[ -z "$PGBIN" ]]; then
  echo "ABORT: PostgreSQL 16 not found. brew install postgresql@16 (see docs/ops/tournament-db-verify.md)." >&2
  exit 3
fi
echo "pg16 toolchain: $PGBIN"

# ── 2. throwaway instance in a temp dir ─────────────────────────────────────
WORK="$(mktemp -d "${TMPDIR:-/tmp}/rh-dbverify.XXXXXX")"
PGDATA="$WORK/data"
SOCKDIR="$WORK/sock"
PORT=$(( 20000 + RANDOM % 20000 ))
mkdir -p "$SOCKDIR"

cleanup() {
  set +e
  "$PGBIN/pg_ctl" -D "$PGDATA" -m immediate stop >/dev/null 2>&1
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "initdb -> $PGDATA (port $PORT, socket $SOCKDIR)"
"$PGBIN/initdb" -D "$PGDATA" -U postgres --auth=trust --no-sync -E UTF8 >/dev/null
"$PGBIN/pg_ctl" -D "$PGDATA" -o "-p $PORT -k $SOCKDIR -c listen_addresses=''" -w start >/dev/null

PSQL=( "$PGBIN/psql" -X -v ON_ERROR_STOP=1 -h "$SOCKDIR" -p "$PORT" -U postgres -d verify )
RUN() { "${PSQL[@]}" "$@"; }
Q()   { "${PSQL[@]}" -tAqc "$1"; }

"$PGBIN/createdb" -h "$SOCKDIR" -p "$PORT" -U postgres verify

pass() { echo "  PASS  $1"; }
fail() { echo "  FAIL  $1" >&2; exit 1; }

# ── 3. shim + curated migration chain (greenfield apply) ────────────────────
echo
echo "── 1/4  greenfield apply ─────────────────────────────────────────────"
RUN -q -f "$HELPERS/shim.sql" >/dev/null
pass "Supabase shim (auth schema, roles, auth.uid)"

CHAIN=(
  2026-05-14_scheduled_tournaments.sql
  2026-05-14_auto_seed_tournaments.sql
  2026-05-16_tournament_cadence_30_minutes.sql
  2026-05-16_tournament_match_dispatch_fields.sql
  2026-05-16_tournament_registration_placements.sql
  2026-05-16_zz_tournament_bot_fill.sql
  2026-05-17_tournament_registration_close_2_minutes.sql
  2026-08-30_tournament_registration_rls_lockdown.sql
  2026-08-31_tournament_match_rpcs.sql
  2026-09-01_assert_security_posture_rpc.sql
)
for m in "${CHAIN[@]}"; do
  [[ -f "$MIGRATIONS/$m" ]] || fail "migration missing from repo: $m"
  if ! RUN -q -f "$MIGRATIONS/$m" >/dev/null 2>"$WORK/err"; then
    echo "---- $m ----" >&2; cat "$WORK/err" >&2
    fail "migration failed to apply: $m"
  fi
  pass "$m"
done
pass "2026-08-30 lockdown self-assertion did not roll back"

# ── 4. two-session FOR UPDATE serialization ─────────────────────────────────
echo
echo "── 2/4  FOR UPDATE serialization ─────────────────────────────────────"
RUN -q -f "$HELPERS/seed.sql" >/dev/null
QF1="$(Q "select id from public.scheduled_tournament_matches where tournament_id='11111111-1111-4111-8111-111111111111' and round=1 and match_number=1")"
[[ -n "$QF1" ]] || fail "seed did not produce QF1"
pass "seeded 8-player bracket; QF1 = $QF1 (in_progress)"

now() { python3 -c 'import time; print(time.time())'; }

# Session A: complete QF1 as u1, then hold the transaction open ~3s before COMMIT.
"$PGBIN/psql" -X -v ON_ERROR_STOP=1 -h "$SOCKDIR" -p "$PORT" -U postgres -d verify -q >/dev/null 2>&1 <<SQL_A &
begin;
select public.complete_tournament_match('$QF1'::uuid, '00000000-0000-4000-8000-000000000001', 'game_over', null, 30, 10, null, null, false, 'session-A');
select pg_sleep(3);
commit;
SQL_A
A_PID=$!

sleep 1.5   # head start: session A's RPC finishes and it is sitting in pg_sleep(3), holding the row lock
# Session B: try to complete the SAME match as a DIFFERENT winner (u8). Should block on A's row lock.
B_START="$(now)"
B_RESULT="$("$PGBIN/psql" -X -v ON_ERROR_STOP=1 -h "$SOCKDIR" -p "$PORT" -U postgres -d verify -tAqc \
  "select public.complete_tournament_match('$QF1'::uuid, '00000000-0000-4000-8000-000000000008', 'game_over', null, 30, 20, null, null, false, 'session-B')")"
B_END="$(now)"
wait "$A_PID"

B_WAIT="$(python3 -c "print(f'{$B_END - $B_START:.2f}')")"
echo "  session B blocked for ${B_WAIT}s (session A held the row lock for ~1.5s more after B started)"
python3 -c "import sys; sys.exit(0 if $B_WAIT >= 1.0 else 1)" \
  || fail "session B did not block on session A's row lock (waited ${B_WAIT}s, expected >= 1s) — FOR UPDATE not serializing"
pass "session B blocked until session A committed"

echo "$B_RESULT" | grep -q '"applied" *: *false' || fail "session B result was not applied:false — got: $B_RESULT"
echo "$B_RESULT" | grep -q '"conflict" *: *true'  || fail "session B result did not report conflict:true — got: $B_RESULT"
echo "$B_RESULT" | grep -q '00000000-0000-4000-8000-000000000001' || fail "session B did not see u1 (session A's winner) as recorded — got: $B_RESULT"
pass "session B took the idempotent/conflict branch (recorded winner = u1, applied:false, conflict:true)"

# Bracket must reflect exactly one completion + one advancement.
[[ "$(Q "select count(*) from public.scheduled_tournament_matches where tournament_id='11111111-1111-4111-8111-111111111111' and round=1 and match_number=1 and status='completed' and winner_id='00000000-0000-4000-8000-000000000001'")" == "1" ]] \
  || fail "QF1 is not exactly one completed row with winner u1"
[[ "$(Q "select player1_id from public.scheduled_tournament_matches where tournament_id='11111111-1111-4111-8111-111111111111' and round=2 and match_number=1")" == "00000000-0000-4000-8000-000000000001" ]] \
  || fail "SF1.player1 is not u1 — advancement wrong or doubled"
[[ "$(Q "select status from public.scheduled_tournament_registrations where tournament_id='11111111-1111-4111-8111-111111111111' and user_id='00000000-0000-4000-8000-000000000008'")" == "eliminated" ]] \
  || fail "loser u8 not eliminated"
[[ "$(Q "select status from public.scheduled_tournament_registrations where tournament_id='11111111-1111-4111-8111-111111111111' and user_id='00000000-0000-4000-8000-000000000001'")" != "eliminated" ]] \
  || fail "winner u1 wrongly eliminated"
pass "bracket consistent: one completion, one advancement, loser eliminated once"

# ── 5. RLS registrations lockdown diagnostics ──────────────────────────────
echo
echo "── 3/4  RLS registrations lockdown ──────────────────────────────────"
[[ "$(Q "select count(*) from pg_policies where schemaname='public' and tablename='scheduled_tournament_registrations' and cmd in ('INSERT','UPDATE','DELETE','ALL') and roles && array['anon','authenticated','public']::name[]")" == "0" ]] \
  || fail "a client-writable policy survives on scheduled_tournament_registrations"
[[ "$(Q "select count(*) from information_schema.role_table_grants where table_schema='public' and table_name='scheduled_tournament_registrations' and grantee in ('anon','authenticated','public') and privilege_type in ('INSERT','UPDATE','DELETE')")" == "0" ]] \
  || fail "a client write grant survives on scheduled_tournament_registrations"
[[ "$(Q "select relrowsecurity from pg_class where oid='public.scheduled_tournament_registrations'::regclass")" == "t" ]] \
  || fail "RLS is not enabled on scheduled_tournament_registrations"
pass "0 client-writable policies, 0 client write grants, RLS on"

# ── 6. assert_security_posture() catches a planted violation ───────────────
echo
echo "── 4/4  assert_security_posture() ───────────────────────────────────"
[[ "$(Q "select assert_security_posture()->>'hard_fail_count'")" == "0" ]] \
  || fail "assert_security_posture() reports a hard failure on a clean schema"
pass "clean schema -> hard_fail_count = 0"

RUN -qc "alter table public.scheduled_tournament_matches disable row level security" >/dev/null
PLANTED="$(Q "select assert_security_posture()")"
RUN -qc "alter table public.scheduled_tournament_matches enable row level security" >/dev/null

echo "$PLANTED" | grep -q '"hard_fail_count" *: *1' || fail "planted RLS-off violation not caught (got: $PLANTED)"
echo "$PLANTED" | grep -q 'scheduled_tournament_matches' || fail "planted violation did not name the table"
echo "$PLANTED" | grep -q 'rls_disabled' || fail "planted violation not classified rls_disabled"
pass "planted 'RLS disabled' -> hard_fail_count = 1, names public.scheduled_tournament_matches"
[[ "$(Q "select assert_security_posture()->>'hard_fail_count'")" == "0" ]] || fail "re-enable did not clear the violation"
pass "re-enable -> hard_fail_count = 0"

echo
echo "════════════════════════════════════════════════════════════════════════"
echo "  tournament-db-verify: ALL CHECKS PASSED"
echo "════════════════════════════════════════════════════════════════════════"
