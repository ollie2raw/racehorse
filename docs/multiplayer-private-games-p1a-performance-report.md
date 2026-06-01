# Multiplayer / Private Games — P1a Performance Pass Report

**Date:** 2026-05-31  
**Scope:** Smallest safe perceived-latency improvements from [P1 audit](./multiplayer-private-games-p1-performance-audit.md).  
**Out of scope:** UI redesign, App split, optimistic tiles, payload trimming, protocol changes.

---

## Summary

P1a reduces **felt lag** by unlocking board legal zones and hand UI as soon as authoritative `state:update` confirms the local action (sequence advanced past emit baseline), instead of waiting for the socket ack. Duplicate board projection on the render path was removed. Debug-gated `[mp-perf]` timing logs were added for MOVE/DRAW/PASS.

**Correctness:** Targeted live socket smoke **3/3 pass**. Client build pass. One pre-existing server unit-test mock failure (unrelated to client changes).

---

## What changed

### 1. Debug-gated performance instrumentation (`mp_debug=1`)

**New file:** `client/src/multiplayer/mpPerf.ts`

When `localStorage.setItem('mp_debug', '1')`:

| Log tag | When |
|---------|------|
| `[mp-perf] emit` | MOVE/DRAW/PASS socket emit (kind + baseline sequence) |
| `[mp-perf] state:update` | Authoritative snapshot applied after sequence check (ms from emit, projection ms) |
| `[mp-perf] pending-ui-cleared` | `pendingUiAction` cleared early on confirmed state |
| `[mp-perf] ack` | Ack received (ms from emit, from state:update, from pending clear) |

Existing `[mp-action-client]` ack RTT logs in `emitWithAck` remain unchanged.

**Usage:**

```javascript
localStorage.setItem('mp_debug', '1');
// Play a private match; watch console for [mp-perf] lines per action.
```

### 2. Early pending UI clear on authoritative state

**Problem:** `state:update` arrives before ack, but `pendingUiAction` stayed set until ack `finally`, hiding legal zones and making the board feel frozen.

**Fix:**

- On emit: record `pendingGameplayActionRef = { kind, baselineSequence }`.
- After `state:update` passes sequence watermark in `useRoomSocketSync`, call `clearPendingGameplayUiOnAuthoritativeState`:
  - Clear `pendingUiAction` only if `nextState.sequence > baselineSequence`.
  - Does **not** clear `pendingActionRef` (still blocks duplicate submits until ack).
