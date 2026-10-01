#!/usr/bin/env bash
#
# review-jobs-db-verify.sh — local-only verification of the review completion
# job RPCs (2026-10-01_review_completion_worker_isolation.sql).
#
# LOCAL ONLY, same boundary as tournament-db-verify.sh: it spins its OWN
# throwaway PostgreSQL 16 instance in a temp dir, never reads any .env or
# Supabase URL, aborts if one is set, and deletes the instance on exit.
# Not run in CI (no Postgres service). See docs/ops/review-jobs-db-verify.md.
#
# What it proves:
#   1. The review_completion_jobs chain applies greenfield, and the new
#      migration retires every pending/running job created before it as
#      failed_fatal / pre_isolation_outage, leaving complete jobs alone.
#   2. claim_review_completion_job_v2 re-checks due-ness on the locked row:
#      a job whose next_attempt_at was pushed out AFTER a sweep listed it is
#      not claimed (the 2026-10-01 43da2288 re-claim), and a live lease is not
#      claimed, even with the same claim token.
#   3. A due job is claimed: attempt +1, generation +1, lease, backoff.
#   4. Backoff doubles per attempt and caps; at the attempt cap the job goes
#      failed_fatal / max_attempts_exceeded and is not claimed.
#   5. renew_review_completion_lease is fenced on token + generation.
#   6. Two sessions claiming the same job serialize on the row lock; exactly
#      one wins.
#   7. A checkpoint from a superseded generation is rejected.
#   8. Client roles cannot execute the new RPCs.

set -euo pipefail

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
SHIM="$REPO_ROOT/scripts/tournament-db-verify/shim.sql"
HELPERS="$REPO_ROOT/scripts/review-jobs-db-verify"

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
  echo "ABORT: PostgreSQL 16 not found. brew install postgresql@16." >&2
  exit 3
fi
echo "pg16 toolchain: $PGBIN"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/rh-reviewjobs.XXXXXX")"
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

"$PGBIN/initdb" -D "$PGDATA" -U postgres --auth=trust --no-sync -E UTF8 >/dev/null
"$PGBIN/pg_ctl" -D "$PGDATA" -o "-p $PORT -k $SOCKDIR -c listen_addresses=''" -w start >/dev/null
"$PGBIN/createdb" -h "$SOCKDIR" -p "$PORT" -U postgres verify

PSQL=( "$PGBIN/psql" -X -v ON_ERROR_STOP=1 -h "$SOCKDIR" -p "$PORT" -U postgres -d verify )
RUN() { "${PSQL[@]}" "$@"; }
Q()   { "${PSQL[@]}" -tAqc "$1"; }
pass() { echo "  PASS  $1"; }
fail() { echo "  FAIL  $1" >&2; exit 1; }
expect() { # expect <label> <actual> <expected>
  if [[ "$2" == "$3" ]]; then pass "$1"; else fail "$1 — expected '$3', got '$2'"; fi
}
apply() {
  [[ -f "$MIGRATIONS/$1" ]] || fail "migration missing from repo: $1"
  if ! RUN -q -f "$MIGRATIONS/$1" >/dev/null 2>"$WORK/err"; then
    echo "---- $1 ----" >&2; cat "$WORK/err" >&2
    fail "migration failed to apply: $1"
  fi
  pass "$1"
}
# claim <id> <token> [max_attempts] → claimed id or NULL
claim() {
  Q "select coalesce(r.id, 'NULL') from public.claim_review_completion_job_v2('$1', '$2', 60000, ${3:-5}, 30000, 900000) r"
}

echo
echo "── 1/8  greenfield apply + pre_isolation_outage retirement ───────────"
RUN -q -f "$SHIM" >/dev/null
pass "Supabase shim"
apply 2026-09-23_review_completion_jobs.sql
apply 2026-09-23_review_completion_jobs_claim_rpc.sql
apply 2026-09-24_review_completion_rpc_permissions.sql
RUN -q -f "$HELPERS/pre_fix_seed.sql" >/dev/null
pass "seeded pre-fix jobs (pending, running x2 with a pushed-out next_attempt_at, complete)"
apply 2026-10-01_review_completion_worker_isolation.sql
expect "pre-fix pending/running jobs retired" \
  "$(Q "select count(*) from review_completion_jobs where id like 'prefix-%' and status = 'failed_fatal' and failure_reason = 'pre_isolation_outage' and claim_token is null and lease_expires_at is null")" "3"
