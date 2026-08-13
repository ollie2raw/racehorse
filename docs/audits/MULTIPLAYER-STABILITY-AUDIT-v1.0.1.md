# Multiplayer Stability & Synchronization Incident Audit (v1.0.1)

This audit analyzes three critical multiplayer sync incidents reported in the v1.0.1 release, traces their execution paths, identifies root causes, and details recommended structural resolutions.

---

## 1. Executive Summary

A comprehensive audit of the client-side state machine, React hooks layer, Socket Event Bus, and connection recovery loops reveals that the reported incidents are caused by **three distinct synchronization and React lifecycle bugs**:
1.  **Deselection / Pointer Interference**: Stray pointer capture and background clicks on empty board regions trigger unintended deselections of tiles.
2.  **Unhandled Animation Catch States**: Throw-blocks inside the `game:draw_animation` sequence interrupt the normal clean-up loop, leaving inputs permanently locked.
3.  **Callback Identity Churn (Render-Timer Reset)**: Churn in callback identities in the `useHandRevealScheduler` auto-advance `useEffect` resets timers on every render, freezing the end-of-hand progress.

No structural modifications to the server-authoritative protocol are required. Instead, targeted changes to client event delegation, error boundaries, and hook dependencies are recommended.

---

## 2. Incident Analysis & Root Causes

### Incident 1 — Tile Placement Sometimes Requires Multiple Clicks
*   **Observed Behavior**: Clicking a legal placement zone occasionally does nothing, requiring 2–3 clicks to place a tile.
*   **Execution Trace**:
    1.  The user clicks a tile in their hand, setting `selectedTileRef.current` and triggering a re-render to display legal `.placement-zone` elements.
    2.  The user moves their pointer to a placement zone and clicks.
    3.  If the pointer slightly misses the inner hit-box of the `.placement-zone` (or triggers pointer/mouse actions on adjacent board grid regions), the event bubbles up to the parent `<Board />` container's background click handler.
    4.  The background handler deselects the active tile: `setSelectedTile(null)`.
    5.  The click on the placement zone fails because `selectedTile` is now `null`, causing `play` to return immediately.
*   **Root Cause**: Lack of event capture isolation and coordinate boundaries between the board background listener and the placement zones. A slight offset click is registered as an empty board click, deselecting the active tile.

---

### Incident 2 — Opponent Passes, Then Local Player Cannot Play
*   **Observed Behavior**: When the boneyard is locked and the opponent auto-passes, the turn transfers to the local player, but the local player cannot play until they refresh the page.
*   **Execution Trace**:
    1.  Opponent auto-passes. Server processes the pass, updates the turn index, and broadcasts `state:update` and/or `game:draw_animation` (if forced draws/passes occur).
    2.  The local client receives the event and starts the draw animation.
    3.  During one of the staggered steps of the animation loop, a reference (e.g. `handAreaRef.current` or `boneyardRef.current`) is temporarily missing due to React render timing, causing an error to be thrown.
    4.  The `catch` block in `useRoomSocketSync.ts` handles the error and runs `clearPendingDrawAnimationTimers()`:
        ```typescript
        } catch (error) {
          logger.error('useRoomSocketSync.ts', error, ...);
          clearPendingDrawAnimationTimers();
        }
        ```
    5.  However, the `catch` block **never** calls `scope.ui.setDrawSequenceActiveBoth(false)` or resets `drawStep` states.
    6.  As a result, `drawSequenceActive` remains `true` indefinitely.
    7.  Subsequent moves are blocked by `isGameplayActionBlocked()`, which returns `true` because `drawSequenceActive` is active.
*   **Root Cause**: Unhandled exceptions in the stagger loop leave `drawSequenceActive` locked in a `true` state, blocking all subsequent user inputs.

---