- Removed `pendingActionRef` from `boardLegalMoves` gate — legal zones now follow `pendingUiAction` only (refs don't trigger re-renders anyway).
- Ack `finally` still clears both refs and handles errors/timeouts.

**Safety:**

| Case | Behavior |
|------|----------|
| Stale `state:update` | Rejected by sequence watermark — callback not reached |
| Opponent move | No `pendingGameplayActionRef` — no early clear |
| Illegal / wrong-turn | No broadcast — pending until ack error |
| Ack error / timeout | `finally` clears all pending state |

### 3. Redundant board projection removed

| Location | Before | After |
|----------|--------|-------|
| `boardForDisplay` useMemo | `projectRenderableBoard(rawBoard)` every state change | Uses `state.board` directly (already projected in socket sync / join ack) |
| Frozen hand-over effect | Re-projected `state.board` into ref | Stores already-projected `state.board` |

**Kept:** Single projection in `projectMultiplayerGameState` (`useRoomSocketSync` + `applyJoinedRoomResponse`).

### 4. Stabilized action callbacks

`play`, `draw`, and `pass` now read gameplay context from `stateRef`, `legalMovesRef`, and `selectedTileRef` instead of listing `state` / `legalMoves` / `selectedTile` in `useCallback` deps. This reduces `onPositionClick` identity churn so `Board` memo can skip layout recomputation when props are unchanged.

---

## What was measured

This pass adds **instrumentation** but did not capture before/after timings in CI (no browser automation in pipeline).

**Expected improvement (from audit architecture):**

- **Pending UI clear** should move from ~ack RTT to ~state:update RTT (typically tens of ms earlier on LAN).
- **Board projection** saves one `projectRenderableBoard` + `hydrateBoardForOpenEnds` pass per move on the render path.
- **Callback stability** reduces unnecessary `Board` re-layout when memo hits.

**To capture before/after:** enable `mp_debug=1`, play 5 moves, compare `msFromEmit` on `pending-ui-cleared` vs `ack` lines.

---

## Files changed

| File | Change |
|------|--------|
| `client/src/multiplayer/mpPerf.ts` | **New** — debug-gated action timing |
| `client/src/multiplayer/useRoomSocketSync.ts` | Projection timing; `onAuthoritativeGameplayStateApplied` hook |
| `client/src/App.tsx` | Early pending clear; refs; stable callbacks; projection dedupe; `boardLegalMoves` gate |
| `server/src/multiplayer/registerRoomSessionHandlers.private.test.ts` | Socket.IO mock + concurrent test assertions hardened |

---

## Server test fix (post-P1a)

### Failing test

`registerRoomSessionHandlers.private.test.ts` → **`serializes concurrent game:action requests for the same room`**

### Root cause (not P1a client changes; not gameplay regression)

Two **P0-era test harness gaps** exposed by random deals and forced-draw paths:

1. **Mock gap:** `makeTwoPlayerIo` returned `io.to()` → `{ emit }` only. Production code calls `io.to(roomCode).except(targetSocketId).emit(...)` in `emitForcedDrawAnimationPayload` after a MOVE that triggers forced draw. When that path hit, the handler threw `io.to(...).except is not a function`, both concurrent acks returned `ok: false`, and `okCount` was 0.

2. **Assertion gap:** `expect(sequence).toBe(beforeSequence + 1)` assumed every successful MOVE advances sequence by exactly 1. A MOVE that resolves a forced-draw chain can advance sequence by **+2** (play + embedded auto-pass) — correct server behavior, wrong test expectation.

3. **Setup gap (flaky):** Sometimes the random opening deal had **no legal play** for the current player at test start, failing before `game:action` ran.

### Fixes applied

- **`makeIoRoomTarget()`** — mock chain supports `io.to(...).emit` and `io.to(...).except(...).emit`.
- **Sequence assertion** — assert successful ack `sequence > beforeSequence` and matches room state (handles forced-draw +2).
- **`findPlayMoveForCurrentTurn()`** — setup helper draws/passes until a playable MOVE exists (max 24 steps).

Stress: concurrent test **200/200** passes in isolation. Full multiplayer suite **24/24** green.

---

## Tests run

| Command | Result |
|---------|--------|
| `npm run build --prefix server` | **Pass** |
| `npm run build --prefix client` | **Pass** |
| `npm test -- --run src/multiplayer src/game/invariants` (server) | **24/24 pass** |
| `SMOKE_ONLY=private-create-join-start-move,hand-masking-after-move,concurrent-action-serialization npm run test:smoke:sockets --prefix client` | **3/3 pass** (unchanged; no gameplay code in test fix) |

---

## Remaining lag sources (post-P1a)

1. **No optimistic tile placement** — board still waits for `state:update` before tile appears.
2. **Full `state:update` payload** — entire `GameState` + `legalMoves` every move.
3. **Monolithic `App.tsx` re-render** — all hooks run on each update.
4. **`computeLayout` 2–3× per Board render** when memo misses.
5. **Forced-draw animation timers** — cosmetic stagger/fly work after authoritative state.
6. **Ack RTT** — still blocks new actions via `pendingActionRef` / `isGameplayActionBlocked` until ack (intentional duplicate-submit guard).

---

## Recommended next steps (P1b / P2)

| Priority | Item | Risk |
|----------|------|------|
| P1b | Optimistic tile on play (clear on sequence mismatch) | Medium |
| P1b | Extract multiplayer in-game shell from `App.tsx` | Medium |
| P1b | Consolidate Board `computeLayout` to single pass | Low–medium |
| P1b | Websocket-only transport after connect | Low |
| P2 | Trim `boneyard[]` / delta state updates | Medium–high |

---

## Definition of done

- [x] UI no longer stays in `pendingUiAction` lock after authoritative `state:update` confirms local action sequence advance.
- [x] Stale/opponent-only updates do not clear pending UI incorrectly.
- [x] Ack error/timeout handling preserved.
- [x] Performance logs gated behind `mp_debug=1`.
- [x] Live socket smoke scenarios pass.
- [x] Client build passes.
- [x] Server multiplayer unit suite **24/24** green.
