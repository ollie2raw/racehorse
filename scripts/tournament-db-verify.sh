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
#   8. M1 (Phase 2B): tournament kind + Fritz Cup owner constraints; the seed
#      functions still write Live Events; start_fritz_cup creates one cup + the
#      owner registration, is idempotent, serializes per user, survives
#      scheduled_start collisions, enforces the cooldown and daily limit; the
#      per-user overlap lock refuses conflicting holds in both directions
#      (including a real two-session race) and Fritz Cups are not registerable.
#   9. Pre-start cancellation (Phase 2B.1): the server's conditional cancel
#      (PATCH ...&status=in.(upcoming,registration_open), i.e. UPDATE ... WHERE
#      status IN (...)) races generate_tournament_bracket in both orders: a
#      started tournament is never cancelled, a cancelled one is never started;
#      the old unconditional update is shown overwriting a started tournament;
#      empty events are still cancelled; terminal / started rows are untouched.

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

HARNESS_COMPLETED=0
cleanup() {
  local rc=$?
  set +e
  "$PGBIN/pg_ctl" -D "$PGDATA" -m immediate stop >/dev/null 2>&1
  rm -rf "$WORK"
  # Under macOS bash 3.2 with `set -e`, an abort by `set -u` (an unbound
  # variable) reaches this trap with $? = 0 and the script would exit 0. Any
  # exit before the final banner is a failure.
  if [[ "$HARNESS_COMPLETED" != 1 && "$rc" -eq 0 ]]; then
    echo "  FAIL  harness stopped before completing (shell error above)" >&2
    rc=1
  fi
  exit "$rc"
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
echo "── 1/14  greenfield apply ─────────────────────────────────────────────"
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
  2026-10-07_tournament_kind_fritz_cup.sql
  2026-10-08_tournament_orchestrator_cas.sql
  2026-10-08_tournament_orchestrator_lease.sql
  2026-10-09_tournament_completion_guard.sql
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
echo "── 2/14  FOR UPDATE serialization ─────────────────────────────────────"
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
echo "── 3/14  RLS registrations lockdown ──────────────────────────────────"
[[ "$(Q "select count(*) from pg_policies where schemaname='public' and tablename='scheduled_tournament_registrations' and cmd in ('INSERT','UPDATE','DELETE','ALL') and roles && array['anon','authenticated','public']::name[]")" == "0" ]] \
  || fail "a client-writable policy survives on scheduled_tournament_registrations"
[[ "$(Q "select count(*) from information_schema.role_table_grants where table_schema='public' and table_name='scheduled_tournament_registrations' and grantee in ('anon','authenticated','public') and privilege_type in ('INSERT','UPDATE','DELETE')")" == "0" ]] \
  || fail "a client write grant survives on scheduled_tournament_registrations"
[[ "$(Q "select relrowsecurity from pg_class where oid='public.scheduled_tournament_registrations'::regclass")" == "t" ]] \
  || fail "RLS is not enabled on scheduled_tournament_registrations"
pass "0 client-writable policies, 0 client write grants, RLS on"

# ── 6. assert_security_posture() catches a planted violation ───────────────
echo
echo "── 4/14  assert_security_posture() ───────────────────────────────────"
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
echo "── 5/14  registration RPCs (A2, A7) ──────────────────────────────────"
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
echo "── 6/14  generate_tournament_bracket v2 (A1, B8) ─────────────────────"
T_PARTIAL='44444444-4444-4444-8444-444444444444'   # registration_open, 2 entrants, 4 stale QF rows
PD='aaaaaaaa-0000-4000-8000-000000000004'           # its entrants (own users: see phase1_seed.sql)
PE='aaaaaaaa-0000-4000-8000-000000000005'
PF='aaaaaaaa-0000-4000-8000-000000000006'           # the played fixture's entrant
PAIRS="jsonb_build_array(
  jsonb_build_object('match_number',1,'player1_id','$PE','player2_id','bot:fritz:$T_PARTIAL:8','bot_tier','standard'),
  jsonb_build_object('match_number',2,'player1_id','bot:fritz:$T_PARTIAL:4','player2_id','bot:fritz:$T_PARTIAL:5'),
  jsonb_build_object('match_number',3,'player1_id','bot:fritz:$T_PARTIAL:3','player2_id','bot:fritz:$T_PARTIAL:6'),
  jsonb_build_object('match_number',4,'player1_id','$PD','player2_id','bot:fritz:$T_PARTIAL:7','bot_tier','standard'))"
SEEDS="jsonb_build_array(jsonb_build_object('user_id','$PE','seed',1), jsonb_build_object('user_id','$PD','seed',2))"

OUT="$("$PGBIN/psql" -X -h "$SOCKDIR" -p "$PORT" -U postgres -d verify -tAqc \
  "select public.generate_tournament_bracket('$T_PARTIAL', $PAIRS, jsonb_build_array(jsonb_build_object('user_id','$PE','seed',1)), 'db-verify')" 2>&1 || true)"
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
[[ "$(Q "select string_agg(user_id::text || ':' || status || ':' || seed, ',' order by seed) from public.scheduled_tournament_registrations where tournament_id='$T_PARTIAL'")" == "$PE:active:1,$PD:active:2" ]] \
  || fail "registrations not active with the bracket seeds"
pass "4-of-7 partial bracket -> 7 rows, in_progress, registrations active with bracket seeds, one transaction"

R2="$(Q "select public.generate_tournament_bracket('$T_PARTIAL', $PAIRS, $SEEDS, 'db-verify')")"
echo "$R2" | grep -q '"created": false' && echo "$R2" | grep -q '"repaired": false' || fail "retry was not a no-op — got: $R2"
[[ "$(Q "select count(*) from public.scheduled_tournament_matches where tournament_id='$T_PARTIAL'")" == "7" ]] || fail "retry changed the row count"
pass "retry of a finished bracket is a no-op"

T_PLAYED='55555555-5555-4555-8555-555555555555'
OUT="$("$PGBIN/psql" -X -h "$SOCKDIR" -p "$PORT" -U postgres -d verify -tAqc \
  "select public.generate_tournament_bracket('$T_PLAYED', '[]'::jsonb, jsonb_build_array(jsonb_build_object('user_id','$PF','seed',1)), 'db-verify')" 2>&1 || true)"
echo "$OUT" | grep -q 'bracket_partial_conflict' || fail "a played row was overwritten — got: $OUT"
pass "partial state containing a played match -> bracket_partial_conflict"

# ── 9. cancel_reason ─────────────────────────────────────────────────────────
echo
echo "── 7/14  cancel_reason (Q9) ──────────────────────────────────────────"
[[ "$(Q "select count(*) from information_schema.columns where table_schema='public' and table_name='scheduled_tournaments' and column_name='cancel_reason'")" == "1" ]] \
  || fail "scheduled_tournaments.cancel_reason missing"
pass "scheduled_tournaments.cancel_reason exists"


# ── 10. M1: tournament kind, Fritz Cup, per-user overlap lock ────────────────
echo
echo "── 8/14  M1: kind, Fritz Cup, overlap lock (Phase 2B) ─────────────────"
RUN -q -f "$HELPERS/m1_seed.sql" >/dev/null
U() { printf 'cccccccc-0000-4000-8000-0000000000%02d' "$1"; }
QE() { "$PGBIN/psql" -X -h "$SOCKDIR" -p "$PORT" -U postgres -d verify -tAqc "$1" 2>&1 || true; }
T_LIVE='66666666-6666-4666-8666-666666666666'   # live, registration_open, starts in 30 min
T_FAR='77777777-7777-4777-8777-777777777777'    # live, registration_open, starts in 5 h
cup_of() { Q "select id from public.scheduled_tournaments where kind='fritz_cup' and owner_user_id='$1' order by created_at desc limit 1"; }

# schema
[[ "$(Q "select count(*) from public.scheduled_tournaments where kind <> 'live' or owner_user_id is not null")" == "0" ]] \
  || fail "existing rows are not all kind=live with no owner"
[[ "$(Q "select count(*) from public.scheduled_tournaments")" -gt 1000 ]] || fail "seeded rows missing"
pass "every pre-existing row (incl. ~1440 seeded slots) is kind=live, owner null"
BEFORE="$(Q "select count(*) from public.scheduled_tournaments")"
Q "select public.seed_future_tournaments(32)" >/dev/null
[[ "$(Q "select count(*) from public.scheduled_tournaments")" -gt "$BEFORE" ]] || fail "seed_future_tournaments(32) inserted nothing"
[[ "$(Q "select count(*) from public.scheduled_tournaments where kind <> 'live' or owner_user_id is not null")" == "0" ]] \
  || fail "the existing seed function wrote a non-live row"
pass "existing seed function (unchanged signature) still inserts kind=live rows"
OUT="$(QE "insert into public.scheduled_tournaments (scheduled_start, registration_open_at, registration_close_at, kind) values (now() + interval '9 days 3 s', now(), now(), 'fritz_cup')")"
echo "$OUT" | grep -q 'scheduled_tournaments_owner_matches_kind' || fail "fritz_cup without owner accepted — got: $OUT"
pass "fritz_cup without owner -> rejected by owner/kind check"
OUT="$(QE "insert into public.scheduled_tournaments (scheduled_start, registration_open_at, registration_close_at, kind, owner_user_id) values (now() + interval '9 days 5 s', now(), now(), 'live', '$(U 30)')")"
echo "$OUT" | grep -q 'scheduled_tournaments_owner_matches_kind' || fail "live row with owner accepted — got: $OUT"
pass "live row with an owner -> rejected"
OUT="$(QE "insert into public.scheduled_tournaments (scheduled_start, registration_open_at, registration_close_at, kind) values (now() + interval '9 days 7 s', now(), now(), 'weekly')")"
echo "$OUT" | grep -q 'scheduled_tournaments_kind_check' || fail "invalid kind accepted — got: $OUT"
pass "invalid kind -> rejected"
for fn in "register_for_tournament:p_tournament_id uuid, p_user_id uuid" "withdraw_from_tournament:p_tournament_id uuid, p_user_id uuid" "seed_future_tournaments:days_ahead integer" "ensure_tournament_seed_window:"; do
  name="${fn%%:*}"; args="${fn#*:}"
  [[ "$(Q "select count(*) from pg_proc where proname='$name' and pronamespace='public'::regnamespace")" == "1" ]] || fail "$name overloaded or missing"
  [[ "$(Q "select pg_get_function_identity_arguments(oid) from pg_proc where proname='$name' and pronamespace='public'::regnamespace")" == "$args" ]] \
    || fail "$name signature changed"
done
pass "existing RPC signatures unchanged (register / withdraw / seed / ensure_seed_window), no overloads"

# first cup, owner registration, idempotent retry
R="$(Q "select public.start_fritz_cup('$(U 1)')")"
echo "$R" | grep -q '"existing": false' || fail "first start_fritz_cup did not create — got: $R"
CUP1="$(cup_of "$(U 1)")"
[[ "$(Q "select kind||'|'||status||'|'||max_players||'|'||win_target||'|'||(scheduled_start=registration_close_at)::text||'|'||(scheduled_start <= now() + interval '1 second')::text from public.scheduled_tournaments where id='$CUP1'")" == "fritz_cup|registration_open|8|30|true|true" ]] \
  || fail "cup row values wrong"
[[ "$(Q "select (extract(microseconds from scheduled_start)::bigint % 1000000 <> 0)::text from public.scheduled_tournaments where id='$CUP1'")" == "true" ]] \
  || fail "cup start is a whole second (could take a Live Event slot)"
pass "first cup: kind=fritz_cup, owner, registration_open, due now, 8 seats, win_target 30, start never a whole second"
[[ "$(Q "select string_agg(user_id::text||':'||status, ',') from public.scheduled_tournament_registrations where tournament_id='$CUP1'")" == "$(U 1):registered" ]] \
  || fail "cup registrations are not exactly the owner (registered)"
pass "exactly one registration: the owner (no Fritz registration rows)"
R2="$(Q "select public.start_fritz_cup('$(U 1)')")"
echo "$R2" | grep -q '"existing": true' && echo "$R2" | grep -q "$CUP1" || fail "retry did not return the same cup — got: $R2"
[[ "$(Q "select count(*) from public.scheduled_tournaments where owner_user_id='$(U 1)'")" == "1" ]] || fail "retry created another cup"
pass "retry inside the 60 s cooldown returns the same active cup (existing=true), no new row"

# someone else's cup is not registerable, nor is your own through the public RPC
OUT="$(QE "select public.register_for_tournament('$CUP1', '$(U 9)')")"
echo "$OUT" | grep -q 'registration_closed' || fail "another user registered into a Fritz Cup — got: $OUT"
OUT="$(QE "select public.register_for_tournament('$CUP1', '$(U 1)')")"
echo "$OUT" | grep -q 'registration_closed' || fail "public registration RPC accepted the owner's cup — got: $OUT"
[[ "$(Q "select count(*) from public.scheduled_tournament_registrations where tournament_id='$CUP1'")" == "1" ]] || fail "a registration was written into the cup"
pass "register_for_tournament into a Fritz Cup -> registration_closed (others and owner), nothing written"

# concurrent same-user create: B blocks on A's user lock, then gets A's cup
"$PGBIN/psql" -X -v ON_ERROR_STOP=1 -h "$SOCKDIR" -p "$PORT" -U postgres -d verify -q >/dev/null 2>&1 <<SQL_CA &
begin;
select public.start_fritz_cup('$(U 2)');
select pg_sleep(3);
commit;
SQL_CA
CA_PID=$!
sleep 1.5
CB_START="$(now)"
CB_OUT="$(QE "select public.start_fritz_cup('$(U 2)')")"
CB_END="$(now)"
wait "$CA_PID"
CB_WAIT="$(python3 -c "print(f'{$CB_END - $CB_START:.2f}')")"
echo "  session B waited ${CB_WAIT}s on the user lock"
python3 -c "import sys; sys.exit(0 if $CB_WAIT >= 1.0 else 1)" || fail "same-user creates did not serialize (waited ${CB_WAIT}s)"
echo "$CB_OUT" | grep -q '"existing": true' || fail "second concurrent create did not return the existing cup — got: $CB_OUT"
[[ "$(Q "select count(*) from public.scheduled_tournaments where owner_user_id='$(U 2)'")" == "1" ]] || fail "concurrent same-user creates made two cups"
pass "concurrent same-user create: B blocked on A's user lock, then existing=true; exactly one cup"

# concurrent different-user creates + scheduled_start collisions
# (a) deterministic collision: occupy this millisecond's and the next 2 s of
#     milliseconds' first candidates (+1 µs) with dummy cups, then create.
Q "insert into public.scheduled_tournaments (scheduled_start, registration_open_at, registration_close_at, status, kind, owner_user_id)
   select ts, ts, ts, 'completed', 'fritz_cup', '$(U 30)'
   from generate_series(date_trunc('milliseconds', clock_timestamp()) + interval '1 microsecond',
                        date_trunc('milliseconds', clock_timestamp()) + interval '3 seconds', interval '1 millisecond') ts
   on conflict do nothing" >/dev/null
Q "select public.start_fritz_cup('$(U 3)')" | grep -q '"existing": false' || fail "create under occupied candidates failed"
[[ "$(Q "select extract(microseconds from scheduled_start)::bigint % 1000 from public.scheduled_tournaments where id='$(cup_of "$(U 3)")'")" == "2" ]] \
  || fail "colliding candidate was not stepped forward 1 µs"
pass "occupied candidate (ms + 1 µs) -> stepped to ms + 2 µs, created; UNIQUE intact"
# (b) 12 different users released at the same instant behind a barrier.
# barrier: one session holds lock 424242 for 2 s; the 12 racers queue on it and start together.
"$PGBIN/psql" -X -h "$SOCKDIR" -p "$PORT" -U postgres -d verify -q >/dev/null 2>&1 <<SQL_BAR &
select pg_advisory_lock(424242);
select pg_sleep(2);
select pg_advisory_unlock(424242);
SQL_BAR
BARRIER_PID=$!
sleep 0.5
PIDS=()
for n in $(seq 10 21); do
  "$PGBIN/psql" -X -v ON_ERROR_STOP=1 -h "$SOCKDIR" -p "$PORT" -U postgres -d verify -tAq >"$WORK/race_$n" 2>&1 <<SQL_RACE &
select pg_advisory_lock_shared(424242);
select pg_advisory_unlock_shared(424242);
select public.start_fritz_cup('$(U "$n")');
SQL_RACE
  PIDS+=($!)
done
wait "$BARRIER_PID"
for pid in "${PIDS[@]}"; do wait "$pid" || fail "a concurrent different-user create failed"; done
[[ "$(Q "select count(distinct owner_user_id) from public.scheduled_tournaments where owner_user_id between '$(U 10)' and '$(U 21)'")" == "12" ]] \
  || fail "not every concurrent user got a cup"
[[ "$(Q "select count(*) from (select scheduled_start from public.scheduled_tournaments group by scheduled_start having count(*) > 1) d")" == "0" ]] \
  || fail "duplicate scheduled_start"
SAME_MS="$(Q "select coalesce(max(c),0) from (select count(*) c from public.scheduled_tournaments where owner_user_id between '$(U 10)' and '$(U 21)' group by date_trunc('milliseconds', scheduled_start)) x")"
echo "  12 concurrent creates; largest group sharing one millisecond: $SAME_MS"
pass "12 different users created concurrently: 12 cups, all scheduled_start unique"

