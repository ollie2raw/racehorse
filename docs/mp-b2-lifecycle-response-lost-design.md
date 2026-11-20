# B2 design: a lifecycle write that commits but whose response is lost (DESIGN ONLY, nothing implemented)

Source: audit 2026-11-17, finding B2 (`docs/audit-parts/B-multiplayer.md` on branch `audit/2026-11-17`; test `server/src/multiplayer/auditHandBoundaryStrand.test.ts` "AUDIT B2" on that branch). B1 (the client side of the same strand) is fixed behind a flag in the PR that carries this document. Status labels: **read from code** (anchor re-checked on main 2026-11-20), **confirmed (audit test)**, **guess**.

## The problem in one paragraph

A hand-boundary write (the second player's ready mark with the fast-path flag off, or the new-hand write with it on) reaches Supabase and commits. The HTTP response is lost (the 15 s `supabaseFetch` timeout). The server cannot tell "not written" from "written", so it raises `RoomLifecyclePersistUncertainError`, rolls memory back to the pre-mutation snapshot (`rollbackRoomLifecycleCommit`, `server/src/rooms.ts:265`) and, as the last line of the rollback, schedules a debounced persist of the **rolled-back** room (`notifyLiveRoomStateCommitted`, `rooms.ts:299`, read from code). The row in the database is now **ahead** of memory, so that snapshot carries a lower `(game_state_sequence, last_event_sequence)` than the stored row, and the monotonic fence refuses it with `room_live_session_stale_write`. `fencedLiveSessionWrite` maps a stale write to durability `failed`, and in `failed` the policy refuses `new_hand`, `gameplay_action` and `reconnect_existing_player` (`roomDurabilityPolicy.ts`, `failed: FAILED_RUNTIME_POLICY`). Nothing leaves `failed`; the room is dead until the process restarts. **confirmed (audit test)**, entries off, both flag settings.

## Failure interleavings (T = time, DB = stored row, MEM = room in memory)

Notation: `S0` = state before the boundary mutation, `S1` = after it, tuple order `S0 < S1`.

| # | Interleaving | DB after | MEM after | Today | Wanted |
|---|---|---|---|---|---|
| 1 | write(S1) never reaches Supabase (request lost) | S0 | S0 (rolled back) | rollback persists S0 at tuple S0: equal tuple, accepted. Healthy; the client retry (B1) starts the hand | same |
| 2 | write(S1) commits, response lost (**B2**) | **S1** | S0 (rolled back) | rollback persists S0: tuple S0 < S1, `stale_write`, room `failed`, stranded | room resumes; the hand starts on retry |
| 3 | write(S1) commits, response lost, and a **retry** of the same command arrives before the rollback persist runs (inside the 75 ms debounce) | S1 | S0 → S1 | the retry re-applies at tuple S1: accepted (rule R3 of the fence: same tuple is a replay). Healthy, by luck of ordering | same |
| 4 | as 2, then the server restarts | S1 | rehydrated from DB = S1 | the room loads at S1 (hand N+1 dealt, never broadcast). Nobody saw deal A; acceptable | same |
| 5 | as 2, but the fallback full-row write (entries mode, #518) is the attempt whose response is lost | S1 | S0 | B2 applies again (read from code, not tested) | same fix as 2 |
| 6 | the first player's in-flight mark write fails while the second player's `nextHand` joins it (flag on, #519) | S0 or mark-only row | S0 | strand (this is B1's repro; closed from the client side by the retry) | retry succeeds once the DB is reachable |

Only interleaving 2 (and 5) is B2 proper. 1, 3, 4 show that equal-tuple and rehydrate-from-row are already accepted behaviours, which the options below reuse.

## Invariant the fix must restore

When a lifecycle write ends uncertain, the database is **equal to or ahead of** memory, never behind. Therefore memory must never persist a snapshot older than what it asked the database to write, and "stale write right after an uncertain commit" must mean "the database is ahead", not "someone else owns the room".

## Options

**(a) Do not persist the rolled-back snapshot; mark the room "needs reconcile".** On `RoomLifecyclePersistUncertainError`, rollback restores memory but does not call `notifyLiveRoomStateCommitted`; it sets `room.reconcilePending = true`. The next command on the room (the client's B1 retry is exactly that) first calls the reconcile step, below, then proceeds.

**(b) Treat `stale_write` after an uncertain commit as "DB ahead" and reconcile instead of failing.** Keep rollback as is. In `fencedLiveSessionWrite`, if the room has `lastUncertainCommitAt` within the window (say 60 s) and the stale-write error arrives, call reconcile instead of setting `failed`. Smaller diff, but it relies on correlating two events by time, and a genuine stale writer (the fence's real purpose: a second process owns the room) inside that window would be misread as our own commit. **Rejected as primary** for that reason.

**(c) Keep the post-mutation state and retry the same snapshot (R3 equal-tuple).** Instead of rolling back, keep S1 in memory, mark it unconfirmed, and retry the identical write until it is acknowledged. This is what #518 effectively does for entries mode. It needs the S1 side effects (events, broadcast gating) held back until confirmed, which is the largest change of the three. **Rejected for now:** the lifecycle code deliberately rolls back so no player sees a state that might not exist.

**Recommendation: (a) with the reconcile step.**

## The reconcile step (re-read the stored row)

`reconcileRoomWithStore(roomCode)`, called under the room gameplay lock before any lifecycle command when `reconcilePending`:

1. `loadLiveRoomSession(roomCode)` (`roomLivePersistence.ts:1448`, read from code) returns the stored row with its tuple.
2. Compare the stored tuple `T_db` with memory's tuple `T_mem`:
   - `T_db == T_mem`: the write did not land (interleaving 1). Clear `reconcilePending`; persist nothing; proceed.
   - `T_db > T_mem` **and** the row is the boundary we attempted (same hand number as S1, same match id and generation): the write landed (interleaving 2). Adopt the stored row as memory (it is hand N+1, the deal nobody has seen), clear `reconcilePending`, then broadcast the state update as the success path would have. The player's retry then gets `ok` (or a replayed ack) instead of `new_hand_blocked`.
   - `T_db > T_mem` but it is **not** the attempted boundary (another writer, a later generation): do not adopt. Fall through to today's behaviour (`failed`); this is the fence doing its job.
   - `T_db < T_mem`: impossible after a rollback (memory only ever moves back to S0); if seen, treat as a bug: log, keep `failed`.
   - Load itself fails (Supabase down): leave `reconcilePending` set, answer the command `uncertain` (the client retries with backoff, B1). The room is not marked `failed` by an unreachable database.
3. Receipts: the stored row's receipts (`hydrateGameActionReceiptsForRoom`) are merged so a replay of the same `requestId` returns the original ack rather than executing twice.

## Why the nobody-saw-it case is safe (**read from code**)

Broadcast of a new hand happens only after `isLiveRoomDurablyRecoverable` (`registerGameplayActionHandlers.ts`, the post-`readyForNextHand` path), so while the response is lost no client has been told about deal A. Adopting the stored row therefore cannot contradict anything a player has seen.

## Tests to write when this is implemented

1. The audit's fake DB (fence emulation plus "commit then timeout") with entries off, flag off and on: the room must reach `healthy` and the hand must start on the retry. These already exist on the audit branch as the red tests and become green.
2. A genuine stale writer (another process wrote a later generation) inside the 60 s window must still end `failed` (guards option (b)'s failure mode).
3. Load fails twice then succeeds: the command answers `uncertain` twice, then succeeds, never `failed`.
4. Interleaving 3 (retry inside the debounce) still works.
5. Property: after any sequence of {write ok, write lost-before, write lost-after, load ok, load fail}, the room is never `failed` unless the fence reported a foreign writer.
6. Mutation checks: skip the reconcile call; adopt without the "same boundary" check; clear `reconcilePending` before load succeeds. Each must fail a test.

## Flag and rollback

`MP_LIFECYCLE_RECONCILE_ENABLED` (server env, default off, `flagTrue`). Off = today's behaviour exactly. Rollback: unset and restart (one line).

## Pre-mortem (3 ways this breaks in production)

1. **Adopting a row we should not.** The "same boundary" check is the safety. If it is too loose (compares hand number only) a stale row from a rematch could be adopted. Compare match id, generation and hand number.
2. **Reconcile under the gameplay lock adds up to one more 15 s Supabase call** to a command that already waits (B4 in the audit: the lock is held across the #518 double write). Mitigation: reconcile reads, does not write; use a shorter timeout (5 s) and fall back to `uncertain`.
3. **Masks a real outage as success.** If reads succeed but writes keep failing, reconcile would adopt rows as the room "heals" while the next write is still failing. Mitigation: after adopting, the success path persists as normal, and a failing persist is `degraded` again (not `failed`), which the retry loop (B1) and B3's proposed backoff handle.

## Not verified / open

- Not implemented, so nothing here is measured beyond the audit's fake-DB test (**confirmed**) and the code anchors above (**read from code**).
- Production frequency is unknown (**guess**): it needs Supabase timeouts on a hand-boundary write; the audit estimated it appears when the database is slow, and no production count exists.
- B3 (a room left `degraded` at hand over never heals with the flag off) shares the retry machinery and should be designed together with this; it is not covered here.
- Whether the hosting plan's CPU throttling (0.15 CPU on the free tier, per `/health`) makes the 15 s timeout fire often enough to matter is unmeasured.
