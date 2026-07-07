# Phase: Multiplayer Cleanup — `shellDelegates` useMemo Stability Verification

Follow-up to `docs/phase-multiplayer-shellbridgeref-removal-report.md`. Closes the gap where the removal report quoted the pre-refactor `bridge` useMemo with a placeholder dependency array (`[/* stable deps */]`) and never showed the real post-refactor `shellDelegates` useMemo or verified whether its deps are stable enough to avoid spurious App re-renders via `onShellDelegatesChange`.

---

## 1. Actual `shellDelegates` useMemo (current source)

From `client/src/multiplayer/MultiplayerGameShell.tsx` (lines 949–992):

```tsx
  const shellDelegates = useMemo(
    (): MultiplayerShellDelegates => ({
      stateRef,
      draggingStateRef,
      handRevealShownRef,
      handRevealTimerRef,
      rematchAwaitingStateRef,
      setState,
      setLegalMoves,
      setCanDraw,
      setRematchRequested,
      setRematchReadyIds,
      setOpponentDragging,
      setHandReveal,
      setSelectedTile,
      setPendingUiAction,
      setActionError,
      clearTransientRoomUi,
      applyJoinResponseGameState,
      resetShellClientGameSession,
      inGame,
    }),
    [
      applyJoinResponseGameState,
      clearTransientRoomUi,
      draggingStateRef,
      handRevealShownRef,
      handRevealTimerRef,
      inGame,
      rematchAwaitingStateRef,
      resetShellClientGameSession,
      setActionError,
      setCanDraw,
      setHandReveal,
      setLegalMoves,
      setOpponentDragging,
      setPendingUiAction,
      setRematchReadyIds,
      setRematchRequested,
      setSelectedTile,
      setState,
      stateRef,
    ],
  );
```

Registration effect (lines 1002–1008):

```tsx
  useLayoutEffect(() => {
    onShellDelegatesChange(shellDelegates);
    return () => {
      onShellDelegatesChange(null);
      resetGameSnapshot();
    };
  }, [onShellDelegatesChange, shellDelegates]);
```

App callback (lines 339–342 of `App.tsx`):

```tsx
  const handleShellDelegatesChange = useCallback((next: MultiplayerShellDelegates | null) => {
    setShellDelegates(next);
  }, []);
```

---

## 2. Stability question

If any dependency in the `shellDelegates` useMemo changes identity on a normal render, `shellDelegates` gets a new object identity → the `useLayoutEffect` re-runs → `onShellDelegatesChange(shellDelegates)` → `setShellDelegates` in App → **extra App re-render**. During active play this would be a regression risk (the old ref bridge mutated `shellBridgeRef.current` without triggering parent re-renders).

---

## 3. Per-dependency stability proof

| Dependency | Source | Stable? | Proof |
|------------|--------|---------|-------|
| `stateRef` | `useRef` in `useLiveMatchSession` | **Yes** | Ref object identity is fixed for hook lifetime (`useLiveMatchSession.ts` L81). |
| `draggingStateRef` | `useRef` in `useLiveMatchSession` | **Yes** | L90. |
| `handRevealShownRef` | `useRef` in `useLiveMatchSession` | **Yes** | L88. |
| `handRevealTimerRef` | `useRef` in `useLiveMatchSession` | **Yes** | L89. |
| `rematchAwaitingStateRef` | `useRef` in `useLiveMatchSession` | **Yes** | L99. |
| `setState` | `useState` in `useLiveMatchSession` | **Yes** | React guarantees `useState` setter identity is stable across renders (L58). |
| `setLegalMoves` | `useState` in `useLiveMatchSession` | **Yes** | L59. |
| `setCanDraw` | `useState` in `useLiveMatchSession` | **Yes** | L60. |
| `setRematchRequested` | `useState` in `useLiveMatchSession` | **Yes** | L66. |
| `setRematchReadyIds` | `useState` in `useLiveMatchSession` | **Yes** | L67. |
| `setOpponentDragging` | `useState` in `useLiveMatchSession` | **Yes** | L77. |
| `setHandReveal` | `useState` in `useLiveMatchSession` | **Yes** | L65. |
| `setSelectedTile` | `useCallback` in `useTileSelection` | **Yes** | Empty deps `[]` — wraps `useState` setter (`input/useTileSelection.ts` L52–59). |
| `setPendingUiAction` | `useState` in `useLiveMatchSession` | **Yes** | L61–63. |
| `setActionError` | `useState` in `useLiveMatchSession` | **Yes** | L64. |
| `clearTransientRoomUi` | `useCallback` in `useTransientRoomUi` | **Yes** | Deps are exclusively `useState` setters, `useRef` objects, and `setDrawSequenceActiveBoth` (all stable — see below). `transientUi/useTransientRoomUi.ts` L86–122. |
| `setDrawSequenceActiveBoth` (transitive dep of `clearTransientRoomUi`) | `useCallback` in `useTransientRoomUi` | **Yes** | Deps: `[drawSequenceActiveRef, setDrawSequenceActive]` — ref + `useState` setter (L62–68). |
| `applyJoinResponseGameState` | `useCallback` in `useLiveMatchSession` | **Yes** | Deps: `[transientUi.clearTransientRoomUi, maxSequenceRef]` — both stable (`useLiveMatchSession.ts` L232–257). `maxSequenceRef` is an App-owned ref object from `useMemo([], [])`. |
| `resetShellClientGameSession` | `useCallback` in `MultiplayerGameShell` | **Yes** | Deps are refs (`autoTurnActionKeyRef`, `mpAutoDrawSuppressUntilSequenceRef`, `frozenHandOverBoardRef`, `matchStartedRef`, `playerReadyEmittedRef`, `rematchAwaitingStateRef`, `resyncBufferedUpdateRef`) plus `useState` setters (`setBoneyardDisplayCount`, `setOpponentDisconnectMessage`, `setOpponentDragging`) and `clearTransientRoomUi` — all stable (`MultiplayerGameShell.tsx` L286–310). |
| `inGame` | `viewModel.inGame` primitive boolean | **Conditionally stable** | `Boolean(isConnected && joinedRoom && state)` (`viewModel/useLiveMatchViewModel.ts` L83). Value changes only at lifecycle boundaries (connect/disconnect, room join/leave, `state` null ↔ non-null). **Does not change** on routine `state:update` events while a match is active (`state` stays truthy). |
| `onShellDelegatesChange` (effect dep, not useMemo dep) | `handleShellDelegatesChange` in App | **Yes** | `useCallback(..., [])` — stable for App lifetime. |

