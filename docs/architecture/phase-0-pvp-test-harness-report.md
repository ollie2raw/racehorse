# Phase 0 — PvP Client Test Harness Report

**Document type:** Implementation completion report  
**Date:** 2026-07-04  
**Roadmap:** [player-vs-player-extraction-plan.md](./player-vs-player-extraction-plan.md) — Phase 0  
**Prerequisite audit:** [player-vs-player-architecture-audit.md](./player-vs-player-architecture-audit.md)

---

## Summary

Phase 0 is complete. Automated client coverage for multiplayer guard and recovery logic was substantially increased **without modifying any production code or runtime behavior**.

This establishes the CI gate required before Phase A (resync ownership extraction) and documents the current `RESYNC_NEEDED` drop behavior that Phase B will fix.

---

## Objectives (from roadmap)

| Objective | Status |
|-----------|--------|
| Increase automated client coverage before production code moves | Done |
| Do not modify runtime behavior | Done — zero production changes |
| Do not change production logic | Done |
| No cleanup or opportunistic refactors | Done |

---

## Work Performed

### 1. `socketGuards.test.ts` (new — Vitest)

**File:** `client/src/multiplayer/socketGuards.test.ts`  
**Tests:** 20

Coverage areas:

- **Stale sequence rejection** — backward updates within `SEQUENCE_REGRESSION_THRESHOLD` (10)
- **Sequence regression detection** — gaps > 10 trigger `reject_regression`
- **Duplicate sequence handling** — `incoming === watermark` accepted
- **Valid forward progression** — normal and large catch-up jumps
- **Reconnect edge cases** — watermark reset to `-1`, null/undefined/NaN/Infinity incoming
- **Threshold boundary** — gap exactly 10 is stale; gap 11 is regression
- **`wrapSocketHandler`** — normal invocation, error swallowing, `recoverOnError` sync/async failure paths

**Coverage result:** `socketGuards.ts` — **100%** statements/branches/functions/lines

---

### 2. `boardSnapshotGuards.test.ts` (new — Vitest)

**File:** `client/src/multiplayer/boardSnapshotGuards.test.ts`  
**Tests:** 24

Coverage areas:

- **`projectRenderableBoard`** — valid minimal board, empty mainLine, null/non-object rejection, missing `mainLine`/`hubDoubles`, malformed tiles, hub branch coercion, empty branch dropping
- **`isRenderableNonNullBoard`** — valid vs malformed
- **`projectMultiplayerGameState`** — valid snapshot, null-board lobby, missing `playerIds`/`players`/`board`, undefined board, malformed mainLine, null mainLine entries, non-array `hubDoubles`
- **`isRenderableMultiplayerSnapshot`** — valid, null-board, invalid regression payloads

**Coverage result:** `boardSnapshotGuards.ts` — **~84%** lines (up from 0% in Vitest coverage scope)

---

### 3. `recoveryMachine.behaviorTests.ts` (extended)

**File:** `client/src/multiplayer/recoveryMachine.behaviorTests.ts`  
**New integration scenarios:** 6

Added integration-level coverage documenting **current** behavior before Phase B:

| Test | Documents |
|------|-----------|
| `testResyncNeededDuringReconnectJoiningIsDropped` | `RESYNC_NEEDED` while `joining` after `SOCKET_CONNECTED` — no resync effect |
| `testResyncNeededWhileConnectingIsDropped` | `RESYNC_NEEDED` while `connecting` — dropped |
| `testMultipleResyncNeededWhileJoiningAreNotQueued` | Triple dispatch during `joining` — **not queued** (Phase B baseline) |
| `testResyncNeededAcceptedAfterReconnectJoinOk` | After `ROOM_JOIN_OK` → `idle`, next `RESYNC_NEEDED` honored |
| `testResyncNeededWhileResyncingIsDropped` | Duplicate `RESYNC_NEEDED` during `resyncing` — no stacked effects |
| `testReconnectEpisodeResyncWindow` | Full episode: socket lost → connect → join → dropped resync → join ok → idle resync works |

**No changes** to `recoveryMachine.ts` implementation.

---

### 4. `multiplayerResyncContract.behaviorTests.ts` (new — behavior test)

**File:** `client/src/multiplayer/multiplayerResyncContract.behaviorTests.ts`  
**Scenarios:** 5