# overlap: Live registration, then a cup
Q "select public.register_for_tournament('$T_LIVE', '$(U 5)')" | grep -q '"already_registered": false' || fail "live registration failed"
OUT="$(QE "select public.start_fritz_cup('$(U 5)')")"
echo "$OUT" | grep -q 'overlapping_tournament' || fail "cup over a live hold was not refused — got: $OUT"
echo "$OUT" | grep -q "$T_LIVE" && echo "$OUT" | grep -q '"kind": "live"' || fail "conflict detail missing tournament/kind — got: $OUT"
[[ "$(Q "select count(*) from public.scheduled_tournaments where owner_user_id='$(U 5)'")" == "0" ]] || fail "a cup was created despite the overlap"
pass "Live registration then cup -> overlapping_tournament {tournament_id, kind: live, scheduled_start}, no cup"
Q "select public.register_for_tournament('$T_LIVE', '$(U 5)')" | grep -q '"already_registered": true' \
  || fail "re-registering the same live event was not idempotent"
pass "same Live Event registration again -> already_registered (not an overlap with itself)"
Q "select public.register_for_tournament('$T_FAR', '$(U 5)')" | grep -q '"already_registered": false' \
  || fail "non-overlapping live registration refused"
pass "non-overlapping Live Event (5 h later) -> registered"

# overlap: a cup, then a Live registration
Q "select public.start_fritz_cup('$(U 6)')" | grep -q '"existing": false' || fail "cup for U6 failed"
CUP6="$(cup_of "$(U 6)")"
OUT="$(QE "select public.register_for_tournament('$T_LIVE', '$(U 6)')")"
echo "$OUT" | grep -q 'overlapping_tournament' && echo "$OUT" | grep -q '"kind": "fritz_cup"' && echo "$OUT" | grep -q "$CUP6" \
  || fail "live registration over a cup was not refused with the cup as conflict — got: $OUT"
pass "cup then Live registration -> overlapping_tournament {kind: fritz_cup}"
Q "select public.register_for_tournament('$T_FAR', '$(U 6)')" | grep -q '"already_registered": false' \
  || fail "cup holder refused a non-overlapping live event"
pass "cup holder may register for a Live Event 5 h later"

# eliminated / completed / cancelled stop blocking
Q "update public.scheduled_tournament_registrations set status='eliminated' where tournament_id='$CUP6' and user_id='$(U 6)'" >/dev/null
Q "update public.scheduled_tournaments set status='in_progress' where id='$CUP6'" >/dev/null
Q "select public.register_for_tournament('$T_LIVE', '$(U 6)')" | grep -q '"already_registered": false' \
  || fail "an eliminated cup holder is still blocked"
pass "eliminated in a cup still in_progress -> no longer blocks"
Q "select public.withdraw_from_tournament('$T_LIVE', '$(U 6)')" >/dev/null
Q "select public.start_fritz_cup('$(U 7)')" >/dev/null
Q "update public.scheduled_tournaments set status='cancelled', cancel_reason='bracket_generation_failed:test' where id='$(cup_of "$(U 7)")'" >/dev/null
Q "select public.register_for_tournament('$T_LIVE', '$(U 7)')" | grep -q '"already_registered": false' \
  || fail "a cancelled cup still blocks"
pass "cancelled cup -> no longer blocks"
Q "select public.withdraw_from_tournament('$T_LIVE', '$(U 7)')" >/dev/null
Q "update public.scheduled_tournaments set status='completed' where id='$CUP1'" >/dev/null
Q "update public.scheduled_tournament_registrations set status='winner', placement=1 where tournament_id='$CUP1'" >/dev/null
Q "select public.register_for_tournament('$T_LIVE', '$(U 1)')" | grep -q '"already_registered": false' \
  || fail "a completed cup still blocks"
pass "completed cup (owner = champion) -> no longer blocks"
Q "select public.withdraw_from_tournament('$T_LIVE', '$(U 1)')" >/dev/null

# cooldown and daily limit (every created cup counts, cancelled included)
OUT="$(QE "select public.start_fritz_cup('$(U 7)')")"
echo "$OUT" | grep -q 'fritz_cup_cooldown' && echo "$OUT" | grep -q '"reason": "cooldown"' || fail "60 s cooldown not enforced — got: $OUT"
RA="$(echo "$OUT" | python3 -c "import sys,re; m=re.search(r'\"retry_after_ms\": (\d+)', sys.stdin.read()); print(m.group(1) if m else -1)")"
python3 -c "import sys; sys.exit(0 if 0 < $RA <= 60000 else 1)" || fail "retry_after_ms out of range: $RA"
pass "new cup within 60 s of the last (a cancelled one) -> fritz_cup_cooldown {reason: cooldown, retry_after_ms=$RA}"
Q "insert into public.scheduled_tournaments (scheduled_start, registration_open_at, registration_close_at, status, kind, owner_user_id, created_at)
   select ts, ts, ts, 'completed', 'fritz_cup', '$(U 8)', ts
   from generate_series(now() - interval '23 hours' + interval '3 ms', now() - interval '5 minutes' + interval '3 ms', interval '68 minutes') ts
   limit 20" >/dev/null
[[ "$(Q "select count(*) from public.scheduled_tournaments where owner_user_id='$(U 8)' and created_at > now() - interval '24 hours'")" == "20" ]] || fail "daily fixture is not 20 cups"
OUT="$(QE "select public.start_fritz_cup('$(U 8)')")"
echo "$OUT" | grep -q 'fritz_cup_cooldown' && echo "$OUT" | grep -q '"reason": "daily_limit"' || fail "daily limit not enforced — got: $OUT"
pass "21st cup in 24 h -> fritz_cup_cooldown {reason: daily_limit}"
# ...and an active cup is still returned, limits notwithstanding
Q "update public.scheduled_tournaments set status='in_progress' where id=(select id from public.scheduled_tournaments where owner_user_id='$(U 8)' order by created_at desc limit 1)" >/dev/null
Q "insert into public.scheduled_tournament_registrations (tournament_id, user_id, status) select id, '$(U 8)', 'active' from public.scheduled_tournaments where owner_user_id='$(U 8)' order by created_at desc limit 1" >/dev/null
Q "select public.start_fritz_cup('$(U 8)')" | grep -q '"existing": true' || fail "an active cup was not returned at the daily limit"
pass "at the daily limit, the active cup is still returned (existing=true)"

# cross-request race: cup creation holds the user lock; a Live registration waits, then sees the cup
"$PGBIN/psql" -X -v ON_ERROR_STOP=1 -h "$SOCKDIR" -p "$PORT" -U postgres -d verify -q >/dev/null 2>&1 <<SQL_XA &
begin;
select public.start_fritz_cup('$(U 25)');
select pg_sleep(3);
commit;
SQL_XA
XA_PID=$!
sleep 1.5
XB_START="$(now)"
XB_OUT="$(QE "select public.register_for_tournament('$T_LIVE', '$(U 25)')")"
XB_END="$(now)"
wait "$XA_PID"
XB_WAIT="$(python3 -c "print(f'{$XB_END - $XB_START:.2f}')")"
echo "  registration waited ${XB_WAIT}s on the user lock"
python3 -c "import sys; sys.exit(0 if $XB_WAIT >= 1.0 else 1)" || fail "cup create and live registration did not serialize"
echo "$XB_OUT" | grep -q 'overlapping_tournament' || fail "racing registration was not refused — got: $XB_OUT"
[[ "$(Q "select count(*) from public.scheduled_tournament_registrations r join public.scheduled_tournaments t on t.id=r.tournament_id where r.user_id='$(U 25)' and r.status in ('registered','active') and t.status in ('upcoming','registration_open','in_progress')")" == "1" ]] \
  || fail "race left other than exactly one hold"
pass "cup vs Live registration race: registration blocked on the user lock, then overlapping_tournament; exactly one hold"
# ...and the reverse order
"$PGBIN/psql" -X -v ON_ERROR_STOP=1 -h "$SOCKDIR" -p "$PORT" -U postgres -d verify -q >/dev/null 2>&1 <<SQL_YA &
begin;
select public.register_for_tournament('$T_LIVE', '$(U 26)');
select pg_sleep(3);
commit;
SQL_YA
YA_PID=$!
sleep 1.5
YB_OUT="$(QE "select public.start_fritz_cup('$(U 26)')")"
wait "$YA_PID"
echo "$YB_OUT" | grep -q 'overlapping_tournament' || fail "racing cup create was not refused — got: $YB_OUT"
[[ "$(Q "select count(*) from public.scheduled_tournaments where owner_user_id='$(U 26)'")" == "0" ]] || fail "race created a cup"
pass "Live registration vs cup race (reverse order): cup refused, exactly one hold"

# the cup starts through the existing bracket RPC
CUP3="$(cup_of "$(U 3)")"
PAIRS3="jsonb_build_array(
  jsonb_build_object('match_number',1,'player1_id','$(U 3)','player2_id','bot:fritz:$CUP3:8','bot_tier','standard'),
  jsonb_build_object('match_number',2,'player1_id','bot:fritz:$CUP3:4','player2_id','bot:fritz:$CUP3:5','bot_tier','standard'),
  jsonb_build_object('match_number',3,'player1_id','bot:fritz:$CUP3:3','player2_id','bot:fritz:$CUP3:6','bot_tier','standard'),
  jsonb_build_object('match_number',4,'player1_id','bot:fritz:$CUP3:2','player2_id','bot:fritz:$CUP3:7','bot_tier','standard'))"
R="$(Q "select public.generate_tournament_bracket('$CUP3', $PAIRS3, jsonb_build_array(jsonb_build_object('user_id','$(U 3)','seed',1)), 'db-verify')")"
echo "$R" | grep -q '"created": true' || fail "bracket for a cup not created — got: $R"
[[ "$(Q "select status||'|'||(select count(*) from public.scheduled_tournament_matches where tournament_id='$CUP3')||'|'||(select status||':'||seed from public.scheduled_tournament_registrations where tournament_id='$CUP3') from public.scheduled_tournaments where id='$CUP3'")" == "in_progress|7|active:1" ]] \
  || fail "cup bracket state wrong"
pass "generate_tournament_bracket starts a cup unchanged: in_progress, 7 rows, owner active seed 1"


# ── 11. pre-start cancellation vs start (Phase 2B.1) ────────────────────────
echo
echo "── 9/14  pre-start cancellation vs bracket start (Phase 2B.1) ──────────"
# The exact statement PostgREST runs for the server's cancelTournamentBeforeStart PATCH.
CANCEL_SQL() { echo "update public.scheduled_tournaments set status='cancelled', cancel_reason='not_enough_players' where id='$1' and status in ('upcoming','registration_open') returning id"; }
OLD_CANCEL_SQL() { echo "update public.scheduled_tournaments set status='cancelled', cancel_reason='not_enough_players' where id='$1' returning id"; }
race_event() {  # id, owner user index: a registration_open event with one registered human, start 3 days + n s out
  Q "insert into auth.users (id) values ('$(U "$2")') on conflict do nothing" >/dev/null
  Q "insert into public.scheduled_tournaments (id, scheduled_start, registration_open_at, registration_close_at, status)
     values ('$1', date_trunc('minute', now()) + interval '3 days' + ($2 || ' seconds')::interval, now() - interval '1 hour', now() - interval '1 second', 'registration_open')" >/dev/null
  Q "insert into public.scheduled_tournament_registrations (tournament_id, user_id, status) values ('$1', '$(U "$2")', 'registered')" >/dev/null
}
pairs_for() {  # tournament id, human
  echo "jsonb_build_array(
    jsonb_build_object('match_number',1,'player1_id','$2','player2_id','bot:fritz:$1:7','bot_tier','standard'),
    jsonb_build_object('match_number',2,'player1_id','bot:fritz:$1:3','player2_id','bot:fritz:$1:4','bot_tier','standard'),
    jsonb_build_object('match_number',3,'player1_id','bot:fritz:$1:1','player2_id','bot:fritz:$1:6','bot_tier','standard'),
    jsonb_build_object('match_number',4,'player1_id','bot:fritz:$1:2','player2_id','bot:fritz:$1:5','bot_tier','standard'))"
}
state_of() { Q "select t.status||'|'||coalesce(t.cancel_reason,'-')||'|'||(select count(*) from public.scheduled_tournament_matches where tournament_id=t.id)||'|'||(select string_agg(status, ',') from public.scheduled_tournament_registrations where tournament_id=t.id) from public.scheduled_tournaments t where id='$1'"; }

for ROUND in 1 2 3; do
  # (A) the start wins: the bracket transaction holds the row; the stale cancel waits, then matches no row.
  TA="$(printf 'eeeeeeee-0000-4000-8000-%012d' $((ROUND * 10 + 1)))"; race_event "$TA" $((ROUND * 10 + 1))
  "$PGBIN/psql" -X -v ON_ERROR_STOP=1 -h "$SOCKDIR" -p "$PORT" -U postgres -d verify -q >/dev/null 2>&1 <<SQL_SA &
begin;
select public.generate_tournament_bracket('$TA', $(pairs_for "$TA" "$(U $((ROUND * 10 + 1)))"), jsonb_build_array(jsonb_build_object('user_id','$(U $((ROUND * 10 + 1)))','seed',1)), 'race');
select pg_sleep(3);
commit;
SQL_SA
  SA_PID=$!
  sleep 1.5
  T0="$(now)"; OUT="$(QE "$(CANCEL_SQL "$TA")")"; T1="$(now)"
  wait "$SA_PID"
  W="$(python3 -c "print(f'{$T1 - $T0:.2f}')")"
  python3 -c "import sys; sys.exit(0 if $W >= 1.0 else 1)" || fail "round $ROUND: the cancel did not wait for the start (waited ${W}s)"
  [[ -z "$OUT" ]] || fail "round $ROUND: the cancel matched a started tournament — got: $OUT"
  [[ "$(state_of "$TA")" == "in_progress|-|7|active" ]] || fail "round $ROUND: started tournament damaged: $(state_of "$TA")"
  pass "round $ROUND, start first: cancel waited ${W}s on the bracket's row lock, then updated 0 rows; in_progress, 7 matches, registration active"

  # (B) the cancel wins: the cancel transaction holds the row; the start waits, then refuses.
  TB="$(printf 'eeeeeeee-0000-4000-8000-%012d' $((ROUND * 10 + 2)))"; race_event "$TB" $((ROUND * 10 + 2))
  "$PGBIN/psql" -X -v ON_ERROR_STOP=1 -h "$SOCKDIR" -p "$PORT" -U postgres -d verify -q >/dev/null 2>&1 <<SQL_SB &
begin;
$(CANCEL_SQL "$TB");
select pg_sleep(3);
commit;
SQL_SB
  SB_PID=$!
  sleep 1.5
  T0="$(now)"; OUT="$(QE "select public.generate_tournament_bracket('$TB', $(pairs_for "$TB" "$(U $((ROUND * 10 + 2)))"), jsonb_build_array(jsonb_build_object('user_id','$(U $((ROUND * 10 + 2)))','seed',1)), 'race')")"; T1="$(now)"
  wait "$SB_PID"
  W="$(python3 -c "print(f'{$T1 - $T0:.2f}')")"
  python3 -c "import sys; sys.exit(0 if $W >= 1.0 else 1)" || fail "round $ROUND: the start did not wait for the cancel (waited ${W}s)"
  echo "$OUT" | grep -q 'tournament_not_startable' || fail "round $ROUND: the start revived a cancelled tournament — got: $OUT"
  [[ "$(state_of "$TB")" == "cancelled|not_enough_players|0|registered" ]] || fail "round $ROUND: cancelled tournament changed: $(state_of "$TB")"
  pass "round $ROUND, cancel first: start waited ${W}s on the row lock, then tournament_not_startable; stays cancelled, no matches"
done

# Contrast: the unconditional update the server used before Phase 2B.1, in the start-first order.
TC='eeeeeeee-0000-4000-8000-000000000099'; race_event "$TC" 99
"$PGBIN/psql" -X -v ON_ERROR_STOP=1 -h "$SOCKDIR" -p "$PORT" -U postgres -d verify -q >/dev/null 2>&1 <<SQL_SC &
begin;
select public.generate_tournament_bracket('$TC', $(pairs_for "$TC" "$(U 99)"), jsonb_build_array(jsonb_build_object('user_id','$(U 99)','seed',1)), 'race');
select pg_sleep(3);
commit;
SQL_SC
SC_PID=$!
sleep 1.5
QE "$(OLD_CANCEL_SQL "$TC")" >/dev/null
wait "$SC_PID"
[[ "$(state_of "$TC")" == "cancelled|not_enough_players|7|active" ]] || fail "contrast did not reproduce: $(state_of "$TC")"
pass "contrast: the old unconditional update overwrites the started tournament (cancelled with 7 matches, registration active) — the race this closes"

# Live Event regressions: a truly empty event is still cancelled; started / terminal rows are untouched.
lifecycle_row() {  # id, status, cancel_reason
  Q "insert into public.scheduled_tournaments (id, scheduled_start, registration_open_at, registration_close_at, status, cancel_reason)
     values ('$1', date_trunc('minute', now()) + interval '4 days' + (random()*1000)::int * interval '1 second' + interval '17 ms', now() - interval '1 hour', now() - interval '1 second', '$2', $3)" >/dev/null
}
lifecycle_row eeeeeeee-0000-4000-8000-0000000000e1 registration_open null
lifecycle_row eeeeeeee-0000-4000-8000-0000000000e2 upcoming null
lifecycle_row eeeeeeee-0000-4000-8000-0000000000e3 in_progress null
lifecycle_row eeeeeeee-0000-4000-8000-0000000000e4 completed null
lifecycle_row eeeeeeee-0000-4000-8000-0000000000e5 cancelled "'active_window_expired'"
for id in e1 e2; do
  [[ -n "$(Q "$(CANCEL_SQL "eeeeeeee-0000-4000-8000-0000000000$id")")" ]] || fail "empty pre-start event $id was not cancelled"
