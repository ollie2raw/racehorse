# Phase B — PvP Resync Queue Correctness Report

**Date:** 2026-07-04  
**Roadmap:** [player-vs-player-extraction-plan.md](./player-vs-player-extraction-plan.md) — Phase B  
**Prerequisites:** Phase 0, Phase A

---

## Summary

Phase B implements the first intentional PvP runtime behavior change: **indirect `RESYNC_NEEDED` requests are no longer dropped while the recovery machine is non-idle**. They are coalesced into `pendingResyncRoomCode` and flushed as **exactly one** resync when the machine returns to `idle` via `ROOM_JOIN_OK` or `RESYNC_OK`.

Public interfaces (`fetchGameState`, hook return types, shell props) are unchanged. Direct-path cooldown and buffered-update behavior in `useMultiplayerResync` / `useRoomSocketSync` are unchanged.

---

## Files Created

| File | Purpose |
|------|---------|
| `client/src/multiplayer/multiplayerResyncQueue.behaviorTests.ts` | Phase B queue + cooldown contract tests (5 scenarios) |

---

## Files Modified

| File | Change |
|------|--------|
| `client/src/multiplayer/recoveryMachine.ts` | `pendingResyncRoomCode` on snapshot; queue on `RESYNC_NEEDED` when non-idle; `applyPendingResyncAfterIdle` flush on `ROOM_JOIN_OK` / `RESYNC_OK` |
| `client/src/multiplayer/recoveryMachine.behaviorTests.ts` | Updated Phase 0 drop-baseline tests → queue expectations |
| `client/src/multiplayer/multiplayerResyncContract.behaviorTests.ts` | Updated indirect `fetchGameState` contract for queue + flush |

**Not modified:** `useMultiplayerResync.ts`, `useRoomSocketSync.ts`, `socketGuards.ts`, `App.tsx` (indirect path still dispatches `RESYNC_NEEDED`; machine now queues).

---

## Behavioral Change (intentional)

| Before (Phase A) | After (Phase B) |
|------------------|-----------------|
| `RESYNC_NEEDED` while `joining`/`connecting`/`resyncing`/`failed` → **dropped** | → **queued** on `pendingResyncRoomCode` |
| Multiple indirect requests during join → lost | → **coalesce** to one room code |
| `ROOM_JOIN_OK` → `idle` with pending request lost | → **`idle` flush** → `resyncing` + one `resync` effect |
| `RESYNC_OK` → `idle` ignores pending | → flush pending if set during prior resync |

**Unchanged:**
- Indirect path still returns `true` immediately
- Direct `recovery_machine` path still gated by socket connect, `resyncInFlightRef`, `rejoinInFlightRef`, 1200ms cooldown
- `resyncBufferedUpdateRef` buffering during `resyncInFlight` in `useRoomSocketSync`
- Idle `RESYNC_NEEDED` still transitions immediately to `resyncing`

---

## LOC Delta (approximate)

| File | Δ LOC |
|------|-------|
| `recoveryMachine.ts` | +45 |
| `recoveryMachine.behaviorTests.ts` | ~±40 (rewrite expectations) |
| `multiplayerResyncContract.behaviorTests.ts` | ~±30 |
| `multiplayerResyncQueue.behaviorTests.ts` | +175 (new) |

---

## New Behavior Tests

| Test file | Scenarios |
|-----------|-----------|
| `multiplayerResyncQueue.behaviorTests.ts` | joining → queued → idle → one resync; reconnecting → queued → idle → one resync; 10 events → one pending; no duplicate after flush; cooldown suppresses direct path |
| `recoveryMachine.behaviorTests.ts` | Updated integration tests for queue/coalesce/flush |
| `multiplayerResyncContract.behaviorTests.ts` | Updated indirect contract (queue while joining, flush on join ok) |

**Behavior test files:** 22 → **23**  
**Vitest:** 391/391 passed  
**Build:** passes

---

## Risks / Follow-ups for Phase D+

1. **`needsResync` + pending** — `ROOM_JOIN_OK` with `needsResync: true` starts resync without flushing pending in the same transition; pending flushes on subsequent `RESYNC_OK`. Covered by coalesce test during `resyncing`; worth manual QA if both flags fire together.

2. **Policy disabled flush** — Pending is cleared when `canEnterJoinOrResync` fails (e.g. policy `disabled`). Correct for safety; document in ops skill if needed.

3. **`recoverState` in `useMultiplayerConnection`** — Still only dispatches `RESYNC_NEEDED` when already `idle`; indirect socket handlers now benefit from queue when not idle. No change required.

4. **Hook-level unit tests** — Cooldown tested via mirrored pure guard in behavior tests; optional future test with mocked socket.

---

## What's Next

**Phase D** — Join ack coordinator (`applyJoinedRoomResponse` extraction from App). Resync queue is now stable for join/reconnect paths.

**Phase H** — CI boundary rules (can run anytime).

**Phase C** — Shell bridge queue (only if pre-mount drops observed in production).

---

## Related Documents

- [phase-a-pvp-resync-extraction-report.md](./phase-a-pvp-resync-extraction-report.md)
- [phase-0-pvp-test-harness-report.md](./phase-0-pvp-test-harness-report.md)
- [player-vs-player-extraction-plan.md](./player-vs-player-extraction-plan.md)