Pure simulation of the **current App.tsx `fetchGameState` indirect path** (lines 782–785):

- Indirect path always returns `true` even when machine drops `RESYNC_NEEDED`
- Indirect path triggers resync only when machine is `idle`
- `recovery_machine` direct path blocked while `joining`
- Multiple indirect requests while joining are lost (not queued)
- Resync honored after reconnect join completes

This file provides meaningful future coverage for Phase A (`useMultiplayerResync`) and Phase B (queue fix) without requiring the production module to exist yet.

Picked up automatically by `run-behavior-tests.mjs` (22 behavior test files total, up from 21).

---

## Files Created

| File | Type | Tests |
|------|------|-------|
| `client/src/multiplayer/socketGuards.test.ts` | Vitest | 20 |
| `client/src/multiplayer/boardSnapshotGuards.test.ts` | Vitest | 24 |
| `client/src/multiplayer/multiplayerResyncContract.behaviorTests.ts` | Behavior | 5 |
| `docs/architecture/phase-0-pvp-test-harness-report.md` | Documentation | — |

---

## Files Modified

| File | Change |
|------|--------|
| `client/src/multiplayer/recoveryMachine.behaviorTests.ts` | +6 integration scenarios, helper `countEffectsOfType` |

---

## Production Code Changed

**None.**

No production files were modified. No APIs changed. No file moves. No refactors.

---

## Test Count Summary

| Suite | Before (approx.) | After | Delta |
|-------|------------------|-------|-------|
| Vitest (`npm run test`) | 347 | **391** | **+44** |
| Behavior tests (multiplayer) | 24 scenarios | **35 scenarios** | **+11** |
| Behavior test files | 21 | **22** | +1 file |

---

## Coverage Improvements

Vitest coverage run on new multiplayer test files:

| Module | Statements | Branches | Functions | Lines |
|--------|------------|----------|-----------|-------|
| `socketGuards.ts` | 100% | 100% | 100% | 100% |
| `boardSnapshotGuards.ts` | 76.8% | 71.8% | 100% | 83.7% |

**Prior state:** `socketGuards.ts` and `boardSnapshotGuards.ts` had **zero** Vitest coverage. Client multiplayer tests were limited to `recoveryMachine.behaviorTests.ts` and `multiplayerRuntime.test.ts` (3 normalize-player tests).

**After Phase 0:** Core client projection and sequence guard paths are CI-protected. Recovery resync window behavior is explicitly documented in tests before Phase B changes it.

---

## Build / Test Results

```
npm run test:all --prefix client
```

- Vitest: **40 files, 391 tests passed**
- Behavior tests: **22 files passed** (including new `multiplayerResyncContract.behaviorTests.ts`)

---

## Documented Baseline for Phase B

The following **current** behavior is now locked in tests and must be consciously changed in Phase B:

1. `fetchGameState(reason)` for `reason !== 'recovery_machine'` dispatches `RESYNC_NEEDED` and returns `true` regardless of machine state.
2. `RESYNC_NEEDED` is **ignored** when recovery machine `state !== 'idle'` (`recoveryMachine.ts:395–398`).
3. Multiple `RESYNC_NEEDED` events during `joining` are **dropped**, not queued.
4. After `ROOM_JOIN_OK` returns machine to `idle`, the next `RESYNC_NEEDED` is honored with a `resync` effect.

Phase B should update these tests when implementing the resync queue fix.

---

## What Was Intentionally Not Done

- No `useMultiplayerResync.ts` production module (Phase A)
- No `recoveryMachine.ts` implementation changes (Phase B)
- No CI dependency-cruiser rules (Phase H)
- No `useRoomSocketSync` hook integration tests (deferred — requires mock socket harness; pure function coverage prioritized)

---

## Recommended Next Step

Proceed to **Phase A** (resync ownership extraction) with Phase 0 tests as merge gate. Run `npm run test:all --prefix client` before and after any structural move.

---

## Related Documents

- [player-vs-player-extraction-plan.md](./player-vs-player-extraction-plan.md)
- [player-vs-player-architecture-audit.md](./player-vs-player-architecture-audit.md)
- [multiplayer-socket-recovery.md](../agent-skills/multiplayer-socket-recovery.md)