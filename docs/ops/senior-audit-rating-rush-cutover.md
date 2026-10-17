# Ghost and Puzzle Rush rating/run cutover

These migrations are **not deployed by the application**. Apply them to the
intended environment deliberately, with migration success and server version
verified at each step. Do not use the disposable PostgreSQL test fixture on
production. Keep the Ghost and Rush expand migrations together before the
new binary; keep both contract migrations until the old binary is gone.

The server builds below are the ones that matter. Keep them straight:

* **OLD** — the server currently in production (the base of this remediation,
  `main` at the commit you record in preflight).
* **BRIDGE (historical, superseded as a deployment artifact)** — `3ccd6ff8c73c5cfd0efb24dde83d62cca82f7353` on
  `release/rating-cutover-bridge` (OLD plus the quiescence gate). It is the base BRIDGE′ was built from and the origin of the gate
  semantics. **Never deploy it and never roll back to it** (see the rollback rule): it writes room epoch 0.
  The OLD binary cannot be told to stop; that is why a bridge deploy comes first, and that bridge is BRIDGE′ below.
* **BRIDGE′ ("BRIDGE Prime"; what is actually deployed in Step -1)** — `release/rating-cutover-bridge-prime` at
  `7f5003404e6e87f06b8d4028130fb213340a77be`: historical BRIDGE `3ccd6ff8` plus exactly three commits, confined to `server/src/multiplayer/roomLivePersistence.ts`
  and tests: a **writer epoch** on room snapshots, and the rule that a process's writer-order identity is **fixed for its lifetime**
  (no gate, rating, Ghost or Rush code is touched).
  Why it exists: production `3a65ab1c` and historical BRIDGE `3ccd6ff8` run **byte-identical room persistence** and both write with the
  implicit writer epoch 0, so during the Render production -> BRIDGE replacement the database cannot order an equal-sequence tie between
  them (reproduced with real processes: `server/scripts/roomOverlapRace.ts`, production vs stock BRIDGE: the older process wins
  the tie, and a legacy pair can also recreate a retired match). BRIDGE′ makes the new process distinguishable.
  **Writer-epoch lifetime model.** Persistence boot initialization (`configureLiveRoomPersistence`, before the server listens) makes ONE
  allocation attempt of `next_room_writer_epoch()`. Success freezes that positive epoch for the life of the process; failure freezes the
  process at legacy epoch 0 for its whole life and logs `writer epoch could not be allocated at boot` once. Nothing ever changes it later
  (no lazy or timed retry), so an older process can never turn into a *newer* epoch and beat a process that booted after it. Recovery
  from a failed allocation is a **restart** (which allocates anew). Apply the Step -1 migrations *before* deploying BRIDGE′; a BRIDGE′
  that booted without them must be restarted after they are applied.
  Gate semantics are exactly those of `3ccd6ff8`. **Do not deploy `3ccd6ff8` itself.**
* **NEW** — `feat/app-store-candidate` after the backend-runtime gate integration.
  The former candidate `74ad0fec46dc6b79c7c1689f95b16ce93b7e4a67` is superseded;
  resolve and record the current remote branch SHA, rather than reuse that old artifact.
  Last reviewed release candidate: `4e670955326ce811161516e1806706b69f421f5b` (it contains the validated runtime remediation
  `cba5667564c956c1f269a492e06ad107ce3af2f3`, the final backend hardening and the iOS release gates). Descendants after it are limited to
  test/CI-contract and documentation changes; confirm by diffing `4e670955326ce811161516e1806706b69f421f5b` against the branch HEAD at preflight.
  It writes ratings through atomic database
  functions, so it counts the gate's state but is never blocked by it.

Historical BRIDGEs `d8198d98`, `e3517fb0da9644ccede64697309d7af8d9ffb8ee` and (as a deployment artifact) `3ccd6ff8c73c5cfd0efb24dde83d62cca82f7353`
are superseded. The latter reported drained while scheduled ranking catch-up
could still commit. **Do not deploy any historical artifact.** The corrected
artifact above (BRIDGE′) gates boot/periodic/weekly catch-up, admin ranking processing and
authenticated Fritz disconnect handling with the existing admission primitive.
The disconnect unit begins before its pending-match mutation. No candidate
features or full reliability branch were merged into BRIDGE or BRIDGE′.

