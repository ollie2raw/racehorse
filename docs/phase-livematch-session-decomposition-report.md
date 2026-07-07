# Phase: Live Match Session Decomposition Report

## Goal

Decompose `useLiveMatchSession.ts` (~1,099 LOC) into domain-scoped modules following the Bot Match composition pattern: transient UI, gameplay actions, view-model derivation, tile input, hand-reveal choreography, and room-sync param assembly. The monolithic hook becomes a thin composition root that owns shared session state and wires sibling modules without direct cross-imports. This is a structural extraction only — no gameplay, recovery, or public API behavior changes.

## Before / After LOC

| File | Before | After |
|------|--------|-------|
| `useLiveMatchSession.ts` | 1,099 | 418 |
| `liveMatchSessionTypes.ts` | 232 | 232 (unchanged) |

### New module files

| File | LOC |
|------|-----|
| `viewModel/createLiveMatchViewModel.ts` | 165 |
| `actions/useLiveMatchActions.ts` | 592 |
| `input/useTileSelection.ts` | 118 |
| `handReveal/useHandRevealSequence.ts` | 196 |
| `transientUi/useTransientRoomUi.ts` | 143 |
| `roomSocketSyncParams.ts` | 239 |

**Total session package (hook + types + modules):** 2,103 LOC (was ~1,331 in hook + types alone; net increase reflects explicit module boundaries, type exports, and composition wiring).

## Responsibility map

| Responsibility | Original location | New home |
|----------------|-------------------|----------|
| `clearTransientRoomUi` | `useLiveMatchSession.ts` | `transientUi/useTransientRoomUi.ts` |
| `clearPendingGameplayUiOnAuthoritativeState` | `useLiveMatchSession.ts` | `transientUi/useTransientRoomUi.ts` |
| `setDrawSequenceActiveBoth` | `useLiveMatchSession.ts` | `transientUi/useTransientRoomUi.ts` |
| `flashLastPlayed` | `useLiveMatchSession.ts` | `transientUi/useTransientRoomUi.ts` |
| `play`, `draw`, `pass` | `useLiveMatchSession.ts` | `actions/useLiveMatchActions.ts` |
| `startGame`, `requestRematch` | `useLiveMatchSession.ts` | `actions/useLiveMatchActions.ts` |
| `emitDraggingState` | `useLiveMatchSession.ts` | `actions/useLiveMatchActions.ts` |
| `isGameplayActionBlocked` | `useLiveMatchSession.ts` | `actions/useLiveMatchActions.ts` |
| Auto-turn `useEffect` (draw/pass) | `useLiveMatchSession.ts` | `actions/useLiveMatchActions.ts` |
| `boardForDisplay`, `boardLegalMoves` | `useLiveMatchSession.ts` | `viewModel/createLiveMatchViewModel.ts` |
| `selectedTileHasLegalPlay`, `boardSelectedTile` | `useLiveMatchSession.ts` | `viewModel/createLiveMatchViewModel.ts` |
| `boardShowOpenEndGlow`, `handSelectedTile` | `useLiveMatchSession.ts` | `viewModel/createLiveMatchViewModel.ts` |
| Turn/hand derived values (`inGame`, `isMyTurn`, `myHand`, etc.) | `useLiveMatchSession.ts` | `viewModel/createLiveMatchViewModel.ts` |
| `frozenHandOverBoardRef` sync effect | `useLiveMatchSession.ts` | `viewModel/createLiveMatchViewModel.ts` |
| `selectedTile` state + ref | `useLiveMatchSession.ts` | `input/useTileSelection.ts` |
| `handleTileTap`, `onPregameTileTap` | `useLiveMatchSession.ts` | `input/useTileSelection.ts` |
| Tile drag-sync effects | `useLiveMatchSession.ts` | `input/useTileSelection.ts` |
| `continueAfterHandReveal` | `useLiveMatchSession.ts` | `handReveal/useHandRevealSequence.ts` |
| `handRevealAutoProgress` + auto-progress timers | `useLiveMatchSession.ts` | `handReveal/useHandRevealSequence.ts` |
| Hand-reveal show/update/recovery effects | `useLiveMatchSession.ts` | `handReveal/useHandRevealSequence.ts` |
| `roomSocketSyncParams` `useMemo` | `useLiveMatchSession.ts` | `roomSocketSyncParams.ts` |
| `applyJoinResponseGameState` | `useLiveMatchSession.ts` | **Stays in composition hook** |
| Core `useState` / shared `useRef` | `useLiveMatchSession.ts` | **Stays in composition hook** |
| Ref sync effects (`stateRef`, `legalMovesRef`, `youRef`) | `useLiveMatchSession.ts` | **Stays in composition hook** |
| Unmount timer cleanup (`drawSequence`, `lastPlayed`, `handRevealTimer`) | `useLiveMatchSession.ts` | **Stays in composition hook** |
| `LiveMatchSessionApi` return assembly | `useLiveMatchSession.ts` | **Stays in composition hook** |

## Public contract changes

**None.** `LiveMatchSessionApi` in `liveMatchSessionTypes.ts` is unchanged. `MultiplayerGameShell.tsx` continues to import `useLiveMatchSession` from the same path with the same return shape.

## Test results

