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
echo "── 1/8  greenfield apply ─────────────────────────────────────────────"
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
echo "── 2/8  FOR UPDATE serialization ─────────────────────────────────────"
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
echo "── 3/8  RLS registrations lockdown ──────────────────────────────────"
[[ "$(Q "select count(*) from pg_policies where schemaname='public' and tablename='scheduled_tournament_registrations' and cmd in ('INSERT','UPDATE','DELETE','ALL') and roles && array['anon','authenticated','public']::name[]")" == "0" ]] \
  || fail "a client-writable policy survives on scheduled_tournament_registrations"
[[ "$(Q "select count(*) from information_schema.role_table_grants where table_schema='public' and table_name='scheduled_tournament_registrations' and grantee in ('anon','authenticated','public') and privilege_type in ('INSERT','UPDATE','DELETE')")" == "0" ]] \
  || fail "a client write grant survives on scheduled_tournament_registrations"
[[ "$(Q "select relrowsecurity from pg_class where oid='public.scheduled_tournament_registrations'::regclass")" == "t" ]] \
  || fail "RLS is not enabled on scheduled_tournament_registrations"
pass "0 client-writable policies, 0 client write grants, RLS on"

# ── 6. assert_security_posture() catches a planted violation ───────────────
echo
echo "── 4/8  assert_security_posture() ───────────────────────────────────"
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
echo "── 5/8  registration RPCs (A2, A7) ──────────────────────────────────"
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
echo "── 6/8  generate_tournament_bracket v2 (A1, B8) ─────────────────────"
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
echo "── 7/8  cancel_reason (Q9) ──────────────────────────────────────────"
[[ "$(Q "select count(*) from information_schema.columns where table_schema='public' and table_name='scheduled_tournaments' and column_name='cancel_reason'")" == "1" ]] \
  || fail "scheduled_tournaments.cancel_reason missing"
pass "scheduled_tournaments.cancel_reason exists"


# ── 10. M1: tournament kind, Fritz Cup, per-user overlap lock ────────────────
echo
echo "── 8/8  M1: kind, Fritz Cup, overlap lock (Phase 2B) ─────────────────"
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

echo
echo "════════════════════════════════════════════════════════════════════════"
echo "  tournament-db-verify: ALL CHECKS PASSED"
echo "════════════════════════════════════════════════════════════════════════"