done
[[ "$(Q "select string_agg(status||':'||coalesce(cancel_reason,'-'), ',' order by id) from public.scheduled_tournaments where id in ('eeeeeeee-0000-4000-8000-0000000000e1','eeeeeeee-0000-4000-8000-0000000000e2')")" == "cancelled:not_enough_players,cancelled:not_enough_players" ]] \
  || fail "empty events not cancelled with the reason"
pass "empty registration_open / upcoming Live Events -> cancelled, not_enough_players"
for id in e3 e4 e5; do
  [[ -z "$(Q "$(CANCEL_SQL "eeeeeeee-0000-4000-8000-0000000000$id")")" ]] || fail "conditional cancel matched $id"
done
[[ "$(Q "select string_agg(status||':'||coalesce(cancel_reason,'-'), ',' order by id) from public.scheduled_tournaments where id in ('eeeeeeee-0000-4000-8000-0000000000e3','eeeeeeee-0000-4000-8000-0000000000e4','eeeeeeee-0000-4000-8000-0000000000e5')")" == "in_progress:-,completed:-,cancelled:active_window_expired" ]] \
  || fail "a started or terminal row was changed"
pass "in_progress, completed and already-cancelled rows: 0 rows updated, unchanged (reason kept)"
# The same rule for a Fritz Cup: due cup cancellable before start, not after.
Q "select public.start_fritz_cup('$(U 27)')" >/dev/null
CUP27="$(cup_of "$(U 27)")"
Q "update public.scheduled_tournaments set status='in_progress' where id='$CUP27'" >/dev/null
[[ -z "$(Q "$(CANCEL_SQL "$CUP27")")" ]] || fail "a started cup was cancelled"
Q "select public.start_fritz_cup('$(U 28)')" >/dev/null
[[ -n "$(Q "$(CANCEL_SQL "$(cup_of "$(U 28)")")")" ]] || fail "an unstarted cup could not be cancelled"
pass "Fritz Cups follow the same rule: started -> untouched, still registration_open -> cancelled"


# ── 12. orchestrator late writes (Phase 2C) ──────────────────────────────────
echo
echo "── 10/14  orchestrator late writes (Phase 2C) ─────────────────────────"
# race HOLDER_SQL STALE_SQL: HOLDER commits its write after ~3 s; STALE starts at ~1.5 s.
# Prints "<wait seconds>|<stale output>".
race() {
  "$PGBIN/psql" -X -v ON_ERROR_STOP=1 -h "$SOCKDIR" -p "$PORT" -U postgres -d verify -q >/dev/null 2>&1 <<SQL_HOLD &
begin;
$1;
select pg_sleep(3);
commit;
SQL_HOLD
  local hp=$!
  sleep 1.5
  local t0; t0="$(now)"
  local out; out="$(QE "$2")"
  local t1; t1="$(now)"
  wait "$hp"
  echo "$(python3 -c "print(f'{$t1 - $t0:.2f}')")|$out"
}
waited() { python3 -c "import sys; sys.exit(0 if float('$1') >= 1.0 else 1)"; }
H1='dddddddd-0000-4000-8000-0000000000a1'; H2='dddddddd-0000-4000-8000-0000000000a2'
Q "insert into auth.users (id) values ('$H1'), ('$H2') on conflict do nothing" >/dev/null
lw_tournament() {  # id, status
  Q "insert into public.scheduled_tournaments (id, scheduled_start, registration_open_at, registration_close_at, status)
     values ('$1', date_trunc('minute', now()) + interval '6 days' + (random()*100000)::int * interval '1 second' + interval '23 ms', now() - interval '3 hours', now() - interval '2 hours', '$2')" >/dev/null
}
lw_match() {  # tournament, round, number, status, extra-columns sql, extra-values sql
  Q "insert into public.scheduled_tournament_matches (tournament_id, round, match_number, player1_id, player2_id, room_code, status $5)
     values ('$1', $2, $3, '$H1', '$H2', '', '$4' $6) returning id"
}
mstate() { Q "select status||'|'||coalesce(room_code,'-')||'|'||coalesce(ready_deadline_at::text,'-')||'|'||coalesce(status_reason,'-')||'|'||coalesce(winner_id,'-')||'|'||coalesce(no_show_user_id,'-') from public.scheduled_tournament_matches where id='$1'"; }