---

## 4. Conclusion: **confirmed stable during normal operation**

**No code fix required.**

### During active gameplay (`state:update` stream)

- All callback/ref/setter deps retain stable identity.
- `inGame` remains `true` as long as `isConnected`, `joinedRoom`, and `state` are all truthy; updating `state` to a new object does **not** flip `inGame`.
- Therefore `useMemo` returns the **cached** `shellDelegates` object → the registration `useLayoutEffect` does **not** re-fire → App does **not** get spurious `setShellDelegates` re-renders on each socket tick.

This preserves the original design goal: App does not re-render on every `state:update`.

### Intentional re-registration (not a regression)

`inGame` **does** change at game lifecycle boundaries:

| Transition | `inGame` change | Effect |
|------------|-----------------|--------|
| Lobby → first authoritative state | `false` → `true` | New `shellDelegates` object; one App re-render to register delegates |
| Leave room / session reset (`state` → `null`) | `true` → `false` | New object; one App re-render |
| Disconnect while in room | may flip `inGame` | One re-render; acceptable |

These are **expected** and bounded (at most one extra App re-render per boundary). The old ref bridge avoided parent re-renders on registration by mutating a ref; the new callback pattern causes one parent re-render when `shellDelegates` identity changes. That trade-off was accepted in the removal report design (§3).

### Downstream churn when `shellDelegates` *does* change

When `shellDelegates` identity changes (mount or `inGame` flip), App's `applySnapshot` and `resetClientGameSession` callbacks gain new `[shellDelegates]` identity, and `useMultiplayerShellDelegates` wrappers refresh. This is intentional and occurs at the same lifecycle moments as before (bridge object was also rebuilt when `inGame` changed, but ref mutation hid it from React).

---

## 5. Fix applied

**None.** Stability analysis confirms the real dependency array is complete and correct; no placeholder elision remains in source.

---

## 6. Verification (re-run)

| Check | Before (removal report) | After (this verification) |
|-------|-------------------------|---------------------------|
| Client test files | 61 | **61** (unchanged) |
| Client tests | 513 | **513** (unchanged) |
| Client build | PASS (5.71s) | **PASS** (5.59s) |

```
Test Files  61 passed (61)
Tests       513 passed (513)
✓ built in 5.59s
```

---

## 7. Related files

| File | Role |
|------|------|
| `client/src/multiplayer/MultiplayerGameShell.tsx` | `shellDelegates` useMemo + registration effect |
| `client/src/App.tsx` | `handleShellDelegatesChange`, `shellDelegates` state |
| `client/src/match/session/useLiveMatchSession.ts` | Setters, refs, `applyJoinResponseGameState` |
| `client/src/match/session/transientUi/useTransientRoomUi.ts` | `clearTransientRoomUi` |
| `client/src/match/session/input/useTileSelection.ts` | `setSelectedTile` |
| `client/src/match/session/viewModel/useLiveMatchViewModel.ts` | `inGame` derivation |
| `docs/phase-multiplayer-shellbridgeref-removal-report.md` | Original removal report |