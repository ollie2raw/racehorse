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

5. **Registration RPCs** (`2026-09-29_tournament_registration_rpcs.sql`,
   tournament review A2 / A7), on fixtures from
   `scripts/tournament-db-verify/phase1_seed.sql`:
   - Two sessions claim the **last seat** of a 2-seat event. Session A holds
     its transaction open; session B must block on the tournament row lock
     (≥ 1s), then see A's committed row and get `tournament_full`. Exactly 2
     of 2 seats end up taken. Node cannot show this: it needs two real
     Postgres sessions.
   - Re-registering an entrant on a full event is idempotent
     (`already_registered`).
   - Registering after `registration_close_at`, while the status is still
     `registration_open` (the scheduler hasn't ticked), gets
     `registration_closed` from the database clock and writes nothing.
   - Withdraw before close deletes the row; withdraw on the `in_progress`
     bracket from §2 gets `withdraw_closed` and the row is kept.

6. **`generate_tournament_bracket` v2** (`2026-09-29_tournament_bracket_rpc_repair.sql`,
   review A1 / B8): a tournament left with 4 unplayed QF rows by the old
   insert-by-insert path is repaired to all 7 rows, `in_progress`, and
   registrations `active` with the bracket seeds, in one call; a retry is a
   no-op; a seed list missing a registrant gets `registrations_changed`; and
   partial state containing a played match gets `bracket_partial_conflict`.

7. **`cancel_reason`** exists on `scheduled_tournaments` (review Q9).

8. **M1: tournament kind, Fritz Cup, per-user overlap lock**
   (`2026-10-07_tournament_kind_fritz_cup.sql`, Phase 2B), on fixtures from
   `scripts/tournament-db-verify/m1_seed.sql`:
   - Every existing and newly seeded row is `kind='live'` with no owner; a
     Fritz Cup without an owner, a Live Event with one, and an unknown kind are
     rejected; the existing RPC signatures are unchanged.
   - `start_fritz_cup` creates one `fritz_cup` row (`registration_open`, due
     now, never a whole-second start) and only the owner's registration;
     a retry returns the same cup (`existing: true`).
   - Two sessions creating a cup for the same user: B blocks on the per-user
     advisory lock, then gets A's cup. A deterministic `scheduled_start`
     collision steps forward 1 µs; 12 users released behind a barrier all get
     cups with unique starts.
   - Overlap in both directions (`overlapping_tournament` with the conflicting
     tournament), including two-session races; the same event re-registered is
     still `already_registered`; eliminated / cancelled / completed holds no
     longer block; Fritz Cups refuse the public registration RPC.
   - The 60 s cooldown and the 20-per-24 h limit (`fritz_cup_cooldown`), and an
     active cup still returned at the limit; the bracket RPC starts a cup
     unchanged.

   The fixtures for §6 use their own users, since one user can no longer hold
   two tournaments starting minutes apart.

9. **Pre-start cancellation vs start** (Phase 2B.1). The server cancels a
   tournament before its start (`not_enough_players`, or the five-strike
   `bracket_generation_failed:*`) with one conditional PATCH, which PostgREST
   runs as `UPDATE … WHERE id = … AND status IN ('upcoming','registration_open')
   RETURNING id`. Run three times in both orders against
   `generate_tournament_bracket`:
   - start first: the cancel blocks on the bracket's row lock, then updates 0
     rows; the tournament stays `in_progress` with its 7 matches;
   - cancel first: the bracket call blocks on the row lock, then raises
     `tournament_not_startable`; the tournament stays cancelled, no matches.
   A contrast run shows the pre-2B.1 unconditional update overwriting a
   started tournament. Empty `registration_open` / `upcoming` events are still
   cancelled; `in_progress`, `completed` and already-cancelled rows are
   untouched; Fritz Cups follow the same rule.

10. **Orchestrator late writes** (`2026-10-08_tournament_orchestrator_cas.sql`,
    Phase 2C). Each guard is raced three times: a holder session commits a
    newer write after ~3 s, and a stale session issues the guarded write at
    ~1.5 s, built from the state read before the holder's change. Every time
    the stale write blocks on the row lock, then updates 0 rows / is refused,
    and the holder's state survives field for field:
    - open registration (`status = 'upcoming'` and due);
    - dispatch (compare-and-set on status, room_code, ready_at,
      ready_deadline_at, status_reason) — and a started match is never moved
      back;
    - ready → in_progress (`status = 'ready'`) vs a recorded result;
    - deadline extension (`status`, `ready_deadline_at`, `status_reason`);
    - `complete_tournament_match_if_unchanged`: `attendance_changed` when the
      named absentee joined first, `match_state_changed` when the game started
      first (and, reversed, the no-show commits and the late join waits);
    - `cancel_tournament_if_no_entrants`: a last-moment registration that
      commits first prevents the cancel; once the database clock has closed
      registration an empty event is cancelled and later registration refused;
    - `cancel_tournament_if_bracket_unchanged`: a match completed after the
      backstop's snapshot blocks the cancel (`bracket_changed`); so does a
      repair that leaves every status unchanged; an unchanged bracket cancels.

11. **M3 orchestrator lease** (`2026-10-08_tournament_orchestrator_lease.sql`,
    Phase 2C): acquire on an absent key mints a token; a second owner cannot
    acquire a valid lease (no token leaked) and the holder must renew, not
    re-acquire; renew needs owner + token; `leased_until` is the database
    clock + TTL; after a real 5 s expiry the old owner cannot renew and a new
    owner acquires with a new token; the stale owner cannot release or renew
    it; the owner's release makes the key immediately acquirable; TTL is
    accepted only in 5..600 s; the table and RPCs are not client-reachable and
    `assert_security_posture()` stays clean. Eight sessions released behind a
    barrier acquire concurrently, five rounds (absent key, then an expired
    lease taken over): exactly one owner every round.

12. **Completion guard** (`2026-10-09_tournament_completion_guard.sql`,
    Phase 2C.1): an unresolved match of a `cancelled` tournament is refused
    with `tournament_cancelled` by every completion path (game over on a QF and
    on the final, the no-show wrapper, forfeit), and the tournament, its
    matches and registrations stay byte-identical (nothing promoted, no
    placement, no champion). A result recorded before the cancellation replays
    as an idempotent no-op (`conflict` for a different winner). A `completed`
    tournament with an unresolved match, and `upcoming` / `registration_open`
    tournaments, refuse with `tournament_not_in_progress`. Three rounds of each
    race: result first (the backstop's stale snapshot cancel waits on the
    tournament row, then `bracket_changed`; the result and its advancement
    stand) and cancellation first (backstop cancel, and a plain conditional
    cancel against a late final: the late result waits, then
    `tournament_cancelled`, nothing written). Lock order, deterministically: a
    third session holds the low-id target row while a cancel queues on it and
    then a high-id feeder's completion arrives — with the new functions they
    serialise on the tournament row (no deadlock; cancelled, then refused);
    the same schedule against copies of the pre-2C.1 bodies deadlocks.

13. **M2 Live Event cadence** (`2026-10-10_tournament_live_event_cadence.sql`,
    Phase 2D). Applied last, by this section (not in `CHAIN`), so it runs over
    a real pre-M2 state:
    - A scratch database (`verify_m2`) with the same chain and a **fake
      clock**: a session `search_path` of `harness_clock, pg_catalog, public`
      resolves the seed functions' and the migration's unqualified `now()` to
      `harness.now`. The old 48-a-day body seeds the legacy inventory from
      2026-10-30 10:00 PT (across the 2026-11-01 fall-back), the cleanup
      matrix is planted on it, and M2 is applied at that clock. Checked
      against a predicate written independently of M2: exactly the eligible
      rows are cancelled `cadence_replaced` (otherwise unchanged); every other
      row is byte-identical except slot-time windows; the 35-minute boundary
      (35 min kept, 36 min cancelled), past, `registration_open`,
      `in_progress`, `completed`, cancelled, +registration, +match row and
      three Fritz Cups are kept; slot rows keep id / start / status with a
      12 h / 2 min window (today's 17:00 stays `upcoming` with its opening time
      passed); a slot row with a match row is untouched; a cancelled slot is
      not revived; no deletes; registrations and matches unchanged; every
      desired slot exists; the migration applied again, `ensure` and `seed`
      change nothing.
    - Slot generation, twice: 30 local days × {17:00, 20:00} PT across
      2026-11-01, 2027-03-14 and 2027-11-07, with the UTC instants written
      out; 12 h / 2 min elapsed; day boundaries (16:57, 16:59, 18:00, 20:30,
      23:59:59, 00:00:01); seeding at five clocks = exactly that set, then 0.
    - The real database: M2 over the real legacy inventory and every fixture
      of §2–§12; public signatures unchanged; helpers service_role only;
      `assert_security_posture()` clean; three rounds of a pg_cron-style
      (owner) and a Node-style (service_role) `ensure` released together
      behind a barrier: no error, duplicate or hole, then 0 + 0; overlap stays
      the 2-hour window at `scheduled_start` (registered 10 h ahead → a Fritz
      Cup now is allowed; 17:00 and 20:00 can both be entered).
    - `docs/ops/tournament-m2/preflight.sql` and `verify.sql` run before and
      after M2 on the scratch database.

The harness exits non-zero if it stops before its final banner for any
reason (macOS bash 3.2 otherwise reports 0 after a `set -u` abort).

## Related

- `supabase/tests/rls_registrations_lockdown.sql` — the same three RLS
  diagnostics as a standalone artifact to paste into the Supabase SQL editor
  against **prod**.
- `.github/workflows/security-posture.yml` — weekly `assert_security_posture()`
  against prod.