expect "pre-fix complete job untouched" \
  "$(Q "select status || ':' || coalesce(failure_reason, 'null') from review_completion_jobs where id = 'prefix-complete'")" "complete:null"
expect "retired job is not claimable" "$(claim prefix-running-a tok-x)" "NULL"

RUN -q -f "$HELPERS/post_fix_seed.sql" >/dev/null

echo
echo "── 2/8  due check at the moment of claiming ──────────────────────────"
# A sweep lists 'due-paused' while it is due ...
expect "listed while due" \
  "$(Q "select count(*) from public.list_claimable_review_completion_jobs(64) where id = 'due-paused'")" "1"
# ... then an operator pushes next_attempt_at out before the claim lands.
Q "update review_completion_jobs set next_attempt_at = now() + interval '7 days' where id = 'due-paused'" >/dev/null
expect "pushed-out job not claimed from the stale list" "$(claim due-paused sweep-stale)" "NULL"
expect "pushed-out job row unchanged" \
  "$(Q "select claim_generation || ':' || attempt_count || ':' || coalesce(claim_token, 'null') from review_completion_jobs where id = 'due-paused'")" "0:0:null"
expect "live lease not claimed by another token" "$(claim live-lease tok-other)" "NULL"
expect "live lease not re-claimed by its own token" "$(claim live-lease tok-live)" "NULL"

echo
echo "── 3/8  due job is claimed ───────────────────────────────────────────"
expect "due job claimed" "$(claim fresh tok-a)" "fresh"
expect "attempt 1, generation 1, running, token set" \
  "$(Q "select attempt_count || ':' || claim_generation || ':' || status || ':' || claim_token from review_completion_jobs where id = 'fresh'")" "1:1:running:tok-a"
expect "lease = now + 60s" \
  "$(Q "select round(extract(epoch from lease_expires_at - updated_at)) from review_completion_jobs where id = 'fresh'")" "60"
expect "next_attempt_at = now + lease + 30s backoff" \
  "$(Q "select round(extract(epoch from next_attempt_at - updated_at)) from review_completion_jobs where id = 'fresh'")" "90"
expect "claimed job not claimable again while leased" "$(claim fresh tok-b)" "NULL"

echo
echo "── 4/8  backoff doubles and caps; attempt cap is terminal ────────────"
due_now() { Q "update review_completion_jobs set lease_expires_at = now() - interval '1 second', next_attempt_at = now() - interval '1 second' where id = '$1'" >/dev/null; }
gap() { Q "select round(extract(epoch from next_attempt_at - updated_at)) from review_completion_jobs where id = '$1'"; }
due_now fresh; claim fresh tok-2 >/dev/null
expect "attempt 2 backoff 60s (+60s lease)" "$(gap fresh)" "120"
due_now fresh; claim fresh tok-3 >/dev/null
expect "attempt 3 backoff 120s" "$(gap fresh)" "180"
Q "update review_completion_jobs set attempt_count = 10 where id = 'backoff-cap'" >/dev/null
expect "backoff caps at 900s" "$(Q "select coalesce(r.id, 'NULL') from public.claim_review_completion_job_v2('backoff-cap', 't', 60000, 50, 30000, 900000) r")" "backoff-cap"
expect "capped gap = 60 + 900" "$(gap backoff-cap)" "960"
due_now fresh; claim fresh tok-4 3 >/dev/null || true
expect "at cap (3 of 3): not claimed" "$(claim fresh tok-5 3)" "NULL"
expect "at cap: failed_fatal / max_attempts_exceeded, unleased" \
  "$(Q "select status || ':' || failure_reason || ':' || coalesce(claim_token, 'null') || ':' || coalesce(lease_expires_at::text, 'null') from review_completion_jobs where id = 'fresh'")" "failed_fatal:max_attempts_exceeded:null:null"