## Why the expand steps fence old writes

The old Ghost writer commits a `ghost_games` row, then separately writes the
`ghost_profiles` rating/count. Its HTTP route subsequently completes the
verified match. Either Ghost write can succeed while the next one fails or its
response is lost. The old Fritz path writes the ranked result first, schedules
the Ghost training profile write without awaiting it, and may then complete
the match. The expand migration requires a Ghost receipt before a verified
Fritz ranked insert, so old in-room persistence fails visibly instead of
silently omitting its training write. A `NULL` receipt on a pre-cutover row
therefore proves neither
"rated" nor "unrated". The expand migration leaves such rows unresolved,
blocks direct legacy Ghost rating writes, and requires a new receipt before a
verified Ghost HTTP completion. The new writer uses one atomic RPC. Investigate
any in-room persistence failure and reconcile its Ghost training outcome after
cutover. Do not
infer whether a legacy Ghost row was rated from `rating_applied_at` alone.

The old Rush writer creates open runs without a durable puzzle assignment.
The Rush expand migration lets that creation occur but fences direct legacy
reports and result publication. A new server invalidates an unassigned open
run, releases its official slot, and allows a fresh assigned run. It never
reconstructs an unknown assignment or grades an old unassigned run.

## Compatibility

| Ghost stage | DB state | Old server safe? | New server safe? | Allowed writes |
| --- | --- | --- | --- | --- |
| G0 | Existing schema | Yes | No | Existing Ghost flow |
| G1 | Ghost expand | Fail closed for new Ghost writes | Yes | New atomic Ghost RPC; old rating writes rejected |
| G2 | Ghost expand, new binary live | Old instances fail closed | Yes | New atomic Ghost RPC; ambiguous legacy rows require reconciliation |
| G2 (+deferral) | Ghost expand + `ghost_precontract_deferral`, legacy `match_id` constraint still present | Old instances fail closed | Yes: seat A of a two-account match completes; seat B's Ghost work is durably deferred, the match completes | Deferred seats wait in `ghost_deferred_completions` |
| G3 | Ghost contract | No: old `on_conflict=match_id` is invalid | Yes | Per-user Ghost receipts, including both human seats; deferred seats drain |

| Rush stage | DB state | Old server safe? | New server safe? | Allowed writes |
| --- | --- | --- | --- | --- |
| R0 | Existing schema | Yes | No | Existing Rush flow |
| R1 | Rush expand | Starts only; reports/results fail closed | Yes | New assigned runs/reports; old unassigned starts may be invalidated |
| R2 | Rush expand, new binary live | Old instances still fail closed | Yes | New assigned runs; new server cancels legacy open runs |
| R3 | Rush contract | Old run creation fails closed | Yes | Assigned open runs only |

After G0/R0, the legacy server in this procedure is the exact BRIDGE above,
not plain OLD. Plain OLD must be stopped before quiescence is established.

“Safe” in the old-server columns means no silent durable Ghost rating or Rush
score corruption. Old requests can fail during the handoff. A rollback at G1/R1
restores BRIDGE's other behavior but **does not restore Ghost/Rush
writing**; retain the fences until a deliberate reconciliation or forward fix.

## Rating completion quiescence gate

Two problems are not fixed by the expand migrations alone, and both are closed
by the gate.

**Ghost/Fritz completion straddle.** The OLD Fritz completion
(`completeGhostGame`, Fritz branch) (1) inserts the ranked result and applies
Glicko, (2) starts the Ghost training write with `void persistFritzGhostTrainingProfile(...)`
— not awaited — and (3) returns success. The room persistence path
(`persistGameOverOnce`) and `/api/ghost/complete` treat step 3 as done. If the
Ghost expand migration commits between steps 1 and 2, the ranked result is
durable, the deferred write is fenced, and nothing retries it: the player's
Ghost effect is lost while the match reads as saved.

**Weekly decay overlap.** The OLD weekly decay (`decayInactivePlayers`) reads
every inactive profile, then unconditionally PATCHes `glicko_rd` per user. A
ranked game committed through the new transactional path between the read and
the PATCH is overwritten with a stale RD. The ranked expand migration does not
fence that PATCH.