### Incident 3 — Daily Fritz Hand Transition Freeze
*   **Observed Behavior**: The end-of-hand modal appears but freezes. The next hand never starts. Refreshing the page restores the match but rolls it back to before the hand started.
*   **Execution Trace**:
    1.  A hand completes. `BotHandOverModal` is rendered.
    2.  Because Daily Fritz is a competitive single-player mode, it does not display a manual "Next Hand" button; it relies on the auto-advance timer to transition.
    3.  `useHandRevealScheduler.ts` starts a `setTimeout` with a duration of `DAILY_FRITZ_HAND_AUTO_ADVANCE_MS` (2.5 seconds) to trigger `onAutoAdvance` (`advanceHandRef.current`).
    4.  However, `onAutoAdvance` depends on `onAutoAdvance` in its dependency array. Because `onAutoAdvance` is recreated on every render of the parent component (due to inline callback recreation), the scheduler's `useEffect` clean-up function runs and clears the timer:
        ```typescript
        return () => {
          if (handAutoAdvanceTimerRef.current) {
            window.clearTimeout(handAutoAdvanceTimerRef.current);
            handAutoAdvanceTimerRef.current = null;
          }
        };
        ```
    5.  Since the timer is cleared and restarted on every render, the auto-advance timer never fires, freezing the modal.
    6.  Because the transition never completes, the next hand is never requested from the server, and the new state is never written to `sessionStorage`.
*   **Root Cause**: Churn in callback identities within the auto-advance `useEffect` dependency array resets the transition timer on every render, preventing the next hand from starting.

---

## 3. State & Event Lifecycle Analysis

### Normal Flow
```
Client (User)           SocketEventBus           RecoveryMachine           Server (Auth)
   |                           |                        |                        |
   |-- Click Tile (Select) ---->                        |                        |
   |-- Click Place Zone ------>                        |                        |
   |                           |-- Send MOVE Action ----------------------------->
   |                           <-- Ack (OK) -------------------------------------|
   |                           <-- Broadcast state:update -----------------------|
   |<-- Update Board State ----|                        |                        |
```

### Broken Flow (Incident 2 / Draw Stagger Error)
```
Client (User)           SocketEventBus           RecoveryMachine           Server (Auth)
   |                           |                        |                        |
   |                           <-- game:draw_animation --------------------------|
   |-- [Start Stagger Animation]                        |                        |
   |-- [DOM Ref is Null -> Throw Exception]             |                        |
   |-- [timers cleared, drawSequenceActive stays true]  |                        |
   |-- Click Place Zone (Ignored)                       |                        |
```

### Refresh + Recovery Flow (Incident 3)
```
Client (User)           SocketEventBus           RecoveryMachine           Server (Auth)
   |                                                    |                        |
   |-- Page Refresh ------------------------------------>                        |
   |-- Re-bootstrap Match State ------------------------>                        |
   |-- Read LocalStorage / SessionStorage --------------->                        |
   |-- [Restores pre-transition match state]            |                        |
```

---

## 4. Socket Event Bus Audit

| Event Name | Source | Destination | Ordering Guarantee | Deduplication Filter |
| :--- | :--- | :--- | :--- | :--- |
| `MOVE` | Client | Server | Serialized | Checked via client `pendingActionRef` |
| `state:update` | Server | Client | Sequence-stamped | Handled by `acceptNormalizedTransportIngress` |
| `game:draw_animation` | Server | Client | Stamped | Handled by `lastForcedDrawAnimationSequence` |

---

## 5. Recommended Fix Actions

1.  **Deselection / Pointer Isolation (Incident 1)**:
    *   Add `e.stopPropagation()` and `e.preventDefault()` to the pointer/mouse event listeners of placement zones.
    *   Increase hitboxes for placement zone containers to prevent minor click offsets from hitting the board background.

2.  **Animation Exception Safety (Incident 2)**:
    *   Ensure the `catch` block of `onDrawAnimation` explicitly calls `scope.ui.setDrawSequenceActiveBoth(false)` to prevent input locks.
    *   Wrap animation step calls in defensive checks to ensure DOM refs are valid before reading bounding rectangles.

3.  **Callback Identity Optimization (Incident 3)**:
    *   Wrap `onAutoAdvance`, `onRevealShown`, and `onRevealHidden` in `useCallback` hooks with stable dependency signatures.
    *   Ensure the auto-advance timer hook in `useHandRevealScheduler` does not clean up and restart the timer if the callback reference changes.
