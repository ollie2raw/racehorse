# Ghost and Puzzle Rush rating/run cutover

These migrations are **not deployed by the application**. Apply them to the
intended environment deliberately, with migration success and server version
verified at each step. Do not use the disposable PostgreSQL test fixture on
production. Keep the Ghost and Rush expand migrations together before the
new binary; keep both contract migrations until the old binary is gone.

Three server builds appear below. Keep them straight:

* **OLD** — the server currently in production (the base of this remediation,
  `main` at the commit you record in preflight).
* **BRIDGE** — the exact runtime-validated committed artifact
  `e3517fb0da9644ccede64697309d7af8d9ffb8ee` on
  `release/rating-cutover-bridge` (OLD plus the quiescence gate). It is the
  only build that can *stop* the OLD rating writers and *prove* they are idle.
  The OLD binary cannot be told to stop; that is why a bridge deploy comes first.
* **NEW** — this branch's server. It writes ratings through atomic database
  functions, so it counts the gate's state but is never blocked by it.

The original BRIDGE `d8198d98` was superseded after live validation exposed guest
identity and forfeit gate gaps. Deploy the exact corrected artifact above.

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
| G3 | Ghost contract | No: old `on_conflict=match_id` is invalid | Yes | Per-user Ghost receipts, including both human seats |

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
| Scope | Authenticated rated human-vs-human completion (including manual/disconnect forfeits) and qualifying authenticated Play vs Fritz completion are gated before their first durable write. Guest/unrated private completion is not gated. Tournament routing remains unchanged. The NEW build's atomic writers are not blocked. |
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

### Step -1 — Install the gate (once, before the cutover window)

1. Apply `supabase/migrations/2026-10-13_rating_cutover_gate.sql` (additive;
   safe for OLD; a single table).
2. Configure a valid `ADMIN_SECRET` before deployment. Deploy the exact committed
   BRIDGE artifact `e3517fb0da9644ccede64697309d7af8d9ffb8ee`; do not construct or
   apply a patch. Its gate migration is self-contained in that commit. Deploy it
   as a normal release. This deploy is the same
   exposure as any ordinary deploy because no expand migration exists yet.
3. Confirm `status` returns `enforcement: "legacy_writers"`, `quiesced: false`,
   `newUnsafeOperationsCanStart: true`, and the expected `release`.

### Step 0 — Precheck

Confirm and record each:

* exactly one Render server instance (dashboard, or `curl -s -H "Authorization: Bearer $RENDER_API_KEY" https://api.render.com/v1/services/$SERVICE_ID`, `numInstances == 1`);
* server health (`/health`) and DB health (`/ready`) are green;
* no deployment or migration currently running;
* OLD SHA, BRIDGE SHA, NEW SHA (`git rev-parse` of each) written down; rollback SHA = `e3517fb0da9644ccede64697309d7af8d9ffb8ee`;
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

The BRIDGE process is still serving but fenced for vulnerable rating work; Rush
old report/result writes fail closed as before.

### Step 4 — Deploy NEW

Deploy this branch's server. Verify, in the target nonproduction environment
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

Repeat the completion/retry smoke and watch for operational errors.

## Final production order (summary)

1. Step -1: gate migration; deploy BRIDGE.
2. Step 0: precheck and record SHAs.
3. Step 1: `quiesce true`.
4. Step 2: two `readyForExpand: true` reads, 30 s apart, same `bootId`.
5. Step 3: Ghost expand, reconciliation, Rush expand, ranked claim.
6. Step 4: deploy NEW and run the smoke.
7. Step 5: confirm BRIDGE is gone, then `quiesce false`.
8. Step 6: observe.
9. Step 7: reconciliation query returns zero rows.
10. Step 8: Rush contract, then Ghost contract.

## Restart reasoning

* **Server restarts while quiescence is intended.** The intent is the database row; a restarted BRIDGE reads it on every operation and stays closed. It reports `readyForExpand: false` until `quiesce true` is re-run, so a restart between Steps 2 and 3 forces a fresh drain check. A restarted NEW build is unaffected by the row.
* **Process death mid-completion.** The counters die with the process, so a killed in-flight unit is not drain evidence. Any ranked result it committed without its Ghost write is exactly what Step 7 detects.
* **Row missing / database unreachable.** Fail closed: BRIDGE rejects completions and does not decay. Do not proceed with a failing `status`.

## Rollback boundaries

**Before the Ghost contract (through Step 7).** Server code may be rolled back
while the expand schema remains, but rolling back does not return to unrestricted
OLD rating behavior: the Ghost, Rush and ranked fences stay in the database and
fail the OLD writers closed. Roll back to the exact **BRIDGE** artifact
`e3517fb0da9644ccede64697309d7af8d9ffb8ee` (never to plain OLD), leave `quiesce true`, and keep rating-affecting completions failing
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