echo
echo "── 5/8  renew_review_completion_lease fencing ────────────────────────"
claim renew tok-r >/dev/null
GEN="$(Q "select claim_generation from review_completion_jobs where id = 'renew'")"
Q "update review_completion_jobs set lease_expires_at = now() + interval '5 seconds' where id = 'renew'" >/dev/null
expect "renew with token + generation" "$(Q "select public.renew_review_completion_lease('renew', 'tok-r', $GEN, 60000)")" "t"
expect "renew extended the lease" \
  "$(Q "select lease_expires_at > now() + interval '50 seconds' from review_completion_jobs where id = 'renew'")" "t"
expect "renew with wrong token" "$(Q "select public.renew_review_completion_lease('renew', 'tok-x', $GEN, 60000)")" "f"
expect "renew with stale generation" "$(Q "select public.renew_review_completion_lease('renew', 'tok-r', $((GEN - 1)), 60000)")" "f"
Q "update review_completion_jobs set status = 'failed_fatal' where id = 'renew'" >/dev/null
expect "renew on a terminal job" "$(Q "select public.renew_review_completion_lease('renew', 'tok-r', $GEN, 60000)")" "f"

echo
echo "── 6/8  concurrent claims serialize on the row lock ──────────────────"
OUT_A="$WORK/a.out"
"$PGBIN/psql" -X -v ON_ERROR_STOP=1 -h "$SOCKDIR" -p "$PORT" -U postgres -d verify -tAq >"$OUT_A" 2>&1 <<SQL_A &
begin;
select coalesce(r.id, 'NULL') from public.claim_review_completion_job_v2('race', 'tok-A', 60000, 5, 30000, 900000) r;
select pg_sleep(2);
commit;
SQL_A
A_PID=$!
sleep 0.5
T0=$(python3 -c 'import time; print(time.time())')
B_RES="$(claim race tok-B)"
T1=$(python3 -c 'import time; print(time.time())')
wait "$A_PID"
A_RES="$(grep -v '^$' "$OUT_A" | head -1)"
expect "session A claimed" "$A_RES" "race"
expect "session B lost after waiting for A" "$B_RES" "NULL"
python3 -c "import sys; sys.exit(0 if $T1 - $T0 >= 1.0 else 1)" && pass "B blocked on A's row lock (>= 1s)" || fail "B did not block on the row lock"
expect "exactly one claim recorded" \
  "$(Q "select attempt_count || ':' || claim_generation || ':' || claim_token from review_completion_jobs where id = 'race'")" "1:1:tok-A"

echo
echo "── 7/8  superseded generation cannot checkpoint ──────────────────────"
claim stale tok-old >/dev/null
OLD_GEN="$(Q "select claim_generation from review_completion_jobs where id = 'stale'")"
due_now stale
claim stale tok-new >/dev/null
expect "old pass checkpoint rejected" \
  "$(Q "select coalesce(r.id, 'NULL') from public.checkpoint_review_completion_job('stale', 'tok-old', $OLD_GEN, '{}'::jsonb, 'running', 60000, null) r")" "NULL"
expect "current pass checkpoint accepted" \
  "$(Q "select coalesce(r.id, 'NULL') from public.checkpoint_review_completion_job('stale', 'tok-new', $((OLD_GEN + 1)), '{}'::jsonb, 'running', 60000, null) r")" "stale"

echo
echo "── 8/8  grants ───────────────────────────────────────────────────────"
for fn in \
  "public.claim_review_completion_job_v2(text, text, integer, integer, integer, integer)" \
  "public.renew_review_completion_lease(text, text, bigint, integer)"; do
  expect "anon/authenticated cannot execute $fn" \
    "$(Q "select has_function_privilege('anon', '$fn', 'EXECUTE') or has_function_privilege('authenticated', '$fn', 'EXECUTE')")" "f"
  expect "service_role can execute $fn" "$(Q "select has_function_privilege('service_role', '$fn', 'EXECUTE')")" "t"
done

echo
echo "ALL CHECKS PASSED"
