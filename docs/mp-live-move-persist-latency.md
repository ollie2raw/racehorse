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
`emit→ack` timing, local server → real prod Supabase, ~70 moves):

- **Before:** median ~140–240ms per move, mean ~145–245ms, tail 300–700ms. Not a
  constant lag — the `room_live_sessions` upsert's *latency variance* swinging
  100→700ms per move is what reads as jitter.
- **After MP-JIT-1:** mid-hand moves median **~1ms**, mean **~17–27ms**. Tail
  spikes (~200–430ms) are the terminal moves (hand-over / game-over), which
  still persist synchronously by design.

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
until the `state:update` broadcast. Even with MP-JIT-1 (broadcast now ~1ms +
network instead of ~150ms + network), there is still one socket round-trip of
dead time where the clicked tile sits in the player's hand with only a pending
spinner.

**Candidate fix:** optimistic apply in `usePlayAction` / `useDrawAction` — run
the engine client-side, commit to local state immediately, reconcile against the
authoritative `state:update`. The rejected-move rollback hook
(`markUncertainAndResync`) already exists. This is the biggest remaining
smoothness win and the one that would make MP feel like Daily Fritz.

**Not started.** Needs its own design pass (rollback UX for a rejected move,
draw-sequence prediction without knowing the boneyard order, score animation
reconciliation).

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

## Test coverage

- `registerGameplayActionHandlers.test.ts` — mid-hand move broadcasts + no
  rollback + telemetry on non-durable persist; terminal move keeps the sync
  gate + rolls back; graceful-shutdown forces the sync gate; consecutive
  mid-hand moves during a persist outage keep advancing.
- `gameActionPersistRollback.integration.test.ts` (two real clients, real
  engine) — "mid-hand move: broadcasts before persist…" (MP-JIT-1 contract);
  "restart before the async persist lands: server rehydrates one move behind"
  (the accepted risk, pinned).
- Full server suite (1297) + client suite (1553) + `check:architecture` (20/20)
  green with the change.
