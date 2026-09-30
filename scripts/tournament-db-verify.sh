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
#   5. Registration RPCs (tournament review A2, A7): two sessions racing for
#      the last seat serialize on the tournament row lock and exactly one gets
#      it; registering after registration_close_at is refused; withdraw works
#      before close and is refused, with the row kept, after start.
#   6. generate_tournament_bracket v2 (A1, B8): repairs a partial pre-RPC
#      bracket into all 7 rows in one transaction, is a no-op on retry, and
#      refuses stale seed lists and already-played rows.
#   7. cancel_reason exists (Q9).

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
echo "── 1/7  greenfield apply ─────────────────────────────────────────────"
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
  2026-09-29_tournament_bracket_rpc_repair.sql
  2026-09-29_tournament_cancel_reason.sql
  2026-09-29_tournament_registration_rpcs.sql
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
echo "── 2/7  FOR UPDATE serialization ─────────────────────────────────────"
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
echo "── 3/7  RLS registrations lockdown ──────────────────────────────────"
[[ "$(Q "select count(*) from pg_policies where schemaname='public' and tablename='scheduled_tournament_registrations' and cmd in ('INSERT','UPDATE','DELETE','ALL') and roles && array['anon','authenticated','public']::name[]")" == "0" ]] \
  || fail "a client-writable policy survives on scheduled_tournament_registrations"
[[ "$(Q "select count(*) from information_schema.role_table_grants where table_schema='public' and table_name='scheduled_tournament_registrations' and grantee in ('anon','authenticated','public') and privilege_type in ('INSERT','UPDATE','DELETE')")" == "0" ]] \
  || fail "a client write grant survives on scheduled_tournament_registrations"
[[ "$(Q "select relrowsecurity from pg_class where oid='public.scheduled_tournament_registrations'::regclass")" == "t" ]] \
  || fail "RLS is not enabled on scheduled_tournament_registrations"
pass "0 client-writable policies, 0 client write grants, RLS on"

# ── 6. assert_security_posture() catches a planted violation ───────────────
echo
echo "── 4/7  assert_security_posture() ───────────────────────────────────"
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

# ── 7. registration RPCs: cap, close time, withdraw guard ──────────────────
echo
echo "── 5/7  registration RPCs (A2, A7) ──────────────────────────────────"
RUN -q -f "$HELPERS/phase1_seed.sql" >/dev/null
T_OPEN='22222222-2222-4222-8222-222222222222'      # registration_open, 2 seats, closes in 10 min
T_CLOSED='33333333-3333-4333-8333-333333333333'    # registration_open, but close time already passed
T_STARTED='11111111-1111-4111-8111-111111111111'   # the in_progress bracket from section 2
PA='aaaaaaaa-0000-4000-8000-000000000001'
PB='aaaaaaaa-0000-4000-8000-000000000002'
PC='aaaaaaaa-0000-4000-8000-000000000003'

Q "select public.register_for_tournament('$T_OPEN', '$PA')" | grep -q '"already_registered": false' \
  || fail "first registration did not succeed"
[[ "$(Q "select count(*) from public.scheduled_tournament_registrations where tournament_id='$T_OPEN' and user_id='$PA' and status='registered'")" == "1" ]] \
  || fail "first registration reported success but wrote no row"
pass "first registration takes seat 1 of 2 (row written)"

# Session A takes the last seat and holds its transaction open; session B asks
# for the same last seat and must wait on the tournament row lock, then see the
# committed count and be refused.
"$PGBIN/psql" -X -v ON_ERROR_STOP=1 -h "$SOCKDIR" -p "$PORT" -U postgres -d verify -q >/dev/null 2>&1 <<SQL_LA &
begin;
select public.register_for_tournament('$T_OPEN', '$PB');
select pg_sleep(3);
commit;
SQL_LA
LA_PID=$!
sleep 1.5
LB_START="$(now)"
LB_OUT="$("$PGBIN/psql" -X -h "$SOCKDIR" -p "$PORT" -U postgres -d verify -tAqc \
  "select public.register_for_tournament('$T_OPEN', '$PC')" 2>&1 || true)"