for ROUND in 1 2 3; do
  # open registration: B moved the tournament on; A's stale open (status=eq.upcoming & due) waits, then 0 rows.
  TO="$(printf 'dddddddd-1000-4000-8000-%012d' "$ROUND")"; lw_tournament "$TO" upcoming
  R="$(race "update public.scheduled_tournaments set status='cancelled', cancel_reason='moved_on' where id='$TO'" \
            "update public.scheduled_tournaments set status='registration_open' where id='$TO' and status='upcoming' and registration_open_at <= now() returning id")"
  waited "${R%%|*}" && [[ -z "${R#*|}" ]] || fail "round $ROUND open: stale open was not refused after waiting ($R)"
  [[ "$(Q "select status||'|'||cancel_reason from public.scheduled_tournaments where id='$TO'")" == "cancelled|moved_on" ]] || fail "round $ROUND open: B's state lost"
  pass "round $ROUND open-registration: stale open waited ${R%%|*}s, then 0 rows; B's state intact"

  # dispatch: two dispatchers from the same snapshot, either order — exactly the first one's room/deadline survive.
  TD="$(printf 'dddddddd-2000-4000-8000-%012d' "$ROUND")"; lw_tournament "$TD" in_progress
  MD="$(lw_match "$TD" 1 1 waiting "" "")"
  CAS_D() { echo "update public.scheduled_tournament_matches set status='ready', room_code='$2', ready_at=now(), ready_deadline_at=now() + interval '$3 seconds', status_reason=null
            where id='$1' and status='waiting' and room_code='' and ready_at is null and ready_deadline_at is null and status_reason is null returning id"; }
  R="$(race "$(CAS_D "$MD" TROOMB 120)" "$(CAS_D "$MD" TROOMA 999)")"
  waited "${R%%|*}" && [[ -z "${R#*|}" ]] || fail "round $ROUND dispatch: stale dispatch was not refused ($R)"
  [[ "$(Q "select room_code||'|'||(ready_deadline_at < now() + interval '200 seconds')::text from public.scheduled_tournament_matches where id='$MD'")" == "TROOMB|true" ]] || fail "round $ROUND dispatch: newer dispatch replaced: $(mstate "$MD")"
  # B then starts it; a third stale dispatch from the original snapshot still cannot move it back.
  Q "update public.scheduled_tournament_matches set status='in_progress', started_at=now() where id='$MD'" >/dev/null
  [[ -z "$(Q "$(CAS_D "$MD" TROOMC 120)")" ]] && [[ "$(Q "select status||'|'||room_code from public.scheduled_tournament_matches where id='$MD'")" == "in_progress|TROOMB" ]] \
    || fail "round $ROUND dispatch: stale dispatch moved a started match"
  pass "round $ROUND dispatch: stale dispatcher waited ${R%%|*}s, 0 rows; newer room/deadline kept; a started match is never moved back"

  # ready -> in_progress: B completes the match; A's stale transition (status=eq.ready) waits, 0 rows.
  MR="$(lw_match "$TD" 1 2 ready ", ready_at, ready_deadline_at" ", now() - interval '10 min', now() - interval '1 min'")"
  R="$(race "select public.complete_tournament_match('$MR', '$H1', 'no_show', 'player2_no_show', 30, 0, '$H2', null, false, 'B')" \
            "update public.scheduled_tournament_matches set status='in_progress', started_at=now(), status_reason=null where id='$MR' and status='ready' returning id")"
  waited "${R%%|*}" && [[ -z "${R#*|}" ]] || fail "round $ROUND ready->in_progress: not refused ($R)"
  [[ "$(Q "select status||'|'||winner_id||'|'||status_reason from public.scheduled_tournament_matches where id='$MR'")" == "completed|$H1|player2_no_show" ]] || fail "round $ROUND ready->in_progress: completed match moved"
  pass "round $ROUND ready->in_progress: stale transition waited ${R%%|*}s, 0 rows; completed match intact"

  # deadline extension: A decided from deadline T0; B extends first; A's stale extension waits, 0 rows; B's deadline + reason survive.
  ME="$(lw_match "$TD" 1 3 ready ", ready_at, ready_deadline_at" ", now() - interval '10 min', now() - interval '1 min'")"
  T0="$(Q "select ready_deadline_at from public.scheduled_tournament_matches where id='$ME'")"
  EXT() { echo "update public.scheduled_tournament_matches set ready_deadline_at=now() + interval '$2 seconds', status_reason='$3'
          where id='$1' and status='ready' and ready_deadline_at='$T0' and status_reason is null returning id"; }
  R="$(race "$(EXT "$ME" 300 room_rehydrated_deadline_extended)" "$(EXT "$ME" 120 all_joined_start_retry)")"
  waited "${R%%|*}" && [[ -z "${R#*|}" ]] || fail "round $ROUND deadline: stale extension not refused ($R)"
  [[ "$(Q "select status_reason||'|'||(ready_deadline_at > now() + interval '200 seconds')::text from public.scheduled_tournament_matches where id='$ME'")" == "room_rehydrated_deadline_extended|true" ]] \
    || fail "round $ROUND deadline: B's newer deadline/reason lost: $(mstate "$ME")"
  pass "round $ROUND deadline: stale extension waited ${R%%|*}s, 0 rows; B's later deadline and reason kept"

  # no-show attendance: B (the player) joins first; A's no-show (decided while absent) waits, then attendance_changed.
  MN="$(lw_match "$TD" 2 1 ready ", ready_at, ready_deadline_at, player1_joined_at" ", now() - interval '10 min', now() - interval '1 min', now() - interval '5 min'")"
  R="$(race "update public.scheduled_tournament_matches set player2_joined_at=now() where id='$MN'" \
            "select public.complete_tournament_match_if_unchanged('$MN', '$H1', 'no_show', 'player2_no_show', 30, 0, '$H2', 'ready', array['$H2'], 'A')")"
  waited "${R%%|*}" && echo "${R#*|}" | grep -q 'attendance_changed' || fail "round $ROUND no-show: not refused ($R)"
  [[ "$(Q "select status||'|'||coalesce(no_show_user_id,'-')||'|'||(player2_joined_at is not null)::text from public.scheduled_tournament_matches where id='$MN'")" == "ready|-|true" ]] \
    || fail "round $ROUND no-show: joined player recorded absent: $(mstate "$MN")"
  # reverse: the no-show commits first; the late join lands on a completed match (the decision was right when made).
  MN2="$(lw_match "$TD" 2 2 ready ", ready_at, ready_deadline_at, player1_joined_at" ", now() - interval '10 min', now() - interval '1 min', now() - interval '5 min'")"
  R="$(race "select public.complete_tournament_match_if_unchanged('$MN2', '$H1', 'no_show', 'player2_no_show', 30, 0, '$H2', 'ready', array['$H2'], 'A')" \
            "update public.scheduled_tournament_matches set player2_joined_at=now() where id='$MN2' returning id")"
  waited "${R%%|*}" || fail "round $ROUND no-show reverse: join did not wait"
  [[ "$(Q "select status||'|'||no_show_user_id from public.scheduled_tournament_matches where id='$MN2'")" == "completed|$H2" ]] || fail "round $ROUND no-show reverse: wrong state"
  pass "round $ROUND no-show: join first -> stale no-show waited ${R%%|*}s, attendance_changed, match ready; no-show first -> recorded, late join waits"

  # started meanwhile: B starts the game; A's "never played" decision (expected 'ready') waits, then match_state_changed.
  MS="$(lw_match "$TD" 2 3 ready ", ready_at, ready_deadline_at, player1_joined_at, player2_joined_at" ", now() - interval '10 min', now() - interval '1 min', now() - interval '5 min', now() - interval '5 min'")"
  R="$(race "update public.scheduled_tournament_matches set status='in_progress', started_at=now() where id='$MS'" \
            "select public.complete_tournament_match_if_unchanged('$MS', '$H1', 'no_show', 'event_backstop_window_open_higher_seed', 30, 0, null, 'ready', '{}', 'A')")"
  waited "${R%%|*}" && echo "${R#*|}" | grep -q 'match_state_changed' || fail "round $ROUND started: stale administrative result not refused ($R)"
  [[ "$(Q "select status||'|'||coalesce(winner_id,'-') from public.scheduled_tournament_matches where id='$MS'")" == "in_progress|-" ]] || fail "round $ROUND started: live game decided"
  pass "round $ROUND started meanwhile: stale 'never played' result waited ${R%%|*}s, then match_state_changed; the live game is untouched"

  # not_enough_players: a last-moment registration (still open by the DB clock) commits first; the cancel waits, then 0.
  TN="$(printf 'dddddddd-4000-4000-8000-%012d' "$ROUND")"
  HN="dddddddd-0000-4000-8000-0000000000b$ROUND"; Q "insert into auth.users (id) values ('$HN') on conflict do nothing" >/dev/null
  # Open (by the DB clock) when the registration runs at ~0 s; closed when the cancel runs at ~1.5 s.
  Q "insert into public.scheduled_tournaments (id, scheduled_start, registration_open_at, registration_close_at, status)
     values ('$TN', date_trunc('minute', now()) + interval '7 days' + interval '$ROUND seconds' + interval '41 ms', now() - interval '1 hour', now() + interval '1 second', 'registration_open')" >/dev/null
  R="$(race "select public.register_for_tournament('$TN', '$HN')" "select public.cancel_tournament_if_no_entrants('$TN', 'not_enough_players')")"
  [[ "$(Q "select count(*) from public.scheduled_tournament_registrations where tournament_id='$TN' and status='registered'")" == "1" ]] || fail "round $ROUND entrants: the registration itself did not land"
  waited "${R%%|*}" && echo "${R#*|}" | grep -q '"cancelled": false' || fail "round $ROUND entrants: cancel not refused ($R)"
  [[ "$(Q "select status from public.scheduled_tournaments where id='$TN'")" == "registration_open" ]] || fail "round $ROUND entrants: event with a registrant cancelled"
  pass "round $ROUND no entrants: a last-moment registration committed first; the cancel waited ${R%%|*}s on the row lock, then did not cancel"
  # once the database clock has closed registration and nobody is registered, it cancels — and a later registration is refused.
  TN2="$(printf 'dddddddd-5000-4000-8000-%012d' "$ROUND")"
  Q "insert into public.scheduled_tournaments (id, scheduled_start, registration_open_at, registration_close_at, status)
     values ('$TN2', date_trunc('minute', now()) + interval '8 days' + interval '$ROUND seconds' + interval '43 ms', now() - interval '1 hour', now() - interval '1 second', 'registration_open')" >/dev/null
  Q "select public.cancel_tournament_if_no_entrants('$TN2', 'not_enough_players')" | grep -q '"cancelled": true' || fail "round $ROUND entrants: empty closed event not cancelled"
  QE "select public.register_for_tournament('$TN2', '$H2')" | grep -q 'registration_closed' || fail "round $ROUND entrants: registration into a cancelled event"
  pass "round $ROUND no entrants: an empty event closed by the DB clock is cancelled; a later registration gets registration_closed"

  # backstop cancel: B completes a match after the snapshot; A's cancel locks the bracket, waits, then refuses.
  TB="$(printf 'dddddddd-3000-4000-8000-%012d' "$ROUND")"; lw_tournament "$TB" in_progress
  MB="$(lw_match "$TB" 1 1 in_progress "" "")"
  lw_match "$TB" 2 1 waiting "" "" >/dev/null
  SNAP="$(Q "select jsonb_agg(jsonb_build_object('id',id,'status',status,'winner_id',winner_id,'player1_id',player1_id,'player2_id',player2_id,'room_code',room_code,'status_reason',status_reason,'started_at',started_at,'completed_at',completed_at,'ready_deadline_at',ready_deadline_at,'player1_joined_at',player1_joined_at,'player2_joined_at',player2_joined_at)) from public.scheduled_tournament_matches where tournament_id='$TB'")"
  R="$(race "select public.complete_tournament_match('$MB', '$H1', 'game_over', null, 30, 10, null, null, false, 'B')" \
            "select public.cancel_tournament_if_bracket_unchanged('$TB', '$SNAP'::jsonb, 'active_window_unrecoverable:race')")"
  waited "${R%%|*}" && echo "${R#*|}" | grep -q '"cancelled": false' && echo "${R#*|}" | grep -q 'bracket_changed' || fail "round $ROUND backstop: stale cancel not refused ($R)"
  [[ "$(Q "select status||'|'||coalesce(cancel_reason,'-') from public.scheduled_tournaments where id='$TB'")" == "in_progress|-" ]] || fail "round $ROUND backstop: progressing tournament cancelled"
  [[ "$(Q "select status||'|'||winner_id from public.scheduled_tournament_matches where id='$MB'")" == "completed|$H1" ]] || fail "round $ROUND backstop: B's result lost"
  pass "round $ROUND backstop: stale cancel waited ${R%%|*}s on the bracket locks, then bracket_changed; tournament in_progress, B's result kept"
  # status unchanged, other field changed (repair): still refused.
  SNAP2="$(Q "select jsonb_agg(jsonb_build_object('id',id,'status',status,'winner_id',winner_id,'player1_id',player1_id,'player2_id',player2_id,'room_code',room_code,'status_reason',status_reason,'started_at',started_at,'completed_at',completed_at,'ready_deadline_at',ready_deadline_at,'player1_joined_at',player1_joined_at,'player2_joined_at',player2_joined_at)) from public.scheduled_tournament_matches where tournament_id='$TB'")"
  Q "update public.scheduled_tournament_matches set room_code='TREPAIRED' where tournament_id='$TB' and round=2" >/dev/null
  Q "select public.cancel_tournament_if_bracket_unchanged('$TB', '$SNAP2'::jsonb, 'x')" | grep -q '"cancelled": false' || fail "round $ROUND backstop: a repair with unchanged statuses did not block the cancel"
  # control: unchanged snapshot -> cancelled.
  SNAP3="$(Q "select jsonb_agg(jsonb_build_object('id',id,'status',status,'winner_id',winner_id,'player1_id',player1_id,'player2_id',player2_id,'room_code',room_code,'status_reason',status_reason,'started_at',started_at,'completed_at',completed_at,'ready_deadline_at',ready_deadline_at,'player1_joined_at',player1_joined_at,'player2_joined_at',player2_joined_at)) from public.scheduled_tournament_matches where tournament_id='$TB'")"
  Q "select public.cancel_tournament_if_bracket_unchanged('$TB', '$SNAP3'::jsonb, 'active_window_unrecoverable:test')" | grep -q '"cancelled": true' || fail "round $ROUND backstop: unchanged bracket not cancelled"
  pass "round $ROUND backstop: a repair with statuses unchanged also blocks; an unchanged bracket is cancelled"
done


# ── 13. M3 orchestrator lease (Phase 2C) ─────────────────────────────────────
echo
echo "── 11/14  M3 orchestrator lease (Phase 2C) ─────────────────────────────"
ACQ() { QE "select public.acquire_tournament_orchestrator_lease('$1', '$2', $3)"; }
REN() { QE "select public.renew_tournament_orchestrator_lease('$1', '$2', '$3', $4)"; }
REL() { QE "select public.release_tournament_orchestrator_lease('$1', '$2', '$3')"; }
tok() { echo "$1" | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('lease_token') or '')"; }
K=tournament_orchestrator
R="$(ACQ $K owner-a 120)"; echo "$R" | grep -q '"acquired": true' || fail "A could not acquire an absent lease ($R)"; TA="$(tok "$R")"
[[ -n "$TA" ]] || fail "acquire returned no token"
pass "A acquires the absent lease; token minted"
R="$(ACQ $K owner-b 120)"; echo "$R" | grep -q '"acquired": false' && echo "$R" | grep -q '"owner": "owner-a"' && [[ -z "$(tok "$R")" ]] || fail "B acquired a valid lease ($R)"
R="$(ACQ $K owner-a 120)"; echo "$R" | grep -q '"acquired": false' || fail "A re-acquired instead of renewing ($R)"
pass "B cannot acquire while A's lease is valid (no token leaked); A itself must renew, not re-acquire"
U0="$(Q "select leased_until from public.tournament_orchestrator_leases where lease_key='$K'")"
REN $K owner-a "$TA" 120 | grep -q '"renewed": true' || fail "A could not renew with its token"
[[ "$(Q "select (leased_until > '$U0')::text from public.tournament_orchestrator_leases where lease_key='$K'")" == "true" ]] || fail "renew did not extend"
REN $K owner-b "$TA" 120 | grep -q '"renewed": false' || fail "wrong owner renewed"
REN $K owner-a "$(Q "select gen_random_uuid()")" 120 | grep -q '"renewed": false' || fail "wrong token renewed"
pass "A renews with owner+token (extended); wrong owner or wrong token cannot renew"
[[ "$(Q "select (abs(extract(epoch from (leased_until - (clock_timestamp() + interval '120 seconds')))) < 2)::text from public.tournament_orchestrator_leases where lease_key='$K'")" == "true" ]] \
  || fail "leased_until is not the database clock + TTL"
pass "leased_until = database clock + TTL (no caller-supplied time anywhere)"
# Real expiry on the database clock: a 5 s lease, then 5.5 s.
K2=lease-expiry; R="$(ACQ $K2 owner-a 5)"; TA2="$(tok "$R")"
Q "select pg_sleep(5.5)" >/dev/null
REN $K2 owner-a "$TA2" 5 | grep -q '"renewed": false' || fail "an expired lease was renewed by its old owner"
R="$(ACQ $K2 owner-b 120)"; TB2="$(tok "$R")"
echo "$R" | grep -q '"acquired": true' && [[ -n "$TB2" && "$TB2" != "$TA2" ]] || fail "B could not take over the expired lease with a new token ($R)"
pass "after real expiry (DB clock): the old owner cannot renew; B acquires with a NEW token"
REL $K2 owner-a "$TA2" | grep -q '"released": false' || fail "stale A released B's lease"
[[ "$(Q "select owner_id||'|'||(lease_token='$TB2')::text||'|'||(leased_until > clock_timestamp())::text from public.tournament_orchestrator_leases where lease_key='$K2'")" == "owner-b|true|true" ]] || fail "B's lease damaged by the stale release"
REN $K2 owner-a "$TA2" 120 | grep -q '"renewed": false' || fail "stale A renewed B's lease"
pass "stale A (old token) cannot release or renew B's lease; B's lease intact"
REL $K2 owner-b "$TB2" | grep -q '"released": true' || fail "B could not release its own lease"
R="$(ACQ $K2 owner-c 120)"; echo "$R" | grep -q '"acquired": true' || fail "a released lease was not immediately acquirable ($R)"
REL $K2 owner-b "$TB2" | grep -q '"released": false' || fail "a second release by B touched C's lease"
pass "B releases its own lease; it is immediately acquirable (C); B's repeat release is a no-op"
for bad in 0 4 601 -1 null; do
  ACQ "lease-ttl-$RANDOM" owner-x "$bad" | grep -q 'invalid_lease_ttl' || fail "TTL $bad accepted"
done
REN $K owner-a "$TA" 3600 | grep -q 'invalid_lease_ttl' || fail "renew accepted TTL 3600"
for ok in 5 600; do ACQ "lease-ttl-ok-$ok" owner-x $ok | grep -q '"acquired": true' || fail "TTL $ok refused"; done
pass "TTL accepted only in 5..600 s (0, 4, 601, -1, null, 3600 refused: invalid_lease_ttl)"
# client roles cannot touch the table or the RPCs
[[ "$(Q "select count(*) from information_schema.role_table_grants where table_schema='public' and table_name='tournament_orchestrator_leases' and grantee in ('anon','authenticated','public')")" == "0" ]] \
  && [[ "$(Q "select relrowsecurity::text from pg_class where oid='public.tournament_orchestrator_leases'::regclass")" == "true" ]] \
  && [[ "$(Q "select has_function_privilege('authenticated', 'public.acquire_tournament_orchestrator_lease(text,text,integer)', 'execute')::text")" == "false" ]] \
  && [[ "$(Q "select assert_security_posture()->>'hard_fail_count'")" == "0" ]] || fail "lease table/RPCs reachable by clients or posture broken"
pass "no client grants, RLS on, RPCs service_role only; assert_security_posture() still clean"
# Concurrent acquisition: 8 sessions released together, 5 rounds -> exactly one owner each round.
for ROUND in 1 2 3 4 5; do
  KR="lease-race-$ROUND"
  KIND=absent
  if [[ $ROUND -ge 3 ]]; then  # rounds 3-5: the key exists with an expired lease (the takeover path)
    KIND=expired
    Q "insert into public.tournament_orchestrator_leases values ('$KR', 'crashed-owner', gen_random_uuid(), clock_timestamp() - interval '1 second', clock_timestamp() - interval '3 minutes', clock_timestamp() - interval '2 minutes')" >/dev/null
  fi
  "$PGBIN/psql" -X -h "$SOCKDIR" -p "$PORT" -U postgres -d verify -q >/dev/null 2>&1 <<SQL_BARRIER &
select pg_advisory_lock(777000 + $ROUND);
select pg_sleep(1.5);
select pg_advisory_unlock(777000 + $ROUND);
SQL_BARRIER
  BP=$!
  sleep 0.4
  PIDS=()
  for n in 1 2 3 4 5 6 7 8; do
    "$PGBIN/psql" -X -h "$SOCKDIR" -p "$PORT" -U postgres -d verify -tAq >"$WORK/lease_${ROUND}_$n" 2>&1 <<SQL_ACQ &
select pg_advisory_lock_shared(777000 + $ROUND);
select pg_advisory_unlock_shared(777000 + $ROUND);
select public.acquire_tournament_orchestrator_lease('$KR', 'racer-$n', 120);
SQL_ACQ
    PIDS+=($!)
  done
  wait "$BP"; for pid in "${PIDS[@]}"; do wait "$pid"; done
  WINNERS="$(cat "$WORK"/lease_${ROUND}_* | grep -c '"acquired": true' || true)"
  OWNER="$(Q "select owner_id from public.tournament_orchestrator_leases where lease_key='$KR'")"
  WON="$(grep -l '"acquired": true' "$WORK"/lease_${ROUND}_* | sed 's/.*_//')"
  [[ "$WINNERS" == "1" && "$OWNER" == "racer-$WON" ]] || fail "round $ROUND: $WINNERS winners (owner $OWNER)"
  pass "round $ROUND ($KIND lease): 8 concurrent acquirers -> exactly one owner (racer-$WON), the rest acquired=false"
done

# ── 14. cancelled tournaments accept no new result (Phase 2C.1) ──────────────
echo
echo "── 12/14  completion guard: cancelled is terminal (Phase 2C.1) ─────────"
G1='dddddddd-0000-4000-8000-0000000000c1'; G2='dddddddd-0000-4000-8000-0000000000c2'
Q "insert into auth.users (id) values ('$G1'), ('$G2') on conflict do nothing" >/dev/null
# gx_bracket TID STATUS N: tournament with QF (in_progress, G1 v G2, a HIGH id) feeding
# SF1.player1 (waiting, a LOW id), an in_progress final, and both players registered 'active'.
gx_bracket() {
  local tid="$1" st="$2" n="$3"
  Q "insert into public.scheduled_tournaments (id, scheduled_start, registration_open_at, registration_close_at, status)
     values ('$tid', date_trunc('minute', now()) + interval '9 days' + interval '$n hours' + interval '57 ms', now() - interval '3 hours', now() - interval '2 hours', '$st')" >/dev/null
  Q "insert into public.scheduled_tournament_matches (id, tournament_id, round, match_number, player1_id, player2_id, room_code, status, started_at) values
       ('$(printf 'ffffffff-%04d-4000-8000-000000000001' "$n")', '$tid', 1, 1, '$G1', '$G2', 'TGQF$n', 'in_progress', now() - interval '5 min'),
       ('$(printf '00000000-%04d-4000-8000-000000000002' "$n")', '$tid', 2, 1, null, null, '', 'waiting', null),
       ('$(printf '88888888-%04d-4000-8000-000000000003' "$n")', '$tid', 3, 1, '$G1', '$G2', 'TGF$n', 'in_progress', now() - interval '5 min')" >/dev/null
  Q "insert into public.scheduled_tournament_registrations (tournament_id, user_id, status, seed) values ('$tid', '$G1', 'active', 1), ('$tid', '$G2', 'active', 2)" >/dev/null
}
QF() { printf 'ffffffff-%04d-4000-8000-000000000001' "$1"; }
SF() { printf '00000000-%04d-4000-8000-000000000002' "$1"; }
FN() { printf '88888888-%04d-4000-8000-000000000003' "$1"; }
# Everything a result could change: matches, registrations, and the tournament row.
digest() { Q "select md5(coalesce((select string_agg(m::text, ';' order by m.id) from public.scheduled_tournament_matches m where m.tournament_id='$1'),'')
                        || coalesce((select string_agg(r::text, ';' order by r.user_id) from public.scheduled_tournament_registrations r where r.tournament_id='$1'),'')
                        || (select t::text from public.scheduled_tournaments t where t.id='$1'))"; }
snap() { Q "select jsonb_agg(jsonb_build_object('id',id,'status',status,'winner_id',winner_id,'player1_id',player1_id,'player2_id',player2_id,'room_code',room_code,'status_reason',status_reason,'started_at',started_at,'completed_at',completed_at,'ready_deadline_at',ready_deadline_at,'player1_joined_at',player1_joined_at,'player2_joined_at',player2_joined_at)) from public.scheduled_tournament_matches where tournament_id='$1'"; }
GAME_OVER() { echo "select public.complete_tournament_match('$1', '$G1', 'game_over', null, 30, 12, null, null, false, 'late_game_over')"; }

# Direct refusals: cancelled (QF and final), via the no-show wrapper, completed, pre-start.
TG="eeeeeeee-0000-4000-8000-000000000001"; gx_bracket "$TG" cancelled 1
D0="$(digest "$TG")"
QE "$(GAME_OVER "$(QF 1)")" | grep -q 'tournament_cancelled' || fail "cancelled: QF result not refused"
QE "$(GAME_OVER "$(FN 1)")" | grep -q 'tournament_cancelled' || fail "cancelled: final result not refused"
Q "update public.scheduled_tournament_matches set status='ready', ready_at=now() where id='$(QF 1)'" >/dev/null; D0="$(digest "$TG")"
QE "select public.complete_tournament_match_if_unchanged('$(QF 1)', '$G1', 'no_show', 'player2_no_show', 30, 0, '$G2', 'ready', array['$G2'], 'x')" | grep -q 'tournament_cancelled' || fail "cancelled: no-show wrapper not refused"
QE "select public.complete_tournament_match('$(QF 1)', '$G1', 'forfeit', 'player2_forfeit', 30, 0, null, '$G2', false, 'x')" | grep -q 'tournament_cancelled' || fail "cancelled: forfeit not refused"
[[ "$(digest "$TG")" == "$D0" ]] || fail "cancelled: a refused result changed matches/registrations/tournament"
[[ "$(Q "select string_agg(status||':'||coalesce(placement::text,'-'), ',' order by user_id) from public.scheduled_tournament_registrations where tournament_id='$TG'")" == "active:-,active:-" ]] || fail "cancelled: registrations changed"
[[ "$(Q "select coalesce(player1_id,'-')||'|'||status from public.scheduled_tournament_matches where id='$(SF 1)'")" == "-|waiting" ]] || fail "cancelled: winner promoted"
pass "cancelled: game_over (QF, final), no-show wrapper and forfeit all refused with tournament_cancelled; matches, registrations, placements and tournament byte-identical; nothing promoted"

# Already completed before the cancellation: idempotent replay is still a safe no-op.
TC="eeeeeeee-0000-4000-8000-000000000002"; gx_bracket "$TC" in_progress 2
Q "$(GAME_OVER "$(QF 2)")" | grep -q '"applied": true' || fail "idempotent: setup result"
Q "update public.scheduled_tournaments set status='cancelled', cancel_reason='after_result' where id='$TC'" >/dev/null
D0="$(digest "$TC")"
R="$(Q "$(GAME_OVER "$(QF 2)")")"; echo "$R" | grep -q '"applied": false' && echo "$R" | grep -q '"conflict": false' || fail "idempotent: replay on a cancelled tournament ($R)"
R="$(Q "select public.complete_tournament_match('$(QF 2)', '$G2', 'game_over', null, 12, 30, null, null, false, 'x')")"; echo "$R" | grep -q '"conflict": true' || fail "idempotent: conflicting replay ($R)"
[[ "$(digest "$TC")" == "$D0" ]] || fail "idempotent: a replay wrote"
pass "already completed then cancelled: same-result replay applied=false conflict=false, a different winner conflict=true; nothing written"

# Completed tournament with an unresolved match (corrupt state): refused, history untouched.
TK="eeeeeeee-0000-4000-8000-000000000003"; gx_bracket "$TK" completed 3
D0="$(digest "$TK")"
QE "$(GAME_OVER "$(QF 3)")" | grep -q 'tournament_not_in_progress' || fail "completed: unresolved match result not refused"
QE "$(GAME_OVER "$(FN 3)")" | grep -q 'tournament_not_in_progress' || fail "completed: final re-decided"
[[ "$(digest "$TK")" == "$D0" ]] || fail "completed: history mutated"
# Pre-start statuses: a result never transitions the tournament.
for ST in upcoming registration_open; do
  TP="eeeeeeee-0000-4000-8000-00000000000$([[ $ST == upcoming ]] && echo 4 || echo 5)"; gx_bracket "$TP" "$ST" "$([[ $ST == upcoming ]] && echo 4 || echo 5)"
  D0="$(digest "$TP")"
  QE "$(GAME_OVER "$(QF "$([[ $ST == upcoming ]] && echo 4 || echo 5)")")" | grep -q 'tournament_not_in_progress' || fail "$ST: result not refused"
  [[ "$(digest "$TP")" == "$D0" ]] || fail "$ST: a result changed state"
done
pass "completed tournament + unresolved match, and upcoming / registration_open: tournament_not_in_progress, nothing written"

# Control: in_progress completes and advances, as before.
TI="eeeeeeee-0000-4000-8000-000000000006"; gx_bracket "$TI" in_progress 6
Q "$(GAME_OVER "$(QF 6)")" | grep -q '"applied": true' || fail "control: in_progress result refused"
[[ "$(Q "select player1_id from public.scheduled_tournament_matches where id='$(SF 6)'")|$(Q "select status from public.scheduled_tournament_registrations where tournament_id='$TI' and user_id='$G2'")" == "$G1|eliminated" ]] || fail "control: no advancement"
pass "control: in_progress completes, eliminates the loser and advances the winner"

for ROUND in 1 2 3; do
  # Result wins: the result commits first (holding the tournament row); the backstop's
  # snapshot cancel from before it waits, then bracket_changed — never cancels.
  N=$((10 + ROUND)); TA="$(printf 'eeeeeeee-1000-4000-8000-%012d' "$ROUND")"; gx_bracket "$TA" in_progress "$N"
  SNAP="$(snap "$TA")"
  R="$(race "$(GAME_OVER "$(QF "$N")")" "select public.cancel_tournament_if_bracket_unchanged('$TA', '$SNAP'::jsonb, 'active_window_unrecoverable:race')")"
  waited "${R%%|*}" && echo "${R#*|}" | grep -q 'bracket_changed' || fail "round $ROUND result-first: stale cancel not refused ($R)"
  [[ "$(Q "select status from public.scheduled_tournaments where id='$TA'")|$(Q "select status||':'||winner_id from public.scheduled_tournament_matches where id='$(QF "$N")'")|$(Q "select player1_id from public.scheduled_tournament_matches where id='$(SF "$N")'")" == "in_progress|completed:$G1|$G1" ]] \
    || fail "round $ROUND result-first: result/progression lost"
  pass "round $ROUND result first: cancel waited ${R%%|*}s, bracket_changed; tournament in_progress, result and advancement kept"

  # Cancellation wins (snapshot cancel): the late game-over waits on the tournament row, then tournament_cancelled.
  N=$((20 + ROUND)); TB="$(printf 'eeeeeeee-2000-4000-8000-%012d' "$ROUND")"; gx_bracket "$TB" in_progress "$N"
  SNAP="$(snap "$TB")"; D0="$(Q "select md5(string_agg(m::text, ';' order by m.id)) from public.scheduled_tournament_matches m where tournament_id='$TB'")|$(Q "select md5(string_agg(r::text, ';' order by r.user_id)) from public.scheduled_tournament_registrations r where tournament_id='$TB'")"
  R="$(race "select public.cancel_tournament_if_bracket_unchanged('$TB', '$SNAP'::jsonb, 'active_window_unrecoverable:race')" "$(GAME_OVER "$(QF "$N")")")"
  waited "${R%%|*}" && echo "${R#*|}" | grep -q 'tournament_cancelled' || fail "round $ROUND cancel-first: late result not refused ($R)"
  [[ "$(Q "select status from public.scheduled_tournaments where id='$TB'")" == "cancelled" ]] || fail "round $ROUND cancel-first: tournament revived"
  [[ "$(Q "select md5(string_agg(m::text, ';' order by m.id)) from public.scheduled_tournament_matches m where tournament_id='$TB'")|$(Q "select md5(string_agg(r::text, ';' order by r.user_id)) from public.scheduled_tournament_registrations r where tournament_id='$TB'")" == "$D0" ]] \
    || fail "round $ROUND cancel-first: matches/registrations changed"
  pass "round $ROUND cancel first (backstop): late game-over waited ${R%%|*}s, tournament_cancelled; matches and registrations byte-identical"

  # Cancellation wins (a plain conditional cancel, as an operator or M2 would issue) vs a late FINAL.
  N=$((30 + ROUND)); TF="$(printf 'eeeeeeee-3000-4000-8000-%012d' "$ROUND")"; gx_bracket "$TF" in_progress "$N"
  D0="$(Q "select md5(string_agg(m::text, ';' order by m.id)) from public.scheduled_tournament_matches m where tournament_id='$TF'")|$(Q "select md5(string_agg(r::text, ';' order by r.user_id)) from public.scheduled_tournament_registrations r where tournament_id='$TF'")"
  R="$(race "update public.scheduled_tournaments set status='cancelled', cancel_reason='m2_legacy' where id='$TF' and status='in_progress'" "$(GAME_OVER "$(FN "$N")")")"
  waited "${R%%|*}" && echo "${R#*|}" | grep -q 'tournament_cancelled' || fail "round $ROUND cancel-first final: late final not refused ($R)"
  [[ "$(Q "select status||'|'||coalesce(winner_id,'-') from public.scheduled_tournaments where id='$TF'")" == "cancelled|-" ]] || fail "round $ROUND cancel-first final: champion recorded"
  [[ "$(Q "select md5(string_agg(m::text, ';' order by m.id)) from public.scheduled_tournament_matches m where tournament_id='$TF'")|$(Q "select md5(string_agg(r::text, ';' order by r.user_id)) from public.scheduled_tournament_registrations r where tournament_id='$TF'")" == "$D0" ]] \
    || fail "round $ROUND cancel-first final: placements/matches changed"
  pass "round $ROUND cancel first (plain cancel) vs final: late final waited ${R%%|*}s, tournament_cancelled; no champion, no placements"
done

# Lock order, deterministically: X holds the (low-id) target row; the backstop cancel queues
# on it first; then the (high-id) feeder's completion arrives. When X commits, the cancel
# gets the target first. Old order (cancel: matches by id → tournament; completion:
# feeder → target) = a cycle Postgres aborts as a deadlock. New order: both take the
# tournament row first — they serialise, no deadlock; the cancel wins, the result is refused.
deadlock_round() {  # tid, n, cancel fn, complete fn -> prints "<cancel out>##<complete out>"
  local tid="$1" n="$2" cfn="$3" kfn="$4" snapj
  snapj="$(snap "$tid")"
  "$PGBIN/psql" -X -h "$SOCKDIR" -p "$PORT" -U postgres -d verify -q >/dev/null 2>&1 <<SQL_X &
begin; select 1 from public.scheduled_tournament_matches where id='$(SF "$n")' for update; select pg_sleep(2.5); commit;
SQL_X
  local xp=$!; sleep 0.8
  "$PGBIN/psql" -X -h "$SOCKDIR" -p "$PORT" -U postgres -d verify -tAqc "select public.$cfn('$tid', '$snapj'::jsonb, 'lock_order_probe')" >"$WORK/dl_c_$n" 2>&1 &
  local cp=$!; sleep 0.6
  "$PGBIN/psql" -X -h "$SOCKDIR" -p "$PORT" -U postgres -d verify -tAqc "select public.$kfn('$(QF "$n")', '$G1', 'game_over', null, 30, 12, null, null, false, 'probe')" >"$WORK/dl_k_$n" 2>&1 &
  local kp=$!
  wait "$xp"; wait "$cp" || true; wait "$kp" || true
  echo "$(tr '\n' ' ' <"$WORK/dl_c_$n")##$(tr '\n' ' ' <"$WORK/dl_k_$n")"
}
for ROUND in 1 2 3; do
  N=$((40 + ROUND)); TL="$(printf 'eeeeeeee-4000-4000-8000-%012d' "$ROUND")"; gx_bracket "$TL" in_progress "$N"
  R="$(deadlock_round "$TL" "$N" cancel_tournament_if_bracket_unchanged complete_tournament_match)"
  echo "$R" | grep -qi 'deadlock' && fail "round $ROUND lock order: deadlock with the new functions ($R)"
  echo "${R%%##*}" | grep -q '"cancelled": true' && echo "${R#*##}" | grep -q 'tournament_cancelled' || fail "round $ROUND lock order: unexpected outcome ($R)"
  [[ "$(Q "select status from public.scheduled_tournament_matches where id='$(QF "$N")'")" == "in_progress" ]] || fail "round $ROUND lock order: refused result wrote"
  pass "round $ROUND lock order (new): cancel + feeder completion queued on a held target row → no deadlock; cancelled, then tournament_cancelled"
done
# Contrast: the same schedule against harness copies of the pre-2C.1 function bodies.
python3 - "$MIGRATIONS" >"$WORK/old_fns.sql" <<'PY'
import sys, re
d = sys.argv[1]
def fn(path, name):
    s = open(f"{d}/{path}").read()
    i = s.index(f"create or replace function public.{name}(")
    return s[i:s.index("$$;", i) + 3]
print(fn("2026-08-31_tournament_match_rpcs.sql", "complete_tournament_match").replace("public.complete_tournament_match(", "public.harness_old_complete(", 1) + "\n")
print(fn("2026-10-08_tournament_orchestrator_cas.sql", "cancel_tournament_if_bracket_unchanged").replace("public.cancel_tournament_if_bracket_unchanged(", "public.harness_old_cancel(", 1) + "\n")
PY
RUN -q -f "$WORK/old_fns.sql" >/dev/null
TL="eeeeeeee-4000-4000-8000-000000000099"; gx_bracket "$TL" in_progress 99
R="$(deadlock_round "$TL" 99 harness_old_cancel harness_old_complete)"
echo "$R" | grep -qi 'deadlock detected' || fail "contrast: the pre-2C.1 lock order did not deadlock under this schedule ($R)"
Q "drop function public.harness_old_complete(uuid, text, text, text, integer, integer, text, text, boolean, text); drop function public.harness_old_cancel(uuid, jsonb, text)" >/dev/null
pass "contrast: the pre-2C.1 order (matches→tournament vs feeder→target) deadlocks under the same schedule — the cycle the new order removes"

# ── 15. M2: Live Event cadence (Phase 2D) ───────────────────────────────────
echo
echo "── 13/14  M2: two Live Events a Pacific day (Phase 2D) ─────────────────"
M2="$MIGRATIONS/2026-10-10_tournament_live_event_cadence.sql"
[[ -f "$M2" ]] || fail "M2 migration missing"

# A scratch database with the same chain (pre-M2) and a FAKE CLOCK: a session whose
# search_path puts harness_clock ahead of pg_catalog resolves the seed functions' and
# the migration's unqualified now() to harness.now. (Functions with their own
# search_path — the registration RPCs — keep the real clock; none is used here.)
"$PGBIN/createdb" -h "$SOCKDIR" -p "$PORT" -U postgres verify_m2
P2=( "$PGBIN/psql" -X -v ON_ERROR_STOP=1 -h "$SOCKDIR" -p "$PORT" -U postgres -d verify_m2 )
"${P2[@]}" -q -f "$HELPERS/shim.sql" >/dev/null
for m in "${CHAIN[@]}"; do "${P2[@]}" -q -f "$MIGRATIONS/$m" >/dev/null 2>"$WORK/err" || { cat "$WORK/err" >&2; fail "scratch chain: $m"; }; done
"${P2[@]}" -q >/dev/null <<'SQL'
create schema harness_clock;
create function harness_clock.now() returns timestamptz language sql stable as $$
  select coalesce(nullif(current_setting('harness.now', true), '')::timestamptz, pg_catalog.now()) $$;
truncate public.scheduled_tournaments cascade;
insert into auth.users (id) values ('eeeeeeee-0000-4000-8000-00000000f001'), ('eeeeeeee-0000-4000-8000-00000000f002') on conflict do nothing;
SQL
# AT <utc-iso> SQL…: run SQL in verify_m2 with the clock at that instant.
AT() { local t="$1"; shift; PGOPTIONS="-c search_path=harness_clock,pg_catalog,public -c harness.now=$t" "${P2[@]}" -tAq "$@"; }
pt() { echo "(timestamp '$1' at time zone 'America/Los_Angeles')"; }   # a Pacific local time as timestamptz
F1='2026-10-30T17:00:00Z'   # 2026-10-30 10:00 PDT — two days before the 2026-11-01 fall-back
AT "$F1" -c "select public.seed_future_tournaments(10)" >/dev/null   # the OLD body: 48 a day, the legacy inventory
pass "scratch db: pre-M2 chain + fake clock; old body seeded $(AT "$F1" -c "select count(*) from public.scheduled_tournaments") legacy rows from 2026-10-30 10:00 PT (48/day, across the DST change)"

U1='eeeeeeee-0000-4000-8000-00000000f001'
idat() { AT "$F1" -c "select id from public.scheduled_tournaments where scheduled_start = $(pt "$1")"; }
setst() { AT "$F1" -c "update public.scheduled_tournaments set status='$2' ${3:-} where scheduled_start = $(pt "$1")" >/dev/null; }
# The matrix, on rows of the legacy inventory (and three of our own):
setst '2026-10-31 09:00' registration_open                                        # registration_open (off-slot)
setst '2026-10-31 09:30' in_progress                                              # in_progress
setst '2026-10-31 10:00' completed                                                # completed
setst '2026-10-31 10:30' cancelled ", cancel_reason='manual_test'"               # already cancelled
AT "$F1" -c "insert into public.scheduled_tournament_registrations (tournament_id, user_id, status) values ('$(idat '2026-10-31 12:00')', '$U1', 'registered')" >/dev/null   # upcoming + registration
AT "$F1" -c "insert into public.scheduled_tournament_matches (tournament_id, round, match_number, room_code, status) values ('$(idat '2026-10-31 13:00')', 1, 1, '', 'waiting')" >/dev/null   # upcoming + match row
AT "$F1" -c "insert into public.scheduled_tournament_matches (tournament_id, round, match_number, room_code, status) values ('$(idat '2026-11-03 17:00')', 1, 1, '', 'waiting')" >/dev/null   # slot-time row with a match row
setst '2026-11-04 20:00' cancelled ", cancel_reason='manual_slot_cancel'"        # a cancelled SLOT: must stay cancelled
setst '2026-10-31 17:00' registration_open                                        # a slot-time registration_open with an entrant
AT "$F1" -c "insert into public.scheduled_tournament_registrations (tournament_id, user_id, status) values ('$(idat '2026-10-31 17:00')', 'eeeeeeee-0000-4000-8000-00000000f002', 'registered')" >/dev/null
AT "$F1" -q >/dev/null <<SQL
-- exactly at now + 35 min (kept) and one minute later (cancelled); off the :00/:30 grid
insert into public.scheduled_tournaments (scheduled_start, registration_open_at, registration_close_at, status)
values ($(pt '2026-10-30 10:35'), $(pt '2026-10-30 10:05'), $(pt '2026-10-30 10:33'), 'upcoming'),
       ($(pt '2026-10-30 10:36'), $(pt '2026-10-30 10:06'), $(pt '2026-10-30 10:34'), 'upcoming');
-- Fritz Cups: upcoming in the future (off-slot), in progress now, and one a microsecond after a slot
insert into public.scheduled_tournaments (scheduled_start, registration_open_at, registration_close_at, status, kind, owner_user_id)
values ($(pt '2026-10-31 14:15') + interval '0.5 s', $(pt '2026-10-31 14:15'), $(pt '2026-10-31 14:15'), 'upcoming', 'fritz_cup', '$U1'),
       ($(pt '2026-10-30 09:59') + interval '0.5 s', $(pt '2026-10-30 09:59'), $(pt '2026-10-30 09:59'), 'in_progress', 'fritz_cup', '$U1'),
       ($(pt '2026-11-05 17:00') + interval '1 microsecond', $(pt '2026-11-05 16:00'), $(pt '2026-11-05 16:58'), 'upcoming', 'fritz_cup', '$U1');
-- The state before M2, and the eligibility predicate written independently of M2's helpers.
create table pre_t as select * from public.scheduled_tournaments;
create table pre_r as select * from public.scheduled_tournament_registrations;
create table pre_m as select * from public.scheduled_tournament_matches;
create table oracle_cancel as
  select p.id from pre_t p
   where p.kind = 'live' and p.status = 'upcoming' and p.scheduled_start > now() + interval '35 minutes'
     and (p.scheduled_start at time zone 'America/Los_Angeles')::time not in ('17:00', '20:00')
     and not exists (select 1 from pre_r r where r.tournament_id = p.id)
     and not exists (select 1 from pre_m m where m.tournament_id = p.id);
create table oracle_normalize as
  select p.id from pre_t p
   where p.kind = 'live' and p.status in ('upcoming', 'registration_open') and p.scheduled_start > now()
     and (p.scheduled_start at time zone 'America/Los_Angeles')::time in ('17:00', '20:00')
     and not exists (select 1 from pre_m m where m.tournament_id = p.id);
SQL
NPRE="$(AT "$F1" -c "select count(*) from pre_t")"; NCAN="$(AT "$F1" -c "select count(*) from oracle_cancel")"; NNORM="$(AT "$F1" -c "select count(*) from oracle_normalize")"
# The documented read-only preflight, before M2 (docs/ops/tournament-m2/preflight.sql).
AT "$F1" -F '|' -f "$REPO_ROOT/docs/ops/tournament-m2/preflight.sql" >"$WORK/m2_preflight.txt" 2>&1 || { cat "$WORK/m2_preflight.txt" >&2; fail "preflight.sql"; }
pf() { grep -F "$1" "$WORK/m2_preflight.txt" | head -1 | awk -F'|' '{print $NF}'; }
[[ "$(pf 'will cancel:')" == "$NCAN" && "$(pf 'WITH registrations')" == "1" && "$(pf 'WITH match rows')" == "1" && "$(pf 'within 35 min')" == "2" && "$(pf 'CANCELLED rows at future')" == "1" ]] \
  || { cat "$WORK/m2_preflight.txt" >&2; fail "preflight.sql counts disagree with the oracle"; }
pass "preflight.sql (read-only) before M2: will cancel $NCAN (= the oracle); flags the planted anomalies (1 with a registration, 1 with a match row), 2 transition rows, 1 cancelled slot"
echo "    preflight output:"; sed -n '1,40p' "$WORK/m2_preflight.txt" | sed 's/^/      /'

PGOPTIONS="-c search_path=harness_clock,pg_catalog,public -c harness.now=$F1" "${P2[@]}" -q -f "$M2" >/dev/null 2>"$WORK/err" || { cat "$WORK/err" >&2; fail "M2 did not apply"; }
pass "M2 applied (fake clock 2026-10-30 10:00 PT) to $NPRE pre-existing rows: $NCAN eligible for cancellation, $NNORM slot-time rows to normalize"

AT "$F1" -q >/dev/null 2>"$WORK/err" <<'SQL' || { cat "$WORK/err" >&2; fail "M2 cleanup matrix"; }
do $$
declare n integer;
begin
  -- No row deleted; ids kept.
  select count(*) into n from pre_t p where not exists (select 1 from public.scheduled_tournaments t where t.id = p.id);
  assert n = 0, format('%s rows deleted', n);
  -- Exactly the eligible rows were cancelled, with cadence_replaced, and nothing else about them changed.
  select count(*) into n from oracle_cancel o join public.scheduled_tournaments t using (id) join pre_t p using (id)
   where t.status = 'cancelled' and t.cancel_reason = 'cadence_replaced'
     and (t.scheduled_start, t.registration_open_at, t.registration_close_at, t.kind, t.owner_user_id, t.winner_id, t.format, t.win_target, t.max_players, t.created_at)
       is not distinct from (p.scheduled_start, p.registration_open_at, p.registration_close_at, p.kind, p.owner_user_id, p.winner_id, p.format, p.win_target, p.max_players, p.created_at);
  assert n = (select count(*) from oracle_cancel), format('%s of %s eligible rows cancelled cleanly', n, (select count(*) from oracle_cancel));
  select count(*) into n from public.scheduled_tournaments where cancel_reason = 'cadence_replaced' and id not in (select id from oracle_cancel);
  assert n = 0, format('%s ineligible rows cadence-cancelled', n);
  -- Every other pre-existing row is byte-identical, except the slot-time window normalization.
  select count(*) into n from pre_t p join public.scheduled_tournaments t using (id)
   where p.id not in (select id from oracle_cancel) and p.id not in (select id from oracle_normalize)
     and t::text is distinct from p::text;
  assert n = 0, format('%s preserved rows changed', n);
  -- Normalized: same id, start and status; 12 h / 2 min window.
  select count(*) into n from oracle_normalize o join public.scheduled_tournaments t using (id) join pre_t p using (id)
   where t.scheduled_start = p.scheduled_start and t.status = p.status
     and t.scheduled_start - t.registration_open_at = interval '12 hours'
     and t.scheduled_start - t.registration_close_at = interval '2 minutes';
  assert n = (select count(*) from oracle_normalize), 'slot-time rows not normalized';
  -- Registrations and matches untouched.
  assert (select md5(string_agg(r::text, ';' order by r.id)) from public.scheduled_tournament_registrations r)
       = (select md5(string_agg(r::text, ';' order by r.id)) from pre_r r), 'registrations changed';
  assert (select md5(string_agg(m::text, ';' order by m.id)) from public.scheduled_tournament_matches m)
       = (select md5(string_agg(m::text, ';' order by m.id)) from pre_m m), 'matches changed';
end $$;
SQL
pass "cleanup: exactly the $NCAN eligible rows cancelled (cadence_replaced, otherwise unchanged); every other row byte-identical except the $NNORM normalized windows; no deletes; registrations and matches untouched"

chk() {  # local time, expected "status|cancel_reason|open-lead|close-lead" (leads: start - open / start - close)
  local got; got="$(AT "$F1" -c "select status||'|'||coalesce(cancel_reason,'-')||'|'||(scheduled_start-registration_open_at)::text||'|'||(scheduled_start-registration_close_at)::text from public.scheduled_tournaments where scheduled_start = $(pt "$1") and kind = 'live'")"
  [[ "$got" == "$2" ]] || fail "$3: $1 is '$got', expected '$2'"
}
chk '2026-10-30 11:00' 'cancelled|cadence_replaced|00:30:00|00:02:00' "cancel (off-slot, >35 min, empty)"
chk '2026-10-30 10:36' 'cancelled|cadence_replaced|00:30:00|00:02:00' "cancel at 36 min"
chk '2026-10-30 10:35' 'upcoming|-|00:30:00|00:02:00' "preserve exactly 35 min"
chk '2026-10-30 10:30' 'upcoming|-|00:30:00|00:02:00' "preserve inside 35 min"
chk '2026-10-30 08:00' 'upcoming|-|00:30:00|00:02:00' "preserve past"
chk '2026-10-31 09:00' 'registration_open|-|00:30:00|00:02:00' "preserve registration_open"
chk '2026-10-31 09:30' 'in_progress|-|00:30:00|00:02:00' "preserve in_progress"
chk '2026-10-31 10:00' 'completed|-|00:30:00|00:02:00' "preserve completed"
chk '2026-10-31 10:30' 'cancelled|manual_test|00:30:00|00:02:00' "preserve cancelled"
chk '2026-10-31 12:00' 'upcoming|-|00:30:00|00:02:00' "preserve upcoming + registration"
chk '2026-10-31 13:00' 'upcoming|-|00:30:00|00:02:00' "preserve upcoming + match row"
chk '2026-10-30 17:00' 'upcoming|-|12:00:00|00:02:00' "slot 17:00 today: normalized, open now in the past, still upcoming"
chk '2026-11-02 20:00' 'upcoming|-|12:00:00|00:02:00' "slot 20:00: normalized"
chk '2026-10-31 17:00' 'registration_open|-|12:00:00|00:02:00' "slot registration_open: normalized, status kept"
chk '2026-11-03 17:00' 'upcoming|-|00:30:00|00:02:00' "slot with a match row: untouched"
chk '2026-11-04 20:00' 'cancelled|manual_slot_cancel|00:30:00|00:02:00' "cancelled slot: not revived"
[[ "$(AT "$F1" -c "select count(*) from public.scheduled_tournament_registrations where tournament_id = (select id from public.scheduled_tournaments where scheduled_start = $(pt '2026-10-31 17:00'))")" == "1" ]] || fail "slot registration_open lost its entrant"
[[ "$(AT "$F1" -c "select count(*) from public.scheduled_tournaments t join pre_t p using (id) where t.kind='fritz_cup' and t::text = p::text")" == "3" ]] || fail "a Fritz Cup changed"
pass "matrix: cancel (off-slot >35 min empty; 36 min) | keep (35 min, 30 min, past, registration_open, in_progress, completed, cancelled, +registration, +match row, all 3 Fritz Cups) | slots 17:00/20:00 keep id/start/status with a 12 h / 2 min window (today's 17:00 stays upcoming, open time passed) | slot with a match row untouched | cancelled slot not revived"

AT "$F1" -q >/dev/null 2>"$WORK/err" <<'SQL' || { cat "$WORK/err" >&2; fail "M2 post-migration invariants"; }
do $$
declare n integer;
begin
  -- Every desired slot of the 30-day window exists as a Live Event (the cancelled slot stays cancelled).
  select count(*) into n from public._live_event_slots(now(), 30) s
   where not exists (select 1 from public.scheduled_tournaments t where t.scheduled_start = s.scheduled_start and t.kind = 'live');
  assert n = 0, format('%s desired slots missing', n);
  select count(*) into n from public._live_event_slots(now(), 30) s join public.scheduled_tournaments t using (scheduled_start)
   where t.status = 'upcoming' and (t.scheduled_start - t.registration_open_at, t.scheduled_start - t.registration_close_at) <> (interval '12 hours', interval '2 minutes')
     and not exists (select 1 from public.scheduled_tournament_matches m where m.tournament_id = t.id);   -- the preserved anomaly
  assert n = 0, 'a seeded or normalized slot has the wrong window';
  -- Active Live inventory beyond the 35-minute transition: only slot times, apart from the
  -- deliberately preserved rows (registration_open, a registration, a match row).
  select count(*) into n from public.scheduled_tournaments t
   where t.kind = 'live' and t.status in ('upcoming', 'registration_open') and t.scheduled_start > now() + interval '35 minutes'
     and not public._is_live_event_slot(t.scheduled_start);
  assert n = 3, format('%s off-slot active Live rows remain (expected the 3 preserved)', n);
end $$;
create table post_t as select * from public.scheduled_tournaments;
SQL
SEEDED="$(AT "$F1" -c "select count(*) from public.scheduled_tournaments where id not in (select id from pre_t)")"
AT "$F1" -F '|' -f "$REPO_ROOT/docs/ops/tournament-m2/verify.sql" >"$WORK/m2_verify.txt" 2>&1 || { cat "$WORK/m2_verify.txt" >&2; fail "verify.sql"; }
grep -F 'expect 0' "$WORK/m2_verify.txt" | awk -F'|' '$NF != 0 {bad=1} END {exit bad}' || { cat "$WORK/m2_verify.txt" >&2; fail "verify.sql: an expect-0 row is not 0"; }
[[ "$(grep -cE '^(seed_future_tournaments\|days_ahead integer|ensure_tournament_seed_window\|)\|t$' "$WORK/m2_verify.txt")" == "2" ]] || { cat "$WORK/m2_verify.txt" >&2; fail "verify.sql: function bodies"; }
pass "verify.sql (read-only) after M2: both seed functions are the M2 bodies; every expect-0 row is 0"
echo "    verify output:"; sed -n '1,40p' "$WORK/m2_verify.txt" | sed 's/^/      /'
# Idempotency: the migration again, ensure, seed — nothing changes.
PGOPTIONS="-c search_path=harness_clock,pg_catalog,public -c harness.now=$F1" "${P2[@]}" -q -f "$M2" >/dev/null 2>"$WORK/err" || { cat "$WORK/err" >&2; fail "M2 re-apply"; }
[[ "$(AT "$F1" -c "select public.ensure_tournament_seed_window()")|$(AT "$F1" -c "select public.seed_future_tournaments()")|$(AT "$F1" -c "select public.seed_future_tournaments(30)")" == "0|0|0" ]] || fail "re-seeding inserted rows"
[[ "$(AT "$F1" -c "select count(*) from (select * from public.scheduled_tournaments except select * from post_t) d")|$(AT "$F1" -c "select count(*) from public.scheduled_tournaments")" == "0|$(AT "$F1" -c "select count(*) from post_t")" ]] || fail "re-apply / re-seed changed rows"
pass "after M2: every desired slot of the 30-day window exists ($SEEDED inserted), 12 h / 2 min; active off-slot inventory = the 3 preserved rows; the migration applied again + ensure + seed() + seed(30) change nothing"

# Slot generation: DST changes and local day boundaries (run twice).
for PASSNO in 1 2; do
  AT "$F1" -q >/dev/null 2>"$WORK/err" <<'SQL' || { cat "$WORK/err" >&2; fail "slot generation (pass $PASSNO)"; }
do $$
declare
  f timestamptz; n integer; first_s timestamptz; last_s timestamptz;
  c record;
begin
  -- Windows across 2026-11-01 (fall back), 2027-03-14 (spring forward), 2027-11-07 (fall back).
  foreach f in array array[timestamptz '2026-10-25 12:00 America/Los_Angeles', timestamptz '2027-03-07 12:00 America/Los_Angeles', timestamptz '2027-11-01 12:00 America/Los_Angeles'] loop
    -- exactly two per local day, at 17:00 and 20:00 local, 30 local days, no duplicates
    select count(*) into n from (
      select (s.scheduled_start at time zone 'America/Los_Angeles')::date d, count(*) k,
             array_agg((s.scheduled_start at time zone 'America/Los_Angeles')::time order by s.scheduled_start) ts
        from public._live_event_slots(f, 30) s group by 1) x
     where k <> 2 or ts <> array[time '17:00', time '20:00'];
    assert n = 0, format('a local day without exactly 17:00 + 20:00 from %s', f);
    assert (select count(distinct (s.scheduled_start at time zone 'America/Los_Angeles')::date) from public._live_event_slots(f, 30) s) = 30, 'not 30 local days';
    assert (select count(*) from public._live_event_slots(f, 30)) = 60, 'not 60 slots';
    assert (select count(*) from public._live_event_slots(f, 30) s
             where s.scheduled_start - s.registration_open_at <> interval '12 hours'
                or s.scheduled_start - s.registration_close_at <> interval '2 minutes') = 0, 'window not 12 h / 2 min elapsed';
  end loop;
  -- The UTC instant moves with DST (expected values written out, not computed).
  assert exists (select 1 from public._live_event_slots(timestamptz '2026-10-25 12:00 America/Los_Angeles', 30) s where s.scheduled_start = timestamptz '2026-11-01 00:00:00+00'), 'Oct 31 17:00 PDT';
  assert exists (select 1 from public._live_event_slots(timestamptz '2026-10-25 12:00 America/Los_Angeles', 30) s where s.scheduled_start = timestamptz '2026-11-02 01:00:00+00' and s.registration_open_at = timestamptz '2026-11-01 13:00:00+00'), 'Nov 1 17:00 PST, opens 05:00 PST';
  assert exists (select 1 from public._live_event_slots(timestamptz '2026-10-25 12:00 America/Los_Angeles', 30) s where s.scheduled_start = timestamptz '2026-11-02 04:00:00+00'), 'Nov 1 20:00 PST';
  assert exists (select 1 from public._live_event_slots(timestamptz '2027-03-07 12:00 America/Los_Angeles', 30) s where s.scheduled_start = timestamptz '2027-03-14 01:00:00+00'), 'Mar 13 17:00 PST';
  assert exists (select 1 from public._live_event_slots(timestamptz '2027-03-07 12:00 America/Los_Angeles', 30) s where s.scheduled_start = timestamptz '2027-03-15 00:00:00+00' and s.registration_open_at = timestamptz '2027-03-14 12:00:00+00'), 'Mar 14 17:00 PDT, opens 05:00 PDT';
  assert exists (select 1 from public._live_event_slots(timestamptz '2027-03-07 12:00 America/Los_Angeles', 30) s where s.scheduled_start = timestamptz '2027-03-15 03:00:00+00'), 'Mar 14 20:00 PDT';
  -- Day boundaries: the first slot, the count, and the last slot (today + 29 at 20:00).
  for c in select * from (values
      ('2026-10-30 16:57', '2026-10-30 17:00', 60),   -- before 17:00, still registrable
      ('2026-10-30 16:59', '2026-10-30 20:00', 59),   -- 17:00 registration closed at 16:58
      ('2026-10-30 18:00', '2026-10-30 20:00', 59),
      ('2026-10-30 20:30', '2026-10-31 17:00', 58),
      ('2026-10-30 23:59:59', '2026-10-31 17:00', 58),
      ('2026-10-31 00:00:01', '2026-10-31 17:00', 60)) v(now_pt, first_pt, cnt) loop
    f := (c.now_pt::timestamp at time zone 'America/Los_Angeles');
    select min(scheduled_start), max(scheduled_start), count(*) into first_s, last_s, n from public._live_event_slots(f, 30);
    assert first_s = (c.first_pt::timestamp at time zone 'America/Los_Angeles'), format('at %s first slot %s', c.now_pt, first_s);
    assert n = c.cnt, format('at %s %s slots', c.now_pt, n);
    assert last_s = (((f at time zone 'America/Los_Angeles')::date + 29 + time '20:00') at time zone 'America/Los_Angeles'), format('at %s last slot %s', c.now_pt, last_s);
    assert not exists (select 1 from public._live_event_slots(f, 30) s where s.registration_close_at <= f), 'a closed slot generated';
  end loop;
end $$;
SQL
  # The seed function itself under each clock, on an empty table: exactly the generated set, then idempotent.
  for T in 2026-10-25T19:00:00Z 2027-03-07T20:00:00Z 2026-10-31T00:30:00Z 2026-10-31T06:59:59Z 2026-10-31T07:00:01Z; do
    "${P2[@]}" -q -c "truncate public.scheduled_tournaments cascade" >/dev/null
    N="$(AT "$T" -c "select public.ensure_tournament_seed_window()")"
    [[ "$N" == "$(AT "$T" -c "select count(*) from public._live_event_slots(now(), 30)")" ]] || fail "seed at $T inserted $N"
    [[ "$(AT "$T" -c "select count(*) from (select scheduled_start from public.scheduled_tournaments except select scheduled_start from public._live_event_slots(now(), 30)) d")|$(AT "$T" -c "select count(*) from public.scheduled_tournaments where kind <> 'live' or owner_user_id is not null or status <> 'upcoming' or format <> '7-tile' or win_target <> 30 or max_players <> 8")" == "0|0" ]] || fail "seed at $T: wrong set or row values"
    [[ "$(AT "$T" -c "select public.ensure_tournament_seed_window()")|$(AT "$T" -c "select public.seed_future_tournaments()")" == "0|0" ]] || fail "seed at $T not idempotent"
  done
  pass "pass $PASSNO: 30 local days x {17:00, 20:00} PT across 2026-11-01 / 2027-03-14 / 2027-11-07 (UTC 00:00→01:00Z and 01:00→00:00Z), 12 h / 2 min elapsed; day boundaries 16:57 / 16:59 / 18:00 / 20:30 / 23:59:59 / 00:00:01; seeding = that set (live, no owner, upcoming, default rules), then 0"
done
REP="$(AT "$F1" -c "select string_agg(to_char(s.scheduled_start at time zone 'UTC', 'MM-DD HH24:MI\"Z\"') || '=' || to_char(s.scheduled_start at time zone 'America/Los_Angeles', 'MM-DD HH24:MI\"PT\"'), '  ' order by s.scheduled_start) from public._live_event_slots(timestamptz '2026-10-31 12:00 America/Los_Angeles', 3) s")"
pass "representative (fall back): $REP"
REP="$(AT "$F1" -c "select string_agg(to_char(s.scheduled_start at time zone 'UTC', 'MM-DD HH24:MI\"Z\"') || '=' || to_char(s.scheduled_start at time zone 'America/Los_Angeles', 'MM-DD HH24:MI\"PT\"'), '  ' order by s.scheduled_start) from public._live_event_slots(timestamptz '2027-03-13 12:00 America/Los_Angeles', 3) s")"
pass "representative (spring forward): $REP"

# The real database: M2 over the real legacy inventory (05-14/05-16 seeds + §8's seed(32))
# and every fixture of §2–§12, at the real clock.
Q "create schema harness; create table harness.pre_t as select * from public.scheduled_tournaments; create table harness.pre_r as select * from public.scheduled_tournament_registrations; create table harness.pre_m as select * from public.scheduled_tournament_matches" >/dev/null
# Rows within a minute of the 35-minute line can legitimately fall either side while this runs: excluded from the oracle check.
Q "create table harness.oracle_cancel as select p.id from harness.pre_t p where p.kind='live' and p.status='upcoming' and p.scheduled_start > now() + interval '36 minutes'
     and (p.scheduled_start at time zone 'America/Los_Angeles')::time not in ('17:00','20:00')
     and not exists (select 1 from harness.pre_r r where r.tournament_id=p.id) and not exists (select 1 from harness.pre_m m where m.tournament_id=p.id)" >/dev/null
Q "create table harness.edge as select id from harness.pre_t where scheduled_start between now() + interval '34 minutes' and now() + interval '36 minutes'" >/dev/null
RNPRE="$(Q "select count(*) from harness.pre_t")"; RNCAN="$(Q "select count(*) from harness.oracle_cancel")"
RUN -q -f "$M2" >/dev/null 2>"$WORK/err" || { cat "$WORK/err" >&2; fail "M2 on the main database"; }
RUN -q >/dev/null 2>"$WORK/err" <<'SQL' || { cat "$WORK/err" >&2; fail "M2 on the main database: invariants"; }
do $$
declare n integer;
begin
  assert (select count(*) from harness.pre_t p where not exists (select 1 from public.scheduled_tournaments t where t.id = p.id)) = 0, 'rows deleted';
  assert (select count(*) from harness.oracle_cancel o join public.scheduled_tournaments t using (id) where t.status = 'cancelled' and t.cancel_reason = 'cadence_replaced') = (select count(*) from harness.oracle_cancel), 'eligible rows not cancelled';
  -- cadence_replaced only on empty future upcoming Live off-slot rows
  select count(*) into n from public.scheduled_tournaments t join harness.pre_t p using (id)
   where t.cancel_reason = 'cadence_replaced'
     and (p.kind <> 'live' or p.status <> 'upcoming' or public._is_live_event_slot(p.scheduled_start)
          or exists (select 1 from harness.pre_r r where r.tournament_id = p.id) or exists (select 1 from harness.pre_m m where m.tournament_id = p.id));
  assert n = 0, format('%s ineligible rows cadence-cancelled', n);
  -- every other row unchanged, except slot-time windows
  select count(*) into n from harness.pre_t p join public.scheduled_tournaments t using (id)
   where p.id not in (select id from harness.oracle_cancel) and p.id not in (select id from harness.edge)
     and not (p.kind = 'live' and p.status in ('upcoming', 'registration_open') and p.scheduled_start > now() and public._is_live_event_slot(p.scheduled_start))
     and t::text is distinct from p::text;
  assert n = 0, format('%s preserved rows changed', n);
  assert (select md5(string_agg(r::text, ';' order by r.id)) from public.scheduled_tournament_registrations r) = (select md5(string_agg(r::text, ';' order by r.id)) from harness.pre_r r), 'registrations changed';
  assert (select md5(string_agg(m::text, ';' order by m.id)) from public.scheduled_tournament_matches m) = (select md5(string_agg(m::text, ';' order by m.id)) from harness.pre_m m), 'matches changed';
  assert (select count(*) from public._live_event_slots(now(), 30) s where not exists (select 1 from public.scheduled_tournaments t where t.scheduled_start = s.scheduled_start and t.kind = 'live')) = 0, 'desired slots missing';
  assert (select count(*) from public.scheduled_tournaments where kind = 'fritz_cup' and cancel_reason = 'cadence_replaced') = 0, 'a Fritz Cup was cadence-cancelled';
end $$;
SQL
pass "main db (real clock): $RNCAN of $RNPRE rows cadence-cancelled (exactly the eligible ones); every other row — §2–§12 fixtures, Fritz Cups, registrations, matches — unchanged but slot-time windows; desired slots present"
for fn in "seed_future_tournaments:days_ahead integer" "ensure_tournament_seed_window:"; do
  [[ "$(Q "select pg_get_function_identity_arguments(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='${fn%%:*}'")" == "${fn#*:}" ]] || fail "signature of ${fn%%:*} changed"
done
for h in "_live_event_slots(timestamptz,integer)" "_is_live_event_slot(timestamptz)" "_live_event_slot_times()"; do
  [[ "$(Q "select has_function_privilege('anon', 'public.$h', 'execute')::text || has_function_privilege('authenticated', 'public.$h', 'execute')::text || has_function_privilege('service_role', 'public.$h', 'execute')::text")" == "falsefalsetrue" ]] || fail "$h grants"
done
[[ "$(Q "select (public.assert_security_posture()->>'hard_fail_count')::int")" == "0" ]] || fail "posture after M2: $(Q "select public.assert_security_posture()")"
pass "public signatures unchanged (seed_future_tournaments(days_ahead integer), ensure_tournament_seed_window()); helpers service_role only; assert_security_posture() clean"

# pg_cron-equivalent and Node-equivalent seeding, concurrently (behind a barrier) and back to back.
BEFORE="$(Q "select count(*) from public.scheduled_tournaments")"
for ROUND in 1 2 3; do
  Q "delete from public.scheduled_tournaments t where t.kind='live' and t.status='upcoming' and t.scheduled_start > now() + interval '20 days' and public._is_live_event_slot(t.scheduled_start)
       and not exists (select 1 from public.scheduled_tournament_registrations r where r.tournament_id=t.id)" >/dev/null   # scratch: open holes for both callers to fill
  "$PGBIN/psql" -X -h "$SOCKDIR" -p "$PORT" -U postgres -d verify -q >/dev/null 2>&1 <<SQL_B &
select pg_advisory_lock(888000 + $ROUND); select pg_sleep(0.6); select pg_advisory_unlock(888000 + $ROUND);
SQL_B
  BP=$!; sleep 0.2
  "$PGBIN/psql" -X -h "$SOCKDIR" -p "$PORT" -U postgres -d verify -tAq >"$WORK/m2_cron_$ROUND" 2>&1 <<SQL_C &
select pg_advisory_lock_shared(888000 + $ROUND); select pg_advisory_unlock_shared(888000 + $ROUND);
select public.ensure_tournament_seed_window();
SQL_C
  CP=$!
  "$PGBIN/psql" -X -h "$SOCKDIR" -p "$PORT" -U postgres -d verify -tAq >"$WORK/m2_node_$ROUND" 2>&1 <<SQL_N &
select pg_advisory_lock_shared(888000 + $ROUND); select pg_advisory_unlock_shared(888000 + $ROUND);
set role service_role;
select public.ensure_tournament_seed_window();
SQL_N
  NP=$!
  wait "$BP"; wait "$CP"; wait "$NP"
  grep -qi error "$WORK/m2_cron_$ROUND" "$WORK/m2_node_$ROUND" && fail "round $ROUND concurrent seeding errored: $(cat "$WORK"/m2_*_$ROUND)"
  A="$(tail -1 "$WORK/m2_cron_$ROUND")"; B="$(tail -1 "$WORK/m2_node_$ROUND")"
  [[ $((A + B)) -gt 0 ]] || fail "round $ROUND: nothing re-seeded"
  [[ "$(Q "select count(*) - count(distinct scheduled_start) from public.scheduled_tournaments")|$(Q "select count(*) from public._live_event_slots(now(), 30) s where not exists (select 1 from public.scheduled_tournaments t where t.scheduled_start = s.scheduled_start)")" == "0|0" ]] || fail "round $ROUND: duplicates or holes"
  [[ "$(Q "select public.ensure_tournament_seed_window()")|$(Q "set role service_role; select public.seed_future_tournaments(30)" | tail -1)" == "0|0" ]] || fail "round $ROUND: back-to-back re-seed inserted"
  pass "round $ROUND: cron-style (owner) and Node-style (service_role) ensure concurrently: filled the holes between them ($A + $B), no error, no duplicate, no hole; back to back: 0 + 0"
done

# Overlap is the event's 2-hour window at scheduled_start, never its 12-hour registration period.
OV="dddddddd-0000-4000-8000-0000000000d"; Q "insert into auth.users (id) values ('${OV}1'), ('${OV}2'), ('${OV}3') on conflict do nothing" >/dev/null
ov_event() {  # id, start offset sql; registration open (12 h window), off the slot grid
  Q "insert into public.scheduled_tournaments (id, scheduled_start, registration_open_at, registration_close_at, status)
     values ('$1', date_trunc('second', now()) + $2 + interval '17 ms', date_trunc('second', now()) + $2 - interval '12 hours', date_trunc('second', now()) + $2 - interval '2 minutes', 'registration_open')" >/dev/null
}
ov_event 'dddddddd-0000-4000-8000-0000000000e1' "interval '10 hours'"
ov_event 'dddddddd-0000-4000-8000-0000000000e2' "interval '13 hours'"
ov_event 'dddddddd-0000-4000-8000-0000000000e3' "interval '1 hour'"
Q "select public.register_for_tournament('dddddddd-0000-4000-8000-0000000000e1', '${OV}1')" | grep -q '"registered": true' || fail "overlap: registering 10 h ahead"
Q "select public.start_fritz_cup('${OV}1')" | grep -q '"existing": false' || fail "overlap: a cup now was refused for a user registered 10 h ahead: $(QE "select public.start_fritz_cup('${OV}1')")"
Q "select public.register_for_tournament('dddddddd-0000-4000-8000-0000000000e1', '${OV}3')" >/dev/null
Q "select public.register_for_tournament('dddddddd-0000-4000-8000-0000000000e2', '${OV}3')" | grep -q '"registered": true' || fail "overlap: two events 3 h apart"
Q "select public.register_for_tournament('dddddddd-0000-4000-8000-0000000000e3', '${OV}2')" >/dev/null
QE "select public.start_fritz_cup('${OV}2')" | grep -q 'overlapping_tournament' || fail "overlap: a cup inside the event's 2-hour window was allowed"
pass "overlap: registered 10 h ahead (12-h registration open) -> a Fritz Cup now is allowed; events 3 h apart (17:00 / 20:00) can both be entered; an event starting within 2 h still blocks a cup"

# ── 16. M4: Live Events at 6 pm and 9 pm Eastern ────────────────────────────
echo
echo "── 14/14  M4: two Live Events an Eastern day, 6 pm and 9 pm ─────────────"
M4="$MIGRATIONS/2026-10-31_tournament_live_event_times_eastern.sql"
[[ -f "$M4" ]] || fail "M4 migration missing"

# A scratch database in the state production is in after M2: the chain + M2, the old Pacific 17:00 / 20:00 inventory seeded,
# and the same FAKE CLOCK as §13 (a session search_path puts harness_clock ahead of pg_catalog).
"$PGBIN/createdb" -h "$SOCKDIR" -p "$PORT" -U postgres verify_m4
P4=( "$PGBIN/psql" -X -v ON_ERROR_STOP=1 -h "$SOCKDIR" -p "$PORT" -U postgres -d verify_m4 )
"${P4[@]}" -q -f "$HELPERS/shim.sql" >/dev/null
for m in "${CHAIN[@]}"; do "${P4[@]}" -q -f "$MIGRATIONS/$m" >/dev/null 2>"$WORK/err" || { cat "$WORK/err" >&2; fail "M4 scratch chain: $m"; }; done
"${P4[@]}" -q -f "$M2" >/dev/null 2>"$WORK/err" || { cat "$WORK/err" >&2; fail "M4 scratch: M2"; }
"${P4[@]}" -q >/dev/null <<'SQL'
create schema harness_clock;
create function harness_clock.now() returns timestamptz language sql stable as $$
  select coalesce(nullif(current_setting('harness.now', true), '')::timestamptz, pg_catalog.now()) $$;
truncate public.scheduled_tournaments cascade;
insert into auth.users (id) values ('eeeeeeee-0000-4000-8000-00000000f401'), ('eeeeeeee-0000-4000-8000-00000000f402') on conflict do nothing;
SQL
AT4() { local t="$1"; shift; PGOPTIONS="-c search_path=harness_clock,pg_catalog,public -c harness.now=$t" "${P4[@]}" -tAq "$@"; }
pt4() { echo "(timestamp '$1' at time zone 'America/Los_Angeles')"; }   # a Pacific local time as timestamptz
et4() { echo "(timestamp '$1' at time zone 'America/New_York')"; }      # an Eastern local time as timestamptz
F4='2026-10-30T17:00:00Z'   # 2026-10-30 13:00 EDT, two days before the 2026-11-01 fall-back
[[ "$(AT4 "$F4" -c "select public._live_event_timezone()")" == "America/Los_Angeles" ]] || fail "M4 scratch: not in the M2 state"
AT4 "$F4" -c "select public.seed_future_tournaments(10)" >/dev/null   # M2's inventory: Pacific 17:00 and 20:00 for 10 days
pass "scratch db: chain + M2, fake clock 2026-10-30 13:00 ET; M2 seeded $(AT4 "$F4" -c "select count(*) from public.scheduled_tournaments") Pacific-schedule rows (17:00 / 20:00 PT)"

U1='eeeeeeee-0000-4000-8000-00000000f401'; U2='eeeeeeee-0000-4000-8000-00000000f402'
id4() { AT4 "$F4" -c "select id from public.scheduled_tournaments where scheduled_start = $1"; }
set4() { AT4 "$F4" -c "update public.scheduled_tournaments set status='$2' ${3:-} where scheduled_start = $1" >/dev/null; }
# The matrix, on rows of the old inventory (A: empty upcoming, to be cancelled) and our own:
AT4 "$F4" -c "insert into public.scheduled_tournament_registrations (tournament_id, user_id, status) values ('$(id4 "$(pt4 '2026-11-03 20:00')")', '$U1', 'registered')" >/dev/null   # B: upcoming + a registration
AT4 "$F4" -c "insert into public.scheduled_tournament_matches (tournament_id, round, match_number, room_code, status) values ('$(id4 "$(pt4 '2026-11-04 17:00')")', 1, 1, '', 'waiting')" >/dev/null   # C: upcoming + a match row
set4 "$(pt4 '2026-11-04 20:00')" registration_open                                                                                         # D: registration_open + an entrant
AT4 "$F4" -c "insert into public.scheduled_tournament_registrations (tournament_id, user_id, status) values ('$(id4 "$(pt4 '2026-11-04 20:00')")', '$U2', 'registered')" >/dev/null
set4 "$(pt4 '2026-11-05 17:00')" cancelled ", cancel_reason='manual_test'"                                                               # E: already cancelled
set4 "$(pt4 '2026-11-05 20:00')" completed                                                                                                 # F: completed
set4 "$(pt4 '2026-11-06 17:00')" in_progress                                                                                               # G: in progress
AT4 "$F4" -q >/dev/null <<SQL
-- exactly now + 35 min (kept) and one minute later (cancelled); off any grid
insert into public.scheduled_tournaments (scheduled_start, registration_open_at, registration_close_at, status)
values (timestamptz '$F4' + interval '35 minutes', timestamptz '$F4', timestamptz '$F4' + interval '33 minutes', 'upcoming'),
       (timestamptz '$F4' + interval '36 minutes', timestamptz '$F4', timestamptz '$F4' + interval '34 minutes', 'upcoming');
-- a Fritz Cup in the future at an old slot time: never touched
insert into public.scheduled_tournaments (scheduled_start, registration_open_at, registration_close_at, status, kind, owner_user_id)
values ($(pt4 '2026-11-06 20:00') + interval '0.5 s', $(pt4 '2026-11-06 20:00'), $(pt4 '2026-11-06 20:00'), 'upcoming', 'fritz_cup', '$U1');
-- two rows already at NEW slot times: one with a legacy 30-minute window (to be normalized), one with a match row (untouched)
insert into public.scheduled_tournaments (scheduled_start, registration_open_at, registration_close_at, status)
values ($(et4 '2026-11-02 18:00'), $(et4 '2026-11-02 18:00') - interval '30 minutes', $(et4 '2026-11-02 18:00') - interval '2 minutes', 'upcoming'),
       ($(et4 '2026-11-02 21:00'), $(et4 '2026-11-02 21:00') - interval '30 minutes', $(et4 '2026-11-02 21:00') - interval '2 minutes', 'upcoming');
SQL
AT4 "$F4" -c "insert into public.scheduled_tournament_matches (tournament_id, round, match_number, room_code, status) values ('$(id4 "$(et4 '2026-11-02 21:00')")', 1, 1, '', 'waiting')" >/dev/null
AT4 "$F4" -q >/dev/null <<'SQL'
-- The state before M4, and the eligibility predicate written independently of M4's helpers.
create table pre_t as select * from public.scheduled_tournaments;
create table pre_r as select * from public.scheduled_tournament_registrations;
create table pre_m as select * from public.scheduled_tournament_matches;
create table oracle_cancel as
  select p.id from pre_t p
   where p.kind = 'live' and p.status = 'upcoming' and p.scheduled_start > now() + interval '35 minutes'
     and (p.scheduled_start at time zone 'America/New_York')::time not in ('18:00', '21:00')
     and not exists (select 1 from pre_r r where r.tournament_id = p.id)
     and not exists (select 1 from pre_m m where m.tournament_id = p.id);
create table oracle_normalize as
  select p.id from pre_t p
   where p.kind = 'live' and p.status in ('upcoming', 'registration_open') and p.scheduled_start > now()
     and (p.scheduled_start at time zone 'America/New_York')::time in ('18:00', '21:00')
     and not exists (select 1 from pre_m m where m.tournament_id = p.id);
SQL
NPRE="$(AT4 "$F4" -c "select count(*) from pre_t")"; NCAN="$(AT4 "$F4" -c "select count(*) from oracle_cancel")"; NNORM="$(AT4 "$F4" -c "select count(*) from oracle_normalize")"
[[ "$NCAN" -gt 10 && "$NNORM" == "1" ]] || fail "M4 matrix: oracle looks wrong (cancel $NCAN, normalize $NNORM)"

# The documented read-only preflight, before M4 (docs/ops/tournament-m4/preflight.sql).
AT4 "$F4" -F '|' -f "$REPO_ROOT/docs/ops/tournament-m4/preflight.sql" >"$WORK/m4_preflight.txt" 2>&1 || { cat "$WORK/m4_preflight.txt" >&2; fail "M4 preflight.sql"; }
pf4() { grep -F "$1" "$WORK/m4_preflight.txt" | head -1 | awk -F'|' '{print $NF}'; }
grep -q '^America/Los_Angeles|{17:00:00,20:00:00}$' "$WORK/m4_preflight.txt" || { cat "$WORK/m4_preflight.txt" >&2; fail "M4 preflight.sql: not reporting the current Pacific schedule"; }
[[ "$(pf4 'will cancel:')" == "$NCAN" && "$(pf4 'WITH registrations')" == "1" && "$(pf4 'WITH match rows')" == "1" && "$(pf4 'within 35 min')" == "1" && "$(pf4 'already at 18:00')" == "2" && "$(pf4 'CANCELLED rows at future')" == "0" ]] \
  || { cat "$WORK/m4_preflight.txt" >&2; fail "M4 preflight.sql counts disagree with the oracle"; }
AT4 "$F4" -F '|' -f "$REPO_ROOT/docs/ops/tournament-launch/prod-preflight.sql" >"$WORK/m4_prodpre_before.txt" 2>&1 || { cat "$WORK/m4_prodpre_before.txt" >&2; fail "prod-preflight.sql before M4"; }
grep -q '^M4 schedule is 18:00 / 21:00 America/New_York|f$' "$WORK/m4_prodpre_before.txt" || { cat "$WORK/m4_prodpre_before.txt" >&2; fail "prod-preflight.sql: M4 row not false before M4"; }
grep -qi 'error' "$WORK/m4_prodpre_before.txt" && { cat "$WORK/m4_prodpre_before.txt" >&2; fail "prod-preflight.sql errored before M4"; }
pass "preflight.sql (read-only) before M4: reports the Pacific schedule; will cancel $NCAN (= the oracle); flags the planted anomalies (1 with a registration, 1 with a match row), 1 transition row, 2 rows already at a new slot"

PGOPTIONS="-c search_path=harness_clock,pg_catalog,public -c harness.now=$F4" "${P4[@]}" -q -f "$M4" >/dev/null 2>"$WORK/err" || { cat "$WORK/err" >&2; fail "M4 did not apply"; }
pass "M4 applied to $NPRE rows: $NCAN eligible for cancellation (the oracle), $NNORM already-at-a-new-slot row to normalize"

AT4 "$F4" -q >/dev/null 2>"$WORK/err" <<'SQL' || { cat "$WORK/err" >&2; fail "M4 cleanup matrix"; }
do $$
declare n integer;
begin
  -- Exactly the eligible rows were cancelled, with schedule_changed, and nothing else was.
  select count(*) into n from oracle_cancel o join public.scheduled_tournaments t using (id)
   where t.status <> 'cancelled' or t.cancel_reason is distinct from 'schedule_changed';
  assert n = 0, format('%s eligible rows not cancelled as schedule_changed', n);
  select count(*) into n from public.scheduled_tournaments where cancel_reason = 'schedule_changed' and id not in (select id from oracle_cancel);
  assert n = 0, format('%s ineligible rows cancelled', n);
  -- No deletes, and every other pre-existing row is unchanged except the normalized window.
  select count(*) into n from pre_t p where not exists (select 1 from public.scheduled_tournaments t where t.id = p.id);
  assert n = 0, format('%s rows deleted', n);
  select count(*) into n from pre_t p join public.scheduled_tournaments t using (id)
   where p.id not in (select id from oracle_cancel) and p.id not in (select id from oracle_normalize)
     and (p.status, p.kind, p.scheduled_start, p.registration_open_at, p.registration_close_at, p.cancel_reason, p.owner_user_id)
         is distinct from (t.status, t.kind, t.scheduled_start, t.registration_open_at, t.registration_close_at, t.cancel_reason, t.owner_user_id);
  assert n = 0, format('%s untouched-by-rule rows changed', n);
  -- The row already at a new slot time without a match row got the standard window; same id, same start.
  select count(*) into n from oracle_normalize o join public.scheduled_tournaments t using (id) join pre_t p using (id)
   where t.scheduled_start = p.scheduled_start and t.scheduled_start - t.registration_open_at = interval '12 hours'
     and t.scheduled_start - t.registration_close_at = interval '2 minutes';
  assert n = (select count(*) from oracle_normalize), 'the normalized row did not get the 12 h / 2 min window';
  -- The one with a match row is left exactly as it was (legacy window included).
  select count(*) into n from pre_t p join public.scheduled_tournaments t using (id)
   where exists (select 1 from pre_m m where m.tournament_id = p.id) and p.scheduled_start = t.scheduled_start
     and (p.registration_open_at, p.registration_close_at) = (t.registration_open_at, t.registration_close_at)
     and (p.scheduled_start at time zone 'America/New_York')::time = time '21:00';
  assert n = 1, 'the new-slot row with a match row was altered';
  -- Registrations and match rows are byte-identical.
  assert (select count(*) from public.scheduled_tournament_registrations) = (select count(*) from pre_r), 'registration count changed';
  assert (select count(*) from public.scheduled_tournament_matches) = (select count(*) from pre_m), 'match count changed';
  assert not exists (select 1 from pre_r r where not exists (select 1 from public.scheduled_tournament_registrations x where x.tournament_id = r.tournament_id and x.user_id = r.user_id and x.status = r.status)), 'a registration changed';
  -- Fritz Cups: never touched.
  assert (select count(*) from public.scheduled_tournaments where kind = 'fritz_cup' and cancel_reason is not null) = 0, 'a Fritz Cup was cancelled';
end $$;
SQL
pass "cleanup: exactly the $NCAN eligible rows cancelled (schedule_changed); registrations, match rows, cancelled / completed / in-progress rows, the 35-minute boundary row, the registration_open entrant and the Fritz Cup all untouched; the already-at-a-new-slot row got 12 h / 2 min; no deletes"

AT4 "$F4" -F '|' -f "$REPO_ROOT/docs/ops/tournament-launch/prod-preflight.sql" >"$WORK/m4_prodpre_after.txt" 2>&1 || { cat "$WORK/m4_prodpre_after.txt" >&2; fail "prod-preflight.sql after M4"; }
grep -q '^M4 schedule is 18:00 / 21:00 America/New_York|t$' "$WORK/m4_prodpre_after.txt" || { cat "$WORK/m4_prodpre_after.txt" >&2; fail "prod-preflight.sql: M4 row not true after M4"; }
pass "prod-preflight.sql (read-only) runs clean on both sides of M4: its M4 row reads false before and true after"
# The documented read-only verify, after M4 (docs/ops/tournament-m4/verify.sql).
AT4 "$F4" -F '|' -f "$REPO_ROOT/docs/ops/tournament-m4/verify.sql" >"$WORK/m4_verify.txt" 2>&1 || { cat "$WORK/m4_verify.txt" >&2; fail "M4 verify.sql"; }
grep -q '^America/New_York|{18:00:00,21:00:00}$' "$WORK/m4_verify.txt" || { cat "$WORK/m4_verify.txt" >&2; fail "M4 verify.sql: not reporting the Eastern schedule"; }
grep -F 'expect 0' "$WORK/m4_verify.txt" | awk -F'|' '$NF != 0 {bad=1} END {exit bad}' || { cat "$WORK/m4_verify.txt" >&2; fail "M4 verify.sql: an expect-0 row is not 0"; }
[[ "$(grep -cE '^(seed_future_tournaments\|days_ahead integer|ensure_tournament_seed_window\|)\|t$' "$WORK/m4_verify.txt")" == "2" ]] || { cat "$WORK/m4_verify.txt" >&2; fail "M4 verify.sql: function bodies"; }
pass "verify.sql (read-only) after M4: the schedule is America/New_York 18:00 / 21:00, both seed functions keep their M2 bodies, every expect-0 row is 0"
echo "    verify output:"; sed -n '1,40p' "$WORK/m4_verify.txt" | sed 's/^/      /'

# The new schedule itself, across both DST changes (run twice: M4 is idempotent).
for PASSNO in 1 2; do
  AT4 "$F4" -q >/dev/null 2>"$WORK/err" <<'SQL' || { cat "$WORK/err" >&2; fail "M4 slot generation (pass $PASSNO)"; }
do $$
declare f timestamptz; n integer;
begin
  assert public._live_event_timezone() = 'America/New_York', 'timezone';
  -- Windows across 2026-11-01 (fall back), 2027-03-14 (spring forward), 2027-11-07 (fall back).
  foreach f in array array[timestamptz '2026-10-25 12:00 America/New_York', timestamptz '2027-03-07 12:00 America/New_York', timestamptz '2027-11-01 12:00 America/New_York'] loop
    -- exactly two per Eastern day, at 18:00 and 21:00 local, 30 local days, no duplicates
    select count(*) into n from (
      select (s.scheduled_start at time zone 'America/New_York')::date d, count(*) k,
             array_agg((s.scheduled_start at time zone 'America/New_York')::time order by s.scheduled_start) ts
        from public._live_event_slots(f, 30) s group by 1) x
     where k <> 2 or ts <> array[time '18:00', time '21:00'];
    assert n = 0, format('an Eastern day without exactly 18:00 + 21:00 from %s', f);
    assert (select count(distinct (s.scheduled_start at time zone 'America/New_York')::date) from public._live_event_slots(f, 30) s) = 30, 'not 30 local days';
    assert (select count(*) from public._live_event_slots(f, 30)) = 60, 'not 60 slots';
    assert (select count(*) from public._live_event_slots(f, 30) s
             where s.scheduled_start - s.registration_open_at <> interval '12 hours'
                or s.scheduled_start - s.registration_close_at <> interval '2 minutes') = 0, 'window not 12 h / 2 min elapsed';
  end loop;
  -- The UTC instant moves with DST (expected values written out, not computed).
  assert exists (select 1 from public._live_event_slots(timestamptz '2026-10-25 12:00 America/New_York', 30) s where s.scheduled_start = timestamptz '2026-10-31 22:00:00+00'), 'Oct 31 18:00 EDT';
  assert exists (select 1 from public._live_event_slots(timestamptz '2026-10-25 12:00 America/New_York', 30) s where s.scheduled_start = timestamptz '2026-11-01 01:00:00+00'), 'Oct 31 21:00 EDT';
  assert exists (select 1 from public._live_event_slots(timestamptz '2026-10-25 12:00 America/New_York', 30) s where s.scheduled_start = timestamptz '2026-11-01 23:00:00+00' and s.registration_open_at = timestamptz '2026-11-01 11:00:00+00'), 'Nov 1 18:00 EST, opens 06:00 EST';
  assert exists (select 1 from public._live_event_slots(timestamptz '2026-10-25 12:00 America/New_York', 30) s where s.scheduled_start = timestamptz '2026-11-02 02:00:00+00'), 'Nov 1 21:00 EST';
  assert exists (select 1 from public._live_event_slots(timestamptz '2027-03-07 12:00 America/New_York', 30) s where s.scheduled_start = timestamptz '2027-03-13 23:00:00+00'), 'Mar 13 18:00 EST';
  assert exists (select 1 from public._live_event_slots(timestamptz '2027-03-07 12:00 America/New_York', 30) s where s.scheduled_start = timestamptz '2027-03-14 22:00:00+00' and s.registration_open_at = timestamptz '2027-03-14 10:00:00+00'), 'Mar 14 18:00 EDT, opens 06:00 EDT';
  assert exists (select 1 from public._live_event_slots(timestamptz '2027-03-07 12:00 America/New_York', 30) s where s.scheduled_start = timestamptz '2027-03-15 01:00:00+00'), 'Mar 14 21:00 EDT';
end $$;
SQL
  # The seed function itself under several clocks, on an empty table: exactly the generated set, then idempotent.
  for T in 2026-10-25T19:00:00Z 2027-03-07T20:00:00Z 2026-10-31T00:30:00Z 2026-10-31T21:59:59Z 2026-10-31T22:00:01Z; do
    "${P4[@]}" -q -c "truncate public.scheduled_tournaments cascade" >/dev/null
    N="$(AT4 "$T" -c "select public.ensure_tournament_seed_window()")"
    [[ "$N" == "$(AT4 "$T" -c "select count(*) from public._live_event_slots(now(), 30)")" ]] || fail "M4 seed at $T inserted $N"
    [[ "$(AT4 "$T" -c "select count(*) from (select scheduled_start from public.scheduled_tournaments except select scheduled_start from public._live_event_slots(now(), 30)) d")" == "0" ]] || fail "M4 seed at $T: wrong set"
    [[ "$(AT4 "$T" -c "select public.ensure_tournament_seed_window()")|$(AT4 "$T" -c "select public.seed_future_tournaments()")" == "0|0" ]] || fail "M4 seed at $T not idempotent"
  done
  pass "pass $PASSNO: 30 local days x {18:00, 21:00} ET across 2026-11-01 / 2027-03-14 / 2027-11-07 (UTC 22:00Z, 01:00Z in EDT; 23:00Z, 02:00Z in EST), 12 h / 2 min elapsed; seeding = that set, then 0"
done
# Restore the post-M4 matrix state (the loop above truncated it) and prove applying M4 again changes nothing.
"${P4[@]}" -q -c "truncate public.scheduled_tournaments cascade" >/dev/null
AT4 "$F4" -c "select public.ensure_tournament_seed_window()" >/dev/null   # the full default window, under M4: the new schedule
AT4 "$F4" -c "select t::text from public.scheduled_tournaments t order by id" >"$WORK/m4_before.txt"
PGOPTIONS="-c search_path=harness_clock,pg_catalog,public -c harness.now=$F4" "${P4[@]}" -q -f "$M4" >/dev/null 2>"$WORK/err" || { cat "$WORK/err" >&2; fail "M4 re-apply"; }
AT4 "$F4" -c "select t::text from public.scheduled_tournaments t order by id" >"$WORK/m4_after.txt"
cmp -s "$WORK/m4_before.txt" "$WORK/m4_after.txt" || { diff "$WORK/m4_before.txt" "$WORK/m4_after.txt" | head -8 >&2; fail "M4 is not idempotent: re-applying changed the table"; }
[[ "$(AT4 "$F4" -c "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and ((p.proname = 'seed_future_tournaments' and pg_get_function_identity_arguments(p.oid) = 'days_ahead integer') or (p.proname = 'ensure_tournament_seed_window' and pg_get_function_identity_arguments(p.oid) = ''))")" == "2" ]] || fail "M4 changed a public function signature"
pass "M4 applied again: the table is byte-identical; the public seed functions keep their signatures (pg_cron and every deployed server call them unchanged)"
REP="$(AT4 "$F4" -c "select string_agg(to_char(s.scheduled_start at time zone 'UTC', 'MM-DD HH24:MI\"Z\"') || '=' || to_char(s.scheduled_start at time zone 'America/New_York', 'MM-DD HH24:MI\"ET\"'), '  ' order by s.scheduled_start) from public._live_event_slots(timestamptz '2026-10-31 12:00 America/New_York', 3) s")"
pass "representative (fall back): $REP"


HARNESS_COMPLETED=1
echo
echo "════════════════════════════════════════════════════════════════════════"
echo "  tournament-db-verify: ALL CHECKS PASSED"
echo "════════════════════════════════════════════════════════════════════════"