| Suite | Before | After |
|-------|--------|-------|
| Vitest (`cd client && npm test`) | 391 passed (40 files) | 391 passed (40 files) |
| Behavior (`cd client && node run-behavior-tests.mjs`) | 31 suites passed | 31 suites passed |
| Client build (`npm run build --prefix client`) | — | **Passed** |

## Deviations from planned module structure

1. **Composition hook LOC (418 vs. &lt;150 target).** The return surface of `LiveMatchSessionApi` exposes ~50 fields (state, refs, setters, and actions). Keeping the contract unchanged requires a large return literal and core state declarations in the composition hook. Logic is extracted; the hook is thin in *responsibility* but not in line count.

2. **`createLiveMatchViewModel.ts` exports `useLiveMatchViewModel` (hook)** rather than a pure `createLiveMatchViewModel` function. The frozen-board effect requires React lifecycle; a hook matches Bot Match view-model patterns and avoids a separate effect owner.

3. **`applyJoinResponseGameState` retained in composition.** Join projection touches `maxSequenceRef`, core setters, and `clearTransientRoomUi` — wiring it in composition avoids a seventh cross-domain import and matches the handoff plan.

4. **`emitDraggingStateBridgeRef` in composition.** `useTileSelection` needs `emitDraggingState` from `useLiveMatchActions`, while actions needs `selectedTileRef` from tile selection. A ref bridge in the composition hook breaks the cycle without sibling-module imports (same pattern as Bot Match cross-domain wiring).

5. **`handRevealTimerRef` passed into `useHandRevealSequence` but not read there.** The ref remains owned by composition for unmount cleanup and `LiveMatchSessionApi` exposure; the hand-reveal module accepts it to preserve the param contract without moving cleanup into a module that does not schedule that timer.

## Files touched outside stated scope

**None.** All edits are under `client/src/match/session/` plus this report. No changes to `App.tsx`, `server/src/index.ts`, frozen multiplayer recovery files, `client/src/modules/`, or `client/src/bot/`.

## Remaining debt / follow-up candidates

1. **Shrink composition hook further** by grouping the `LiveMatchSessionApi` return into a typed builder (e.g. `assembleLiveMatchSessionApi(...)`) — would reduce `useLiveMatchSession.ts` LOC without changing the public contract.

2. **Extract `applyJoinResponseGameState`** to `actions/` or a small `joinProjection.ts` if more join paths appear.

3. **`useLiveMatchActions.ts` (592 LOC)** is the largest extracted module; a future pass could split transport emit helpers from the auto-turn effect without changing behavior.

4. **Shared `emitDraggingState` factory** could live in a tiny helper if another consumer needs it, removing the ref-bridge pattern.

5. **`handRevealTimerRef`** is part of the public ref surface but only used for composition unmount cleanup — confirm whether any caller still schedules it or if it can be retired in a separate cleanup task.

## Follow-up fixes

### Ref bridge removed — shared `emitDraggingState`

The `emitDraggingStateBridgeRef` / `emitDraggingStateBridge` pattern was deleted from `useLiveMatchSession.ts`.

`emitDraggingState` now lives in `client/src/match/session/actions/emitDraggingState.ts` as a plain function:

```typescript
export function emitDraggingState(params: EmitDraggingStateParams): void
```

`EmitDraggingStateParams` takes `{ socket, joinedRoom, state, you, dragging, draggingStateRef }`. Both `useTileSelection` and `useLiveMatchActions` import this module directly. `useTileSelection` now receives `joinedRoom` and `draggingStateRef` instead of a callback; `useLiveMatchActions` wraps the same function in a `useCallback` for the public `LiveMatchSessionApi.emitDraggingState` field. No ref bridge remains in the composition hook.

### View-model file rename

`viewModel/createLiveMatchViewModel.ts` was renamed to `viewModel/useLiveMatchViewModel.ts` to match its exported hook. The composition hook import was updated:

`import { useLiveMatchViewModel } from './viewModel/useLiveMatchViewModel';`

A pure `deriveLiveMatchViewModel` helper was also exported from the renamed file (used by the hook and by unit tests) without changing runtime behavior.

### New test files

| File | Coverage |
|------|----------|
| `viewModel/useLiveMatchViewModel.test.ts` | `deriveLiveMatchViewModel`: null/disconnected idle defaults; mid-game turn/hand/legal-move derivation; selected tile with no legal play; frozen board on hand-over; open-end glow; suppressed board moves during pending gameplay action |
| `input/useTileSelection.test.tsx` | `handleTileTap` select/deselect/dragging emit; blocked tap while `pendingActionRef` is set; `onPregameTileTap` emit with socket / no-op without socket |

### Verification (follow-up)

| Suite | Baseline | After follow-up |
|-------|----------|-----------------|
| Vitest (`cd client && npm test`) | 391 passed (40 files) | **402 passed (42 files)** (+11 tests, +2 files) |
| Behavior (`cd client && node run-behavior-tests.mjs`) | 31 suites passed | **31 suites passed** (no new behavior-test files) |
| Client build (`npm run build --prefix client`) | Passed | **Passed** |

### Public contract

**Still unchanged.** `LiveMatchSessionApi` in `liveMatchSessionTypes.ts` was not modified.

### Scope

Only `client/src/match/session/**` and this report file were touched. No changes to `App.tsx`, `server/src/index.ts`, frozen multiplayer recovery files, `client/src/modules/`, or `client/src/bot/`.