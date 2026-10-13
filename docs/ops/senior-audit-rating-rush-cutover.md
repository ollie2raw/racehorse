# Ghost and Puzzle Rush rating/run cutover

These migrations are **not deployed by the application**. Apply them to the
intended environment deliberately, with migration success and server version
verified at each step. Do not use the disposable PostgreSQL test fixture on
production. Keep the Ghost and Rush expand migrations together before the
new binary; keep both contract migrations until the old binary is gone.

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

“Safe” in the old-server columns means no silent durable Ghost rating or Rush
score corruption. Old requests can fail during the handoff. A rollback at G1/R1
restores the old binary's other behavior but **does not restore Ghost/Rush
writing**; retain the fences until a deliberate reconciliation or forward fix.

## Operator sequence

1. Verify the current binary and DB versions, that the service has one active
   game-server instance, and that a backup/recovery point exists. Record a
   read-only count of open unassigned Rush runs and legacy Ghost rows.
2. Apply Ghost expand
   `2026-10-13_ghost_rating_idempotent_completion.sql` and Rush expand
   `2026-10-13_puzzle_rush_assignment_and_atomic_completion.sql`. The
   migrations install DB write fences atomically. Apply the independent ranked
   claim migration with the new binary's required order as well. An old
   instance still serving traffic now gets explicit failures for legacy Ghost
   rating writes and Rush report/result writes. Do not turn the fences off to
   make old requests appear successful.
3. Deploy the new server. Confirm its health endpoint and version, then run a
   test Ghost completion/retry and an assigned Rush start/report/complete in
   the target nonproduction environment first; repeat a small production
   smoke only as separately authorized. Check for `ghost_legacy_writer_fenced`,
   `ghost_legacy_completion_ambiguous`, `rush_legacy_writer_fenced`, and
   game-over persistence failures. Resolve ambiguous pre-cutover Ghost rows
   from verified receipts, profile history, and logs individually; do not bulk
   mark them consumed or bulk re-rate them.
4. Keep both contract migrations unapplied for at least one full server health
   check and a successful Ghost/Rush completion and retry while the new binary
   serves traffic. Explicitly confirm that **no old server process/instance**
   remains, including a draining Render instance. Review errors and reconcile
   any failed handoff writes. A failed deployment can remain on the old binary
   with the expand schema: Ghost/Rush writes remain fenced, other traffic can
   continue, and a corrected new deployment can resume without guessing.
5. An operator decides to cross the contract boundary. Apply Rush contract
   `2026-10-13_puzzle_rush_assignment_contract.sql`; it closes any remaining
   unassigned open run and enforces assignments for new open runs. Apply Ghost
   contract `2026-10-13_ghost_user_match_uniqueness.sql`; it replaces global
   match uniqueness with `(user_id, match_id)` so both human seats can retain
   independent receipts. Verify the migrations, repeat completion/retry smoke,
   and check operational errors.

Before step 5, a server-code rollback is possible with the expand schema left
in place, but old Ghost/Rush write paths remain intentionally fenced. Restore
the new binary or perform a deliberate DB/data rollback only after resolving
in-flight receipts. After Ghost contract, a normal Git rollback to the old
binary is **unsafe** because its `on_conflict=match_id` no longer has a unique
arbiter. Use a compatible forward fix or a deliberate schema/data restore.
After Rush contract, the old writer cannot create an open unassigned run. Do
not route old processes back to either feature after the contract boundary.

If a DB commit succeeds but the HTTP response is lost, the new Ghost RPC
returns the stored receipt on retry, and Rush completion returns its stored
published result. A Node process death after commit has the same behavior.
The DB fences also remain active if an old process unexpectedly survives the
new deployment; that process cannot silently publish an unassigned Rush score
or directly change Ghost rating.
