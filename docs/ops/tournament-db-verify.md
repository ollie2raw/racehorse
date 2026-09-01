# tournament-db-verify

`scripts/tournament-db-verify.sh` — a **local-only** verification of the
tournament database layer. Step 5 / PR-G of the tournament hardening plan.

## Why it is not in CI

CI has no PostgreSQL service and no migration runner. That gap is the reason
three reviewed lockdown migrations sat unapplied in this repo before anyone
noticed (T-1, the ghost/bot RLS tables, the `commit_glicko` RPC — see
`HARDENING_PLAN.md` → "Infra / liveness"). The weekly `security-posture.yml`
workflow catches the *consequences* against prod; this script verifies the
*mechanics* against a fresh database. Run it:

- before merging a PR that changes any `supabase/migrations/*tournament*` file,
  `2026-08-31_tournament_match_rpcs.sql`, or the RLS lockdown migration
- when touching `complete_tournament_match` / `promote_tournament_match` /
  `generate_tournament_bracket`
- if you just want to know the tournament schema still stands up greenfield

## Prerequisites

PostgreSQL 16 on `PATH` (or at `/opt/homebrew/opt/postgresql@16/bin`):

```
brew install postgresql@16
```

The script does **not** need a running server — it spins its own throwaway
instance in a temp directory (`initdb` + `pg_ctl` on a random high port and a
private socket), and deletes it on exit.

## Run

```
bash scripts/tournament-db-verify.sh
```

Exit 0 + `ALL CHECKS PASSED` on success; non-zero with a `FAIL` line otherwise.

## The prod-safety boundary

This script **cannot reach production**:

- It creates and uses only its own temp `initdb` instance. Every `psql` call
  targets that instance's private socket.
- There is no code path that reads `server/.env`, `client/.env`,
  `SUPABASE_URL`, `VITE_SUPABASE_URL`, or any `postgres://` / `*.supabase.co`
  string.
- It **aborts (exit 2)** before doing anything if `PGHOST` / `PGHOSTADDR` /
  `PGURL` / `PGURI` / `DATABASE_URL` / `SUPABASE_*_URL` is set to a URL or a
  Supabase host, or if any argument looks like a remote connection target.
- The one destructive step (§4 below — `alter table … disable row level
  security`) runs against the throwaway instance and is re-enabled two
  statements later.

## What it checks

1. **Greenfield apply.** A Supabase shim (`scripts/tournament-db-verify/shim.sql`
   — `auth` schema, `auth.users`, `auth.uid()`, the `anon` / `authenticated` /
   `service_role` roles) plus the curated tournament migration chain, applied
   in order to a fresh pg16. The `2026-08-30` RLS lockdown migration
   self-asserts as part of this — if a client-writable policy or grant would
   survive, it raises and rolls back and the script fails.

   The chain is a **curated subset**, not the full 42-file history (which needs
   more of Supabase than a shim provides). It is the list in `CHAIN=( … )` in
   the script — add a line when a new migration touches the tournament tables,
   the RPCs, or the registrations RLS.

2. **`SELECT … FOR UPDATE` serialization.** Two `psql` sessions call
   `complete_tournament_match()` on the same match row with **different
   winners**. Session A holds its transaction open; session B blocks on A's row
   lock until A commits (measured — B must wait ≥ 1s), then takes the
   idempotent/conflict branch (`applied:false`, `conflict:true`, recorded
   winner = A's). The bracket is then asserted to show exactly one completion
   and one advancement, loser eliminated once.

   This guards against the **T-3 / T-4** bug — double bracket advancement,
   wrong champion, un-eliminated loser — recurring if the row lock in
   `complete_tournament_match` is ever weakened or bypassed. The JS in-memory
   port (`inMemoryMatchRpc.testkit.ts`, exercised by
   `concurrencyRecoveryHarness.test.ts`) cannot cover this: Node's event loop
   serializes it for free.

3. **RLS registrations lockdown.** The three diagnostics from
   `supabase/tests/rls_registrations_lockdown.sql` run against the
   freshly-migrated schema — 0 client-writable policies, 0 client write grants,
   RLS enabled.

4. **`assert_security_posture()` catches a planted violation.** On the clean
   schema it returns `hard_fail_count = 0`; after
   `alter table public.scheduled_tournament_matches disable row level security`
   it returns `hard_fail_count = 1` naming that table with `rls_disabled`;
   after re-enabling, `0` again. This is the runtime check the drift detector's
   unit test (`server/src/securityPostureRpc.test.ts`, text-only, no Postgres)
   defers to here.

## Related

- `supabase/tests/rls_registrations_lockdown.sql` — the same three RLS
  diagnostics as a standalone artifact to paste into the Supabase SQL editor
  against **prod**.
- `.github/workflows/security-posture.yml` — weekly `assert_security_posture()`
  against prod.
