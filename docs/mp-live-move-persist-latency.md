# Multiplayer live-move persist latency — MP-JIT-1..3

**Status:** MP-JIT-1 shipped (this doc's fix). MP-JIT-2 / MP-JIT-3 are recorded
follow-up candidates, **not scheduled**.

**Not part of `HARDENING_PLAN.md`'s numbered systems.** This is a UX/perf
investigation that produced one contained fix plus one explicitly-accepted
risk. It lives here so the accepted risk is not rediscovered as a surprise six
months from now.

---

## Background — why multiplayer tile play/draw felt "jittery" vs Daily Fritz

Traced 2026-09-07. The structural difference, not network latency:

| | Daily Fritz / bot / local | Multiplayer (before MP-JIT-1) |
|---|---|---|
| Move application | `applyPlayMove()` runs the engine **client-side, synchronously**; `setMatch()` commits on the same tick (`modules/player-turn/usePlayerPlacementHandler.ts`). Zero network in the critical path. | `usePlayAction` / `useDrawAction` never touch local state. They `await emitGameAction(...)` and the board only changes when the `state:update` broadcast arrives. |
| Socket round-trips before your own move shows | 0 | 1 |
| Blocking DB write before the broadcast | 0 | **1 — a `room_live_sessions` upsert, awaited, on every move**, gated by `isLiveRoomDurablyRecoverable()` before `broadcastStateUpdate()` (`registerGameplayActionHandlers.ts`). |
| Opponent-move pacing | choreographed (`BOT_THINK_DELAY_MS` 1000ms, `BOT_FORCED_DRAW_THINK_DELAY_MS` 1650ms, `BOT_DRAW_STEP_MS` per-tile) | none — the opponent's tile appears whenever their `state:update` frame lands |
| Optimistic UI / client prediction / interpolation | n/a (it *is* local) | **none** (`grep -r optimistic|predict|interpolat` over `multiplayer/`, `match/`, `modules/match/` → nothing for gameplay) |

**Measured** (`server/scripts/rankedMultiplayerRowProbe.ts` with per-move
`emit→ack` timing):

| Path | median | mean | tail (max) |
|---|---|---|---|
| **Before**, local server → prod Supabase | ~140–240ms | ~145–245ms | 300–700ms |
| **After MP-JIT-1**, local server → prod Supabase | **~1ms** | **~17–27ms** | ~200–430ms |
| **After MP-JIT-1**, deployed Render instance (real network hop) | **~48ms** | **~113ms** | ~1100–1540ms |

Not a constant lag before — the `room_live_sessions` upsert's *latency variance*
per move is the jitter. After: mid-hand moves are just the socket round-trip
(~37–60ms to Render); the tail is the terminal moves (hand-over / game-over),
which keep the synchronous persist by design — ~4 of ~40 moves in a
`winningScore:30` game.

---

## MP-JIT-1 — the `room_live_sessions` persist blocks every live move's broadcast

**Severity:** availability / UX (turn-by-turn perceived lag and jitter). Not
integrity — the broadcast was always authoritative from in-memory state; the
persist only ever protected crash-consistency.

**What was load-bearing about the pre-fix synchronous gate.** Traced every
consumer of `flushScheduledLiveRoomPersistence` + `isLiveRoomDurablyRecoverable`
+ `rollbackRoomGameplayCommit`:

- `registerGameplayActionHandlers.ts` `game:action` (MOVE/DRAW/PASS) — **the one
  changed here**.
- `rooms.ts` `commitLifecycleAfterMutate` (new-hand / lifecycle) — **untouched**.
- `disconnectGrace.ts` (forfeit / auto-play resolution) — **untouched**.

Between two connected clients the gate protects **nothing** — sequence
watermarks, `actionReceipts` idempotency, and the ack all work off in-memory
state. The gate protected exactly one thing: **a process restart during the
window between a move being broadcast and that move reaching `room_live_sessions`.**
On restart the room rehydrates from the last persisted snapshot
(`applyLiveSessionRow`; `validateLiveRoomHydrationRow` only checks the snapshot
is internally fence-consistent, never against what clients saw). One move behind
→ reconnecting clients hold a higher sequence watermark → `evaluateSequenceWatermark`
regression → clients accept the rollback.

### The fix (shipped)

`game:action` MOVE/DRAW/PASS, **mid-hand moves only**:

1. Run `act()`, then `broadcastStateUpdate()` **immediately** from authoritative
   in-memory state (+ forced-draw animation).
2. Ack the actor right after the broadcast — do not await the persist.
3. `flushScheduledLiveRoomPersistence()` runs **off the critical path**. If it
   resolves not-durably-recoverable (or throws), `recordOperationalFailure(
   'live_room_move_persist_uncommitted' | 'live_room_move_persist_failed', …)`
   fires — the move already broadcast, so it is **not** rolled back.

**Carve-outs that keep the strong mutate → persist → (rollback-on-failure) →
broadcast contract:**

- **Terminal / hand-boundary moves** (`state.gameOver` or `state.handOver` after
  the move). Low-frequency, latency-insensitive (a mandatory ~2.5s hand-over
  pause / the game being over), and the highest-stakes to lose to a restart.
- **The graceful-shutdown window** (`isLiveRoomPersistenceShuttingDown()`). A
  SIGTERM deploy — the common, controlled restart — still flushes the last move
  synchronously. This is the single thing that keeps the accepted risk below
  from being a *common* risk (see "SIGTERM grace period" below).

**`room_command_receipts` ordering.** The dedicated receipt table is a
*supplement* to the shell-embedded receipts, which travel atomically with the
move inside the `room_live_sessions` snapshot. To stop the supplement from ever
*leading* the snapshot (which would let a hydrated receipt block a client's
retry of a move the snapshot never persisted → the lost move never re-applies),
`withGameActionIdempotency` now takes `deferReceiptPersistUntilDurable` — the
`game:action` handler passes a gate that resolves only once the snapshot is
durable. If the snapshot write is lost, no receipt row exists, and the retry
correctly re-executes.

### Accepted residual risk — NOT fixed, documented deliberately

**An uncontrolled restart (OOM kill on the 512MB free tier / crash / host
failure — anything that is not a SIGTERM) between a mid-hand move's broadcast and
its async snapshot persist rehydrates the room one move behind.** Window per
move: ~1ms–430ms observed (debounce + one upsert); during a Supabase outage it
grows to the outage duration.

**What actually happens** (pinned by
`gameActionPersistRollback.integration.test.ts` → "restart before the async
persist lands"):

1. **Sequence regression.** Server rehydrates at sequence *N*; clients hold
   *N+1*. On resync the clients accept the rollback to *N*. Visible: the last
   tile / score change pops back.
2. **Ghost-log gap at the rehydration instant.** `room.ghostMoveLogs` reflects
   only persisted moves — the lost move's entry is absent.
3. **What does NOT happen:** the rehydrated server log is a *consistent prefix*,
   so `verifyPlayerMoveLog(log, {strictHandContinuity:true})` still passes. The
   missing move is **re-applied when the acting client resyncs and replays** — it
   does not silently fail move-log verification or drop the match's Glicko
   rating. (The `room_live_sessions` upsert is a full snapshot, so any later
   successful persist catches the room fully up; the room self-heals.)

**Real damage, bounded:**
- A transient visible desync (tile/score flicker) on the rare restart-mid-move.
- **Only if the acting player also never reconnects** (permanent disconnect in
  the exact sub-second window): that one move is discarded — disconnect-grace
  auto-pass/forfeit proceeds from state *N*. A one-move fairness ding, not a
  corruption.

**What would need to change if this starts mattering** (e.g. a report of
"my match rolled back a move" or free-tier OOM restarts become frequent):
- Move the durable move record off the snapshot upsert entirely — an
  **at-least-once move-log append** (`room_move_log` rows, one per move,
  independent of the room snapshot), replayed on hydration to reconstruct any
  moves the snapshot missed. This is the "reconcile machinery" deliberately not
  built now.
- Or: shrink the window — persist synchronously but *without* the recoverability
  gate blocking the broadcast (broadcast fires, ack waits for persist, failure
  triggers a targeted resync rather than a rollback).
- Or: raise the free tier so OOM restarts stop being a category.

### SIGTERM grace period — checked, adequate for the controlled case

Render sends `SIGTERM`, waits the **shutdown delay (default 30s)**, then
`SIGKILL` (confirmed against Render docs 2026-09-07; configurable via
`maxShutdownDelaySeconds` in `render.yaml` / the API, up to 300s — **this repo
has no `render.yaml`, so the 30s default applies**). `gracefulShutdown.ts` sets
`setLiveRoomPersistenceShuttingDown(true)` first, then does a bounded 10s
live-session flush (`DEFAULT_SHUTDOWN_SIGNAL_FLUSH_TIMEOUT_MS`). 10s ≪ 30s, and
MP-JIT-1's shutdown carve-out makes every in-flight move persist synchronously
during that window. **Deploys are safe.** OOM/crash give zero grace regardless
and are the accepted-risk path above.

*Recommendation (not a fix):* add a `render.yaml` pinning `maxShutdownDelaySeconds`
so the value is versioned rather than an unversioned dashboard assumption.

---

## MP-JIT-2 — no optimistic local apply for multiplayer moves (follow-up candidate)

Daily Fritz commits the move locally and instantly; multiplayer shows nothing
until the `state:update` broadcast. Even with MP-JIT-1, there is still one socket
round-trip (~48ms to Render) of dead time where the clicked tile sits in the
player's hand with only a pending spinner.

**Full plan: `docs/mp-jit-2-optimistic-local-apply-plan.md`.** Optimistic apply
in `usePlayAction` / `usePassAction` / `useDrawAction` using
`@racehorse/game-core`'s `applyMove` directly on the client's `GameState` (same
engine, same rules the server enforces), reconciled against the authoritative
`state:update` via the existing watermark / `fetchGameState` machinery.

**Not started — plan awaiting review, no implementation code yet.**

## MP-JIT-3 — opponent-move presentation + board re-render (follow-up candidate)

- No pacing on opponent moves — the tile appears whenever the frame lands.
  Candidate: a short presentation delay + stepped draw animation mirroring
  `BOT_*_DELAY_MS`.
- `applyStateUpdateProjection` fires ~7 `setState`s per broadcast; React 18
  batches them, but `MatchBoardCanvas` / `InGameBoardShell` / the board subtree
  are not `React.memo`'d and `nextState` is a fresh object every broadcast → the
  whole board re-renders on every `state:update`, including opponent
  `player:dragging`. Candidate: memoize the board subtree.

**Not started.**

---

## RK-10 — the ranked-MP write dropped silently on a poisoned ghost move log

**Surfaced 2026-09-07 during MP-JIT-1's post-deploy verification. Root-caused,
fixed, and verified live the same day.** Full write-up is now **`HARDENING_PLAN.md`
§8.3 RK-10** — this section is the short version.

### The symptom

- `ranked_games` with `source_type = 'live_room'`: **0 rows, ever** (service-role
  query, 2026-09-07). Most recent `game_type = 'multiplayer'` row is
  `2026-07-09`, all with `source_type: null`.
- Three deployed two-account probe matches all wrote a `matches` row, fired
  `private_game_over_persist_succeeded {attempt: 1}`, and wrote **no**
  `ranked_games` row. The participant `profiles` rows existed the whole time.
- Each of those three also fired `private_move_log_verification_failed`:
  *"Move claims a draw/pass but a legal play existed for the reported hand and
  board."*

### Root cause

`server/src/rooms.ts`'s PASS handler appended the ghost move log entry and
incremented `room.ghostTurnIndex` **before** calling `applyMove({type:'pass'})`
— which is the call that validates a pass (game-core throws *"Cannot pass when
you have a legal play available"*). So a client that submitted an illegal PASS
— stale legal moves after an opponent's move, a double-tap, any client/server
legal-move disagreement — had the action **rejected** (`game:action → {ok:false}`)
but left a poisoned `branch: 'pass'` entry in `room.ghostMoveLogs`.

At game-over, `evaluateHumanMoveLogVerification` (`gameOverPersistence.ts`)
replays each seat's ghost log with `verifyPlayerMoveLog(..., {strictHandContinuity:true})`.
The poisoned pass entry fails ("a legal play existed"), `humanGlickoEligible`
goes `false`, and the `ranked_games` insert is skipped — **while
`persistGameOverOnce` still returns success**. The MOVE handler already
validated first (engine → then log); only PASS had the wrong order.

The probe's own bot reproduced this on every deployed run because the real
network hop made it act on stale `state:update` frames far more often than the
fast local path — which is why local runs (identical code, same Supabase) wrote
the row and deployed runs never did.

### Fix

`51cf9aca` — the PASS handler calls `applyMove` first and only appends the ghost
move / advances `ghostTurnIndex` on success (matching the MOVE handler).
`3d7f9c48` — `recordOperationalFailure('ranked_insert_skipped_no_profile' /
'ranked_insert_returned_no_row', …)` so a future silent skip pages instead of
hiding. Tests: `ghostMoveLogCapture.test.ts` (rejected illegal PASS leaves the
log empty), `gameOverPersistence.test.ts` (skip fires telemetry, persist still
succeeds).

### Live verification

Deployed probe against release `51cf9aca` (`winningScore: 30`, real full match):
**2 `ranked_games` rows, `source_type: "live_room"`, via the `on_conflict`
path**, `rating_after` / `delta` applied (1500 → 1662.31 / 1337.69), `profiles`
`ranked_games_played` incremented, **no `private_move_log_verification_failed`**,
`private_game_over_persist_succeeded {attempt: 1}`, net-zero cleanup. First
`source_type='live_room'` row in production, ever.

### The 2-month gap

Not entirely one bug. `source_type` columns were only written unconditionally
from **2026-09-06** (RK-8's flag deletion) — before that, even a successful MP
ranked write landed with `source_type: null`, so "0 `live_room` rows before
2026-09-06" is RK-8, not RK-10. From 2026-09-06 onward, RK-10 would drop any MP
game that contained one illegal PASS. Real MP volume is near-zero pre-launch, so
how often real players hit RK-10 in that window is unknown — but the mechanism
is real, was reproduced every time, and is now fixed. Backfill of the historical
`ranked_games` gap is a separate decision (see §8.3 RK-8/RK-10 note).

---

## Test coverage

- `registerGameplayActionHandlers.test.ts` — mid-hand move broadcasts + no
  rollback + telemetry on non-durable persist; terminal move keeps the sync
  gate + rolls back; graceful-shutdown forces the sync gate; consecutive
  mid-hand moves during a persist outage keep advancing.
- `gameActionPersistRollback.integration.test.ts` (two real clients, real
  engine) — "mid-hand move: broadcasts before persist…" (MP-JIT-1 contract);
  "restart before the async persist lands: server rehydrates one move behind"
  (the accepted risk, pinned).
- `server/scripts/multiplayerProcessRestartChaos.ts` (`npm run
  chaos:multiplayer-restart`) — real server spawn → match → SIGKILL mid-hand →
  respawn → reconnect + re-join → assert `hydrated`, clients converge, match
  plays on; reports whether the rehydrated sequence regressed. (Was a dead
  package.json entry pointing at a non-existent file; written for this change.)
- Full server suite (1297) + client suite (1553) + `check:architecture` (20/20)
  green with the change.
