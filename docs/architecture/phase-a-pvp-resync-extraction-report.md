# Phase A — PvP Resync Ownership Extraction Report

**Date:** 2026-07-04  
**Roadmap:** [player-vs-player-extraction-plan.md](./player-vs-player-extraction-plan.md) — Phase A  
**Prerequisite:** Phase 0 ([phase-0-pvp-test-harness-report.md](./phase-0-pvp-test-harness-report.md))

---

## Summary

Phase A is complete. All resync ownership was structurally extracted from `App.tsx` into `useMultiplayerResync.ts` with **no runtime behavior changes**.

---

## Files Created

| File | LOC | Role |
|------|-----|------|
| `client/src/multiplayer/useMultiplayerResync.ts` | 158 | Authoritative owner of resync refs, `fetchGameState`, quick-match stall watchdog |

---

## Files Modified

| File | Change |
|------|--------|
| `client/src/App.tsx` | Removed inline resync logic; consumes `useMultiplayerResync`; removed unused `emitRoomJoin` and `StateUpdatePayload` imports |

**Production files modified:** 1 (`App.tsx`)  
**No changes** to `recoveryMachine.ts`, `socketGuards.ts`, `useRoomSocketSync.ts`, or any other multiplayer runtime modules.

---

## LOC Moved

| Extracted from App.tsx | ~75 LOC |
|------------------------|---------|
| `fetchGameState` callback | ~54 |
| Quick-match stall `useEffect` | ~11 |
| Resync ref declarations (`resyncInFlightRef`, `resyncCooldownUntilRef`, `resyncBufferedUpdateRef`, `resyncFlushRef`, `fetchGameStateRef`) | ~6 |
| `fetchGameStateRef.current` assignment | ~1 |
| E6 entanglement comment block | ~4 |

`resyncCooldownUntilRef` is now **internal** to the hook (was never passed outside App).

---

## App.tsx LOC Reduction

| Metric | Value |
|--------|-------|
| Before | 1,589 |
| After | 1,536 |
| **Net reduction** | **−53** |

App gains ~25 LOC from the `useMultiplayerResync({...})` call site; gross extraction is ~75 LOC.

---

## Behavior Unchanged — Confirmation

| Concern | Status |
|---------|--------|
| Indirect path (`reason !== 'recovery_machine'`) dispatches `RESYNC_NEEDED`, returns `true` | Preserved |
| Direct path (`recovery_machine`) uses `emitRoomJoin` + identity fallbacks | Preserved |
| `resyncInFlightRef` / cooldown / flush semantics | Preserved |
| `resetClientGameSession` still clears `resyncBufferedUpdateRef` | Preserved (ref from hook) |
| Quick-match 4s stall watchdog | Preserved (moved into hook) |
| Logger messages still attribute `App.tsx` | Preserved (intentional — no observability drift) |
| Public interfaces (`fetchGameState` signature, shell props, connection host params) | Unchanged |

**Implementation note:** `fetchGameState` now calls `applyJoinedRoomResponseRef.current(resp)` instead of closing over `applyJoinedRoomResponse` directly. This is behavior-identical because the ref is assigned synchronously in the same render before any async resync or the 4s stall timer fires.

---

## Test Results

```
npm run test:all --prefix client
```

- Vitest: **391/391 passed**
- Behavior tests: **22/22 passed**
- Build: **passes**

Phase 0 contract tests (`multiplayerResyncContract.behaviorTests.ts`) remain valid — they document machine-level behavior independent of hook location.

---

## Risks for Phase B

These are **not regressions from Phase A** — they are pre-existing issues Phase B must address:

1. **RESYNC_NEEDED drop while `joining`/`connecting`** — indirect `fetchGameState` still returns `true` when the machine ignores the event. Documented in Phase 0 tests.

2. **No resync queue** — multiple `RESYNC_NEEDED` during reconnect are lost. `multiplayerResyncContract.behaviorTests.ts` locks this baseline.

3. **`applyJoinedRoomResponseRef` ordering** — hook is instantiated before `applyJoinedRoomResponse` is defined; safe today because resync is always async, but Phase B queue work should not introduce synchronous resync during the same render pass.

4. **Hook parameter surface** — `useMultiplayerResync` still receives auth identity as scalar props; E6 full resolution (stable identity injection) remains future work.

5. **No unit tests for the hook itself yet** — Phase 0 contract tests cover behavior; Phase B should add `useMultiplayerResync` tests when queue logic lands.

---

## What's Next

### Phase B — Resync Queue Correctness Fix (recommended next)

- Implement queue for `RESYNC_NEEDED` when machine `state !== 'idle'`
- Update `multiplayerResyncContract.behaviorTests.ts` and `recoveryMachine.behaviorTests.ts` to expect queued flush
- **Runtime behavior change:** intentional correctness fix

### Phase D — Join Ack Coordinator (can proceed in parallel after B)

- Extract `applyJoinedRoomResponse` from App (E5)
- `useMultiplayerResync` already depends on `applyJoinedRoomResponseRef` — coordinator extraction aligns naturally

### Deferred

- Phase C (shell bridge queue) — only if pre-mount drops reproduced
- Phase G (multiplayer app host) — after D/E/F

---

## Related Documents

- [player-vs-player-extraction-plan.md](./player-vs-player-extraction-plan.md)
- [phase-0-pvp-test-harness-report.md](./phase-0-pvp-test-harness-report.md)