LB_END="$(now)"
wait "$LA_PID"
LB_WAIT="$(python3 -c "print(f'{$LB_END - $LB_START:.2f}')")"
echo "  session B waited ${LB_WAIT}s for session A's lock"
python3 -c "import sys; sys.exit(0 if $LB_WAIT >= 1.0 else 1)" \
  || fail "concurrent last-seat registration did not serialize (waited ${LB_WAIT}s)"
echo "$LB_OUT" | grep -q 'tournament_full' || fail "second claimant of the last seat was not refused — got: $LB_OUT"
[[ "$(Q "select count(*) from public.scheduled_tournament_registrations where tournament_id='$T_OPEN' and status='registered'")" == "2" ]] \
  || fail "seat count is not exactly 2 after the race"
pass "concurrent last seat: B blocked on A's lock, then got tournament_full; 2 of 2 seats taken"

Q "select public.register_for_tournament('$T_OPEN', '$PA')" | grep -q '"already_registered": true' \
  || fail "re-registering an existing entrant on a full event did not report already_registered"
pass "re-register on a full event is idempotent (already_registered)"

OUT="$("$PGBIN/psql" -X -h "$SOCKDIR" -p "$PORT" -U postgres -d verify -tAqc \
  "select public.register_for_tournament('$T_CLOSED', '$PA')" 2>&1 || true)"
echo "$OUT" | grep -q 'registration_closed' || fail "register after registration_close_at was not refused — got: $OUT"
[[ "$(Q "select count(*) from public.scheduled_tournament_registrations where tournament_id='$T_CLOSED'")" == "0" ]] \
  || fail "a row was written despite registration_closed"
pass "register after close time (status still registration_open) -> registration_closed, nothing written"

Q "select public.withdraw_from_tournament('$T_OPEN', '$PB')" | grep -q '"withdrawn": true' \
  || fail "withdraw before close did not remove the registration"
pass "withdraw before close removes the registration"

OUT="$("$PGBIN/psql" -X -h "$SOCKDIR" -p "$PORT" -U postgres -d verify -tAqc \
  "select public.withdraw_from_tournament('$T_STARTED', '00000000-0000-4000-8000-000000000002')" 2>&1 || true)"
echo "$OUT" | grep -q 'withdraw_closed' || fail "withdraw after start was not refused — got: $OUT"
[[ "$(Q "select count(*) from public.scheduled_tournament_registrations where tournament_id='$T_STARTED' and user_id='00000000-0000-4000-8000-000000000002'")" == "1" ]] \
  || fail "withdraw after start deleted the registration"
pass "withdraw after start -> withdraw_closed, registration row kept"

# ── 8. bracket RPC repair ───────────────────────────────────────────────────
echo
echo "── 6/7  generate_tournament_bracket v2 (A1, B8) ─────────────────────"
T_PARTIAL='44444444-4444-4444-8444-444444444444'   # registration_open, 2 entrants, 4 stale QF rows
PAIRS="jsonb_build_array(
  jsonb_build_object('match_number',1,'player1_id','$PB','player2_id','bot:fritz:$T_PARTIAL:8','bot_tier','standard'),
  jsonb_build_object('match_number',2,'player1_id','bot:fritz:$T_PARTIAL:4','player2_id','bot:fritz:$T_PARTIAL:5'),
  jsonb_build_object('match_number',3,'player1_id','bot:fritz:$T_PARTIAL:3','player2_id','bot:fritz:$T_PARTIAL:6'),
  jsonb_build_object('match_number',4,'player1_id','$PA','player2_id','bot:fritz:$T_PARTIAL:7','bot_tier','standard'))"