### What the gate is

| Aspect | Behavior |
| --- | --- |
| Durable intent | One row, `public.rating_cutover_gate` (`quiesced`, `first_quiesced_at`, `ghost_expand_applied_at`, `enabled_boot_id`). A process restart cannot reopen it. |
| In-flight accounting | In-memory counters in the single server process: `completionsInFlight`, `deferredGhostWritesInFlight`, `decayInFlight`. |
| Completion unit | One unit spans the entire vulnerable operation: from before the first durable write (room persistence: before `resolvePendingFritzMatch`/`appendMatch`; HTTP: the whole locked `/api/ghost/complete` body) through the last awaited step. The unfulfilled deferred Ghost training write is registered, while the owning unit is still held, and stays counted until it settles — there is no uncounted gap between the ranked commit and the Ghost write. |
| New work while closed | A BRIDGE completion is rejected **before any write** with a retryable `rating_cutover_quiesced` (HTTP 503 + `Retry-After` on `/api/ghost/complete`). Room game-over persistence waits (polls every 2 s, up to 120 s) and then fails visibly as "result couldn't be saved"; it never reports success without writing. A BRIDGE weekly decay does not start, and a running one stops before its next per-user write. |
| Fail closed | If the fence row cannot be read, BRIDGE completions are rejected and decay does not run. |
| Scope | Authenticated rated human-vs-human completion (including manual/disconnect forfeits), qualifying authenticated Play vs Fritz completion, scheduled ranked catch-up, admin ranking processing and authenticated Fritz disconnect rating handling are gated before their first durable write. Guest/unrated private completion is not gated. Tournament routing remains unchanged. The NEW build's atomic writers are not blocked. |
| Drain evidence | `GET /api/ops/rating-cutover/status` → `readyForExpand: true` only when the BRIDGE build is running, the gate is closed, **this process** enabled it, and all three in-flight measures are zero. Counters are raised **before** the fence is read, so a unit that read "open" is always visible once you close the gate; once closed and zero it cannot rise. |
| Restart | The fence row survives. After a restart the new process refuses legacy writes but reports `readyForExpand: false` ("enabled by a different process") until you re-run enable, because killed in-flight work is not drain evidence. |
| Database guard | The Ghost expand and ranked expand migrations abort unless the gate row is closed, and the Ghost expand stamps `ghost_expand_applied_at`. The database cannot see the in-flight counters; the operator must have observed `readyForExpand: true` immediately before. |
| Security | Both routes require `x-admin-secret` (`ADMIN_SECRET`, constant-time compare, header only, no query/body secret, fail closed if unset). Responses are `no-store` and contain only counters/booleans. There is no unauthenticated toggle or status. |

Supported operations (secret from your shell, never written to this file):

```sh
BASE=https://<your-server-host>
status()  { curl -fsS -H "x-admin-secret: $ADMIN_SECRET" "$BASE/api/ops/rating-cutover/status"; }
quiesce() { curl -fsS -X POST -H "x-admin-secret: $ADMIN_SECRET" -H 'content-type: application/json' \
              -d "{\"enabled\":$1,\"reason\":\"senior-audit cutover\"}" "$BASE/api/ops/rating-cutover/quiesce"; }
```

## Operator sequence (one operator, in order; stop at any failed check)

Do not schedule this across a Sunday 00:00 UTC weekly maintenance run. That is
a secondary precaution only; the gate, not the calendar, is the invariant.

### Step -1 — Install the gate, the room fences AND the identity migrations, then deploy BRIDGE′ (once, before the cutover window)

The production -> BRIDGE′ replacement is itself a Render process overlap (old and new instance reach the same database). The room
fences must therefore exist **before** BRIDGE′ boots, not after. Serving artifact while these migrations are applied: production
`3a65ab1c` (verified compatible: real production processes pass multiplayer and ranked restart chaos against this schema).