SEEDS="jsonb_build_array(jsonb_build_object('user_id','$PB','seed',1), jsonb_build_object('user_id','$PA','seed',2))"

OUT="$("$PGBIN/psql" -X -h "$SOCKDIR" -p "$PORT" -U postgres -d verify -tAqc \
  "select public.generate_tournament_bracket('$T_PARTIAL', $PAIRS, jsonb_build_array(jsonb_build_object('user_id','$PB','seed',1)), 'db-verify')" 2>&1 || true)"
echo "$OUT" | grep -q 'registrations_changed' || fail "a seed list missing a registrant was accepted — got: $OUT"
[[ "$(Q "select count(*) from public.scheduled_tournament_matches where tournament_id='$T_PARTIAL'")" == "4" ]] \
  || fail "a refused call changed the stale rows"
pass "stale seed list -> registrations_changed, nothing changed"

R1="$(Q "select public.generate_tournament_bracket('$T_PARTIAL', $PAIRS, $SEEDS, 'db-verify')")"
echo "$R1" | grep -q '"repaired": true' || fail "partial bracket not reported as repaired — got: $R1"
[[ "$(Q "select count(*) from public.scheduled_tournament_matches where tournament_id='$T_PARTIAL'")" == "7" ]] \
  || fail "repair did not leave exactly 7 rows"
[[ "$(Q "select count(*) from public.scheduled_tournament_matches where tournament_id='$T_PARTIAL' and room_code='stale'")" == "0" ]] \
  || fail "stale pre-RPC rows survived the repair"
[[ "$(Q "select status from public.scheduled_tournaments where id='$T_PARTIAL'")" == "in_progress" ]] \
  || fail "repair did not move the tournament to in_progress"
[[ "$(Q "select string_agg(user_id::text || ':' || status || ':' || seed, ',' order by seed) from public.scheduled_tournament_registrations where tournament_id='$T_PARTIAL'")" == "$PB:active:1,$PA:active:2" ]] \
  || fail "registrations not active with the bracket seeds"
pass "4-of-7 partial bracket -> 7 rows, in_progress, registrations active with bracket seeds, one transaction"

R2="$(Q "select public.generate_tournament_bracket('$T_PARTIAL', $PAIRS, $SEEDS, 'db-verify')")"
echo "$R2" | grep -q '"created": false' && echo "$R2" | grep -q '"repaired": false' || fail "retry was not a no-op — got: $R2"
[[ "$(Q "select count(*) from public.scheduled_tournament_matches where tournament_id='$T_PARTIAL'")" == "7" ]] || fail "retry changed the row count"
pass "retry of a finished bracket is a no-op"

T_PLAYED='55555555-5555-4555-8555-555555555555'
OUT="$("$PGBIN/psql" -X -h "$SOCKDIR" -p "$PORT" -U postgres -d verify -tAqc \
  "select public.generate_tournament_bracket('$T_PLAYED', '[]'::jsonb, jsonb_build_array(jsonb_build_object('user_id','$PC','seed',1)), 'db-verify')" 2>&1 || true)"
echo "$OUT" | grep -q 'bracket_partial_conflict' || fail "a played row was overwritten — got: $OUT"
pass "partial state containing a played match -> bracket_partial_conflict"

# ── 9. cancel_reason ─────────────────────────────────────────────────────────
echo
echo "── 7/7  cancel_reason (Q9) ──────────────────────────────────────────"
[[ "$(Q "select count(*) from information_schema.columns where table_schema='public' and table_name='scheduled_tournaments' and column_name='cancel_reason'")" == "1" ]] \
  || fail "scheduled_tournaments.cancel_reason missing"
pass "scheduled_tournaments.cancel_reason exists"

echo
echo "════════════════════════════════════════════════════════════════════════"
echo "  tournament-db-verify: ALL CHECKS PASSED"
echo "════════════════════════════════════════════════════════════════════════"