1. Apply, in this order, each with `psql -X -v ON_ERROR_STOP=1 "$DATABASE_URL" -f <file>` (all additive, no table rewrite,
   safe for OLD):
   1. `supabase/migrations/2026-10-13_rating_cutover_gate.sql` (a single table).
   2. `supabase/migrations/2026-10-16_room_live_session_monotonic_fence.sql` — within one match, a snapshot older than the stored
      `(game_state_sequence, last_event_sequence)` is refused; a terminal room never becomes active again; `matchLogged`,
      `completionPending`, `completionRecovery` are monotonic; a different match cannot replace a terminal row that owes completion.
   3. `supabase/migrations/2026-10-16_room_live_session_generation_fence.sql` — **depends on 2** (replaces its trigger function).
      Durable room-code generation history: a write for an older match is refused whatever state the newer match is in; a retired
      (deleted) match can be recreated only by the process that wrote it last (so a reconnect that revives a room the archive just
      deleted still works, and a zombie can never recreate it); `next_room_writer_epoch()` and the writer-epoch rule (a lower epoch
      is refused even at an equal sequence).
   4. `supabase/migrations/2026-10-16_account_identity_rls_hardening.sql` — **independent of the rating cutover and of the room fences**
      (apply after them so every pre-deploy migration is in one reviewed block). Idempotent, additive/revoking only, compatible with
      production `3a65ab1c`, BRIDGE′ and NEW (the client only ever updates `friends.status`; nothing writes `daily_puzzles` as a user).
      It replaces the table-level `UPDATE` grant on `public.friends` with `UPDATE (status)` (a request recipient could otherwise re-point
      the row at an arbitrary account and read that account's activity feed), revokes `anon` privileges on `friends`, and drops the
      `daily_puzzles` write policies keyed on the JWT email claim. Confirm:
      `select string_agg(column_name, ',') from information_schema.column_privileges where table_name='friends' and grantee='authenticated' and privilege_type='UPDATE';` returns exactly `status`,
      and `select count(*) from pg_policies where tablename='daily_puzzles' and cmd <> 'SELECT';` returns `0`.
   5. `supabase/migrations/2026-10-16_signup_fallback_username_full_uuid.sql` — replaces `handle_new_user()` (create or replace; idempotent) so the
      signup fallback username is `user_` plus the full 32-hex user id (two ids sharing the first 8 hex characters could previously make the
      second signup fail on `profiles_username_key`). Existing profiles are unchanged. Confirm:
      `select pg_get_functiondef('public.handle_new_user()'::regprocedure) like '%replace(new.id::text, ''-'', '''')%';` returns `t`.
   Confirm: `select tgname from pg_trigger where tgname like 'room_live_sessions_%' and not tgisinternal;` lists
   `room_live_sessions_monotonic_fence`, `room_live_sessions_generation_guard`, `room_live_sessions_retire_generation`, and
   `select public.next_room_writer_epoch()` (service role) returns a number.
> **ROLLBACK RULE (read before step 2, it applies from the first room BRIDGE′ writes).** After BRIDGE′ has written epoch-bearing room state,
> **rollback to `3a65ab1c` (production) or `3ccd6ff8` (historical BRIDGE) is forbidden. Rollback is BRIDGE′ `7f5003404e6e87f06b8d4028130fb213340a77be` or forward only.** They
> must never be targeted: they write room epoch 0, the room fences refuse them on every room BRIDGE′/NEW has written
> (those rooms go `degraded`; players cannot continue them), and a "one-click rollback to the previous deploy" lands on exactly that artifact.
> Tested with real processes (production and stock BRIDGE as the rolled-back writer: higher-sequence, equal-sequence, terminal-regression and
> retired-row writes are all refused, the stored row is untouched). See **Rollback boundaries** and **Emergency rollback**.

2. Configure a valid `ADMIN_SECRET` before deployment. Deploy the exact committed **BRIDGE′** artifact `7f5003404e6e87f06b8d4028130fb213340a77be`; do not
   construct or apply a patch. Deploy it as a normal release. **Overlap interval (production and BRIDGE′ both alive):** production
   writes epoch 0, BRIDGE′ writes its boot epoch (> 0) as soon as it persists a room. From BRIDGE′'s first write of a room onward
   the database refuses production's lower-sequence, equal-sequence, terminal-regression, cross-match and recreate writes for that
   room (production's room goes `degraded`; its players reconnect to BRIDGE′). Before BRIDGE′ writes a room, production is still its
   legitimate owner and its writes are accepted; a room BRIDGE′ hydrates from a stale row fails closed on its first stale write.
3. Confirm `status` returns `enforcement: "legacy_writers"`, `quiesced: false`,
   `newUnsafeOperationsCanStart: true`, the expected `release`, and that BRIDGE′ obtained an epoch (its logs must NOT contain
   `writer epoch could not be allocated at boot`; if they do, BRIDGE′ is frozen at legacy epoch 0: **restart it** before Step 0):
   `select count(*) filter (where room_shell ? 'writerEpoch') from public.room_live_sessions;` is > 0 once any room has been written
   after the deploy (zero rooms is also fine; check again after the first room).

### Step 0 — Precheck

Confirm and record each:

* exactly one Render server instance (dashboard, or `curl -s -H "Authorization: Bearer $RENDER_API_KEY" https://api.render.com/v1/services/$SERVICE_ID`, `numInstances == 1`);
* server health (`/health`) and DB health (`/ready`) are green;
* no deployment or migration currently running;
* OLD SHA, BRIDGE′ SHA (`7f5003404e6e87f06b8d4028130fb213340a77be`), NEW SHA (`git rev-parse` of each) written down; rollback SHA = the BRIDGE′ SHA (never `3ccd6ff8` and never plain OLD once Step -1 is done: OLD writes epoch 0 and the room fences refuse it on any room BRIDGE′ or NEW has written);
* the migration files below have been read and the DB backup/recovery point exists;
* `status.decayInFlight == false` and the next scheduled decay (Sunday 00:00 UTC) is not within the window;
* record read-only counts: open unassigned Rush runs; legacy Ghost rows with `rating_applied_at is null`.

### Step 1 — Enable quiescence

```sh
quiesce true
```

Expect `quiesced: true`, `enforcement: "legacy_writers"`, `newUnsafeOperationsCanStart: false`.
Players finishing a rated game now see their result persist after the window or,
past 120 s, "result couldn't be saved" (nothing partial is written). Keep this
window short; record `rejectedSinceBoot` at the end of Step 2.

### Step 2 — Verify drain (positive evidence required)

```sh
status | jq '{release,bootId,quiesced,completionsInFlight,deferredGhostWritesInFlight,decayInFlight,newUnsafeOperationsCanStart,readyForExpand,notReadyReasons}'
```

Proceed only when `readyForExpand` is `true` on **two reads at least 30 seconds apart with the same `bootId`**. If `bootId` changed (process restart) or `notReadyReasons` mentions a different process, run `quiesce true` again and restart the check. If `status` errors, do not proceed. Never substitute a sleep.

### Step 3 — Apply expand migrations (gate stays closed)

Apply each with `psql -X -v ON_ERROR_STOP=1 "$DATABASE_URL" -f <file>` in this order, running `status` after each and confirming it still shows `quiesced: true`:

1. `supabase/migrations/2026-10-13_ghost_rating_idempotent_completion.sql` (aborts if the gate is open; stamps the cutover boundary)
2. `supabase/migrations/2026-10-13_ghost_cutover_reconciliation.sql` (additive checks; no rating writes)
3. `supabase/migrations/2026-10-13_puzzle_rush_assignment_and_atomic_completion.sql`
4. `supabase/migrations/2026-10-13_ranked_rating_claim.sql` (aborts if the gate is open)
5. `supabase/migrations/2026-10-15_ranked_rating_context.sql` — **depends on step 4**, including its receipt key/index and CAS RPC. Adds immutable owner/opponent inputs, serializes new ranked-game admission, and fences decay against pending snapshots. Apply before NEW; this is not a contract migration.
6. `supabase/migrations/2026-10-15_ghost_precontract_deferral.sql` — **depends on the Ghost expand (step 1)**. Additive: creates `ghost_deferred_completions` and replaces `complete_ghost_rating_v2` so that, while the legacy global `ghost_games_match_id_unique` still exists, the SECOND human account of one match is durably deferred (typed `deferred_legacy_match_uniqueness`) instead of failing the whole multiplayer completion. BRIDGE never calls this RPC and its fenced writers are unchanged. Apply before NEW.

7. `supabase/migrations/2026-10-16_ranked_applied_state_monotonic.sql` — **LAST expand step; gated by a read-only preflight.** Run `psql -X -v ON_ERROR_STOP=1 "$DATABASE_URL" -f scripts/sql/ranked-applied-state-preflight.sql` immediately before it, after the Step 2 drain: `GO` (zero half-set `ranked_games` rows) -> apply; `STOP` -> do not apply, reconcile each listed row deliberately (the report says whether the catch-up sweep selects it and whether it blocks its owner as a predecessor), re-run until `GO`. The migration itself refuses to run while half-set rows exist. It adds the `NOT VALID` coupling CHECK `ranked_games_applied_fields_coupled` and a trigger that makes applied results immutable (`ranked_applied_state_monotonic`).

**Placement of the room fences.** They are NOT part of this step: they were installed in Step -1, before BRIDGE′ booted, so there is no
interval in which an older room writer can win. Only the ranked applied-state migration (7) is applied here, as the last expand step,
immediately after the Step 2 drain, because its half-set preflight is only meaningful when no writer is in flight.

The BRIDGE process is still serving but fenced for vulnerable rating work; Rush
old report/result writes fail closed as before.

The context migration has no default or historical backfill. NULL retains the
historical full-strength policy; do not infer old disconnects. New context rows
must contain the complete corrected v1 owner/opponent shape. The intermediate
unshipped opponent-only v1 shape is unsupported. Old RPC callers process NULL
rows but are rejected for new context rows. NEW on a pre-context schema can
boot/liveness may pass, but ranked scans/inserts fail closed; liveness is not
proof of schema readiness. Do not deploy NEW before all seven expansion steps (and before the three Step -1 migrations).
The context migration is reapplicable; its historical CHECK validation runs
after committing the expansion DDL, under the weaker validation lock. Schedule
normal migration lock management and stop if any statement fails.

### Step 4 — Deploy NEW

Deploy the current canonical candidate SHA recorded in preflight. Verify, in the target nonproduction environment
first, then in production:

* `/health`, `/ready`, and `release` equals the NEW SHA;
* `status`: `enforcement: "atomic_writers"`, `quiesced: true` (expected), `readyForExpand: false` (expected for this build), counters at zero;
* Ghost completion and an identical retry (retry returns the stored receipt, one rating change);
* Fritz ranked completion; ranked game processing;
* Puzzle Rush assigned run, report, and completion.

### Step 5 — Resume

Only when Step 4 passed **and** Render shows the BRIDGE instance has stopped:

```sh
quiesce false
```

Disabling the gate while an old instance is alive does not make it safe — the
database fences still fail its writes — so never disable it early.

### Step 6 — Observe

Use the existing stability gate: a completion-and-retry smoke succeeds; about
15 minutes pass with no new `ghost_legacy_writer_fenced`, `ghost_legacy_completion_ambiguous`,
`rush_legacy_writer_fenced`, `ranked_state_conflict` storms, or `game_over_persist_exhausted`;
Render shows only the NEW instance. Do not extend the soak without evidence;
the invariant is that the old writer is gone.

### Step 7 — Reconcile (blocks the contract)

```sql
select * from public.ghost_cutover_suspicious_partials();
```

It must return zero rows. It reports exact `(user_id, match_id)` pairs for:

* `ranked_without_ghost_row` — a verified Fritz ranked result from the cutover window with no Ghost row for that user and match (the straddle signature);
* `ranked_after_expand_without_receipt` — a verified Fritz ranked result after expand with no Ghost receipt (should be unreachable: the expand trigger forbids it);
* `ghost_row_after_expand_without_receipt` — a Ghost row written after expand without a receipt.

Complete legacy pairs (ranked row **and** Ghost row, merely lacking a receipt)
and games before the window are not partials. Nothing is guessed or applied
automatically: the lost deferred write's move log is not retained anywhere, and
applying the outcome now would use today's Ghost rating, not the rating at match
time. For each row the operator decides:

* apply the outcome deliberately through `public.complete_ghost_rating_v2(...)` with the scores from the ranked row, then record it; or
* decide no Ghost effect is needed.

```sql
select public.ghost_cutover_resolve('<user_id>','<match_id>',
  'rating_applied_manually' /* or 'confirmed_no_effect_needed' */,
  '<what you decided and why, at least 10 characters>','<your name>');
```

`rating_applied_manually` is refused unless the receipt exists. Do not bulk
resolve. Ghost contract aborts while any row remains.

### Step 8 — Contract (only after Steps 5–7 are clean)

1. `supabase/migrations/2026-10-13_puzzle_rush_assignment_contract.sql`
2. `supabase/migrations/2026-10-13_ghost_user_match_uniqueness.sql` — begins with `select public.ghost_cutover_assert_reconciled()` and aborts with `ghost_cutover_unreconciled` if Step 7 is not clean.
3. **Drain deferred Ghost seats (mandatory after the Ghost contract).** Human-vs-human matches completed between Step 4 and the Ghost contract left the second account's Ghost work in `ghost_deferred_completions`. NEW's drain (`GHOST_DEFERRED_DRAIN_ENABLED` is on unless exactly `false`) replays them every 15 minutes through the same idempotent RPC; restart NEW to run it immediately (boot sweep at +30 s). While the legacy constraint exists the drain costs 2 requests per interval and changes nothing. Require the pending set to reach zero:

   ```sql
   select count(*) filter (where quarantined_at is null) as pending,
          count(*) filter (where quarantined_at is not null) as quarantined
     from public.ghost_deferred_completions;   -- pending must reach 0; quarantined must be 0 or explained
   select match_id, count(*) as ghost_rows, count(distinct user_id) as users
     from public.ghost_games where match_id is not null
    group by match_id having count(*) <> count(distinct user_id);   -- must return no rows
   ```

   `quarantined` rows (deterministic RPC rejection after 10 attempts) are retained for an operator and are never deleted by automation.

Repeat the completion/retry smoke and watch for operational errors.

## Final production order (summary)

**Rollback rule: after BRIDGE′ has written epoch-bearing room state, rollback to `3a65ab1c` or `3ccd6ff8` is forbidden. Rollback is BRIDGE′ (`7f5003404e6e87f06b8d4028130fb213340a77be`) or forward only.**

1. Step -1, while current production is serving: rating gate migration, **room monotonic fence, room generation fence**, then the **identity
   migrations** (RLS hardening, signup fallback).
2. Step -1 (cont.): deploy BRIDGE′ `7f5003404e6e87f06b8d4028130fb213340a77be`.
3. Step 0: precheck and record SHAs.
4. Step 1: `quiesce true`.
5. Step 2: two `readyForExpand: true` reads, 30 s apart, same `bootId`.
6. Step 3 (1-6): Ghost expand, reconciliation, Rush expand, ranked claim, **ranked context**, Ghost deferral.
7. Step 3 (7a): ranked half-set preflight must print `GO`.
8. Step 3 (7b): ranked applied-state migration.
9. Step 4: deploy NEW.
10. Step 4: smoke (BRIDGE′ -> NEW overlap: both writers have lifetime-fixed, boot-ordered identities, so BRIDGE′ cannot win a tie against NEW).
11. Step 5: confirm BRIDGE′ is stopped.
12. Step 5: `quiesce false` (resume).
13. Steps 6-7: observe; reconciliation query returns zero rows.
14. Step 8: Rush contract, then Ghost contract.
15. Step 8.3: drain deferred Ghost work to zero after the Ghost contract.

## Room-writer overlap timeline (no unfenced interval)

| Interval | Writers alive | Migrations in force | Epoch | Older writer can overwrite newer room state? |
|---|---|---|---|---|
| before Step -1.2 | production | gate, room monotonic + generation | production = 0 | n/a (one process) |
| **production -> BRIDGE′ overlap** | production (0) + BRIDGE′ (epoch fixed at boot) | gate, room monotonic + generation | BRIDGE′ > 0 (0 only if its boot allocation failed: logged once, restart it) | **No**: lower, equal, terminal, cross-match, recreate all refused once BRIDGE′ has written the room |
| BRIDGE′ steady state (Steps 0-3) | BRIDGE′ | + Ghost/Rush/ranked expands, ranked applied-state (7) | BRIDGE′ > 0 | n/a (one process); its own redeploy overlap is fenced (BRIDGE′ -> BRIDGE′ tested) |
| **BRIDGE′ -> NEW overlap (Step 4)** | BRIDGE′ + NEW | all expands | NEW epoch > BRIDGE′ epoch (boot order) | **No** |
| NEW steady state (Steps 5+) | NEW | all expands, later contracts | NEW > 0 | n/a; NEW -> NEW overlaps fenced |

Writer epochs are authoritative from the moment BRIDGE′ writes a room: a snapshot with a lower epoch is refused even at an equal or higher
sequence. Quiescence (Step 1) is independent of the room fences. BRIDGE stops at Step 5; NEW starts at Step 4. Residual (documented, cannot
be closed without changing production itself): two **legacy epoch-0** writers (production next to production) cannot be ordered on ties; that
pair no longer exists once Step -1 completes.

## Restart reasoning

* **Server restarts while quiescence is intended.** The intent is the database row; a restarted BRIDGE reads it on every operation and stays closed. It reports `readyForExpand: false` until `quiesce true` is re-run, so a restart between Steps 2 and 3 forces a fresh drain check. A restarted NEW build is unaffected by the row.
* **Process death mid-completion.** The counters die with the process, so a killed in-flight unit is not drain evidence. Any ranked result it committed without its Ghost write is exactly what Step 7 detects.
* **Row missing / database unreachable.** Fail closed: BRIDGE rejects completions and does not decay. Do not proceed with a failing `status`.

## Rollback boundaries

> **ROLLBACK RULE.** Once BRIDGE′ or NEW has written epoch-bearing room state, rollback may target **BRIDGE′
> `7f5003404e6e87f06b8d4028130fb213340a77be` or forward only**. **Never** roll back to plain production `3a65ab1c` or to stock BRIDGE `3ccd6ff8`.

**Room fences.** Do not roll the server back to plain OLD/production (or stock BRIDGE) after Step -1: they write epoch 0 and the room fences refuse
them on every room BRIDGE′ or NEW has written (persistence goes `degraded`, deterministic, one request, no retry storm; the stored room is not
modified). Rooms neither BRIDGE′ nor NEW ever wrote remain writable, and a brand-new match id is a legitimate new generation by design: the rule
protects rooms already owned, it is not a barrier to new matches. Roll back to BRIDGE′ or forward.

### Emergency rollback

The Render "Rollback" button (and "redeploy previous deploy") restores the *previous* deploy, which after Step -1 may be production or stock
BRIDGE. **Do not use it.** Instead redeploy the BRIDGE′ SHA explicitly (`7f5003404e6e87f06b8d4028130fb213340a77be`) or ship a forward fix. If a
rolled-back epoch-0 server is already serving, rooms owned by BRIDGE′/NEW report `degraded` and their players cannot continue them: redeploy
BRIDGE′ at once (rooms recover from the stored rows; nothing was overwritten).

**Before the Ghost contract (through Step 7).** Server code may be rolled back
while the expand schema remains, but rolling back does not return to unrestricted
OLD rating behavior: the Ghost, Rush and ranked fences stay in the database and
fail the OLD writers closed. Roll back to the exact **BRIDGE′** artifact
`7f5003404e6e87f06b8d4028130fb213340a77be` (never to plain OLD, and never to stock BRIDGE `3ccd6ff8`), leave `quiesce true`, and keep rating-affecting completions failing
retryably until a corrected NEW build is deployed. Do not turn the fences off to
make old requests appear successful.

**After the Ghost contract (Step 8.2).** An ordinary Git rollback to OLD or
BRIDGE is **unsafe**: their `on_conflict=match_id` has no unique arbiter once
global `match_id` uniqueness is dropped. Recovery is a compatible forward fix or
a deliberate schema/data restore. This is an irreversible operational boundary;
do not cross it until Steps 5–7 are clean. After the Rush contract the old
writer likewise cannot create an open unassigned run.

If a DB commit succeeds but the HTTP response is lost, the new Ghost RPC returns
the stored receipt on retry, and Rush completion returns its stored published
result. A Node process death after commit behaves the same.
