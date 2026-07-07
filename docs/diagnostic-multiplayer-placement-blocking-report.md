# Diagnostic: Multiplayer Placement Input Blocking

**Scope:** Instrumentation only — no gameplay behavior changes.  
**Hypothesis under test:** `drawSequenceActive` is set `true` on `state:update` (forced-draw metadata) before `game:draw_animation` arrives; it only clears via the animation timer chain (`steps.length * 500ms + 1800ms` after the animation event). During that window, `useLiveMatchActions.play()` silently no-ops when `isGameplayActionBlocked()` sees `drawSequenceActive`, `flyingTiles.length > 0`, or `pendingActionRef.current`.

**Date:** 2026-07-05

---

## Important: leave instrumentation in place

All lines marked `// TEMP-DIAGNOSTIC` must **remain until this investigation concludes**, then be removed in a dedicated follow-up cleanup task. Grep removal command:

```bash
rg 'TEMP-DIAGNOSTIC' client/src
```

---

## Files modified (instrumentation only)

| File | Role |
|------|------|
| `client/src/match/session/actions/useLiveMatchActions.ts` | Block-reason logging on `play()`; condition-age refs; `drawSequenceActive` / `flyingTiles` transition observers |
| `client/src/multiplayer/useRoomSocketSync.ts` | Forced-draw state/animation correlation; path-tagged `drawSequenceActive` / `flyingTiles` logs in handler bodies |
| `client/src/match/session/transientUi/useTransientRoomUi.ts` | Path-tagged clear log in `clearTransientRoomUi` |
| `client/src/multiplayer/MultiplayerGameShell.tsx` | Path-tagged clear log in state-null `useEffect` |

**Not modified (read-only per task):** `recoveryMachine.ts`, `socketEventBus.ts`, all `shouldDrop*` projection-gate functions.

**All `drawSequenceActive` clear paths are now path-tagged** — see §Follow-up: coverage gaps closed for the complete inventory (`clearDrawPreview`, `game:draw_animation:timer_chain_complete`, `useTransientRoomUi:clearTransientRoomUi`, `MultiplayerGameShell:stateNullEffect`).

---

## Full diff of every `TEMP-DIAGNOSTIC` line

### `client/src/match/session/actions/useLiveMatchActions.ts`

**L144** — comment introducing diagnostic timestamp refs:

```typescript
  // TEMP-DIAGNOSTIC: timestamps for how long each block condition has been active.
```

**L145–L151** — supporting refs (not logged directly; feed `conditionAgeMs`):

```typescript
  const drawSequenceActiveTrueSinceRef = useRef<number | null>(null);
  const flyingTilesNonEmptySinceRef = useRef<number | null>(null);
  const pendingActionTrueSinceRef = useRef<number | null>(null);
  const pendingUiActionTrueSinceRef = useRef<number | null>(null);
  const connectionBlockedTrueSinceRef = useRef<number | null>(null);
  const prevDrawSequenceActiveRef = useRef(drawSequenceActive);
  const prevFlyingTilesCountRef = useRef(flyingTiles.length);
```

**L153–L166** — `setPendingActionRefDiag` wrapper (tracks `pendingActionRef` flip times; same assignments as before):

```typescript
  const setPendingActionRefDiag = useCallback(
    (value: boolean) => {
      const now = Date.now();
      if (value) {
        if (pendingActionTrueSinceRef.current === null) {
          pendingActionTrueSinceRef.current = now;
        }
      } else {
        pendingActionTrueSinceRef.current = null;
      }
      pendingActionRef.current = value;
    },
    [pendingActionRef],
  );
```

**L183–L188** — log every `drawSequenceActive` React-state transition:

```typescript
      // TEMP-DIAGNOSTIC: correlate with useRoomSocketSync path-tagged logs for clear-path attribution.
      console.log('[TEMP-DIAGNOSTIC] drawSequenceActive observed transition', {
        from: prev,
        to: drawSequenceActive,
        at: now,
      });
```

**L202–L210** — log `flyingTiles` non-empty → empty:

```typescript
      // TEMP-DIAGNOSTIC
      console.log('[TEMP-DIAGNOSTIC] flyingTiles transitioned to empty', {
        at: now,
        wasNonEmptyForMs:
          flyingTilesNonEmptySinceRef.current === null
            ? null
            : now - flyingTilesNonEmptySinceRef.current,
        previousCount: prevCount,
      });
```

**L595–L611** — log every blocked `play()` with reason + condition age:

```typescript
          // TEMP-DIAGNOSTIC
          console.log('[TEMP-DIAGNOSTIC] play() blocked by isGameplayActionBlocked', {
            reason: blockReason,
            conditionAgeMs: blockConditionAgeMs(blockReason),
            at: Date.now(),
            position,
            selectedTile: selected ? `${selected.low}-${selected.high}` : null,
            stateSequence: stateNow?.sequence ?? null,
            drawSequenceActive,
            flyingTilesCount: flyingTiles.length,
            pendingActionRef: pendingActionRef.current,
            pendingUiAction,
            roomRecoveryState,
            socketConnected: socket?.connected ?? false,
            isRecoveringConnection,
            rejoinInFlight: rejoinInFlightRef.current,
          });
```

**Supporting (no TEMP-DIAGNOSTIC tag):** `diagnoseGameplayBlockReason`, `blockConditionAgeMs`, and `setPendingActionRefDiag` replacements at former `pendingActionRef.current = true/false` sites in `draw`/`pass`/`play` — behavior unchanged.

---

### `client/src/multiplayer/useRoomSocketSync.ts`

**L160–L164** — `clearDrawPreview` sets `drawSequenceActive` false:

```typescript
  // TEMP-DIAGNOSTIC
  console.log('[TEMP-DIAGNOSTIC] drawSequenceActive set false', {
    path: 'clearDrawPreview',
    at: Date.now(),
  });
```

**L169–L173** — `clearDrawPreview` clears flying tiles:

```typescript
  // TEMP-DIAGNOSTIC
  console.log('[TEMP-DIAGNOSTIC] flyingTiles cleared', {
    path: 'clearDrawPreview',
    at: Date.now(),
  });
```

**L496–L501** — record self forced-draw state event (calls `recordForcedDrawStateEvent` before `setDrawSequenceActiveBoth(true)`):

```typescript
        recordForcedDrawStateEvent(
          'state:self_forced',
          nextState.sequence,
          params.youRef.current,
          payload.forcedDrawCount ?? 0,
        );
```

**L528–L533** — record opponent forced-draw state event:

```typescript
          recordForcedDrawStateEvent(
            'state:opponent_forced',
            nextState.sequence,
            payload.forcedDrawActorId!,
            payload.forcedDrawCount ?? 0,
          );
```

**L545** — comment on no-forced-draw branch:

```typescript
          // TEMP-DIAGNOSTIC: clearDrawPreview logs drawSequenceActive=false with path clearDrawPreview.
```

**L636–L735** — diagnostic helpers inside socket effect (includes TEMP-DIAGNOSTIC logs):

**L668–L677** — state event sets draw sequence active:

```typescript
      // TEMP-DIAGNOSTIC
      console.log('[TEMP-DIAGNOSTIC] drawSequenceActive set true (forced-draw state event)', {
        path: 'applyAuthoritativeStateUpdate',
        source,
        sequence,
        actorId,
        forcedDrawCount,
        diagId,
        at: stateEventAt,
      });
```

**L678–L693** — logging-only 30s watchdog if animation never arrives:

```typescript
      // TEMP-DIAGNOSTIC: logging-only watchdog — does not change drawSequenceActive or gameplay.
      window.setTimeout(() => {
        const pending = forcedDrawPendingDiags.find(
          (item) => item.diagId === diagId && !item.animationArrived,
        );
        if (pending) {
          console.warn('[TEMP-DIAGNOSTIC] game:draw_animation never arrived for forced-draw state event', {
            diagId: pending.diagId,
            source: pending.source,
            sequence: pending.sequence,
            actorId: pending.actorId,
            forcedDrawCount: pending.forcedDrawCount,
            elapsedMs: Date.now() - pending.stateEventAt,
          });
        }
      }, 30_000);
```

**L714–L724** — animation matched to pending state event:

```typescript
        // TEMP-DIAGNOSTIC
        console.log('[TEMP-DIAGNOSTIC] game:draw_animation arrived for forced-draw state event', {
          diagId: pending.diagId,
          source: pending.source,
          sequence: pending.sequence,
          actorId: pending.actorId,
          chainId,
          stepCount,
          latencyMs: arrivedAt - pending.stateEventAt,
          at: arrivedAt,
        });
```

**L727–L734** — animation arrived without matching state event:

```typescript
      // TEMP-DIAGNOSTIC
      console.log('[TEMP-DIAGNOSTIC] game:draw_animation arrived without matching pending state event', {
        sequence,
        actorId,
        chainId,
        stepCount,
        at: arrivedAt,
      });
```

**L763–L767** — early exit hand/game over:

```typescript
          // TEMP-DIAGNOSTIC
          console.log('[TEMP-DIAGNOSTIC] flyingTiles cleared', {
            path: 'game:draw_animation:handOverOrGameOver',
            at: Date.now(),
          });
```

**L805–L814** — animation handler sets draw sequence active:

```typescript
        // TEMP-DIAGNOSTIC
        console.log('[TEMP-DIAGNOSTIC] drawSequenceActive set true', {
          path: 'game:draw_animation:handler_start',
          actorId: payload.playerId,
          sequence: payload.sequence,
          chainId,
          stepCount: payload.steps.length,
          ownForcedDraw,
          at: Date.now(),
        });
```

**L861–L865** — step timer hand/game over:

```typescript
                // TEMP-DIAGNOSTIC
                console.log('[TEMP-DIAGNOSTIC] flyingTiles cleared', {
                  path: 'game:draw_animation:step:handOverOrGameOver',
                  at: Date.now(),
                });
```

**L938–L953** — timer chain completion (primary clear path):

```typescript
          // TEMP-DIAGNOSTIC
          console.log('[TEMP-DIAGNOSTIC] flyingTiles cleared', {
            path: 'game:draw_animation:timer_chain_complete',
            chainId,
            chainDurationMs,
            at: Date.now(),
          });
          params.setFlyingTiles([]);
          // TEMP-DIAGNOSTIC
          console.log('[TEMP-DIAGNOSTIC] drawSequenceActive set false', {
            path: 'game:draw_animation:timer_chain_complete',
            chainId,
            stepCount: payload.steps.length,
            chainDurationMs,
            at: Date.now(),
          });
```

---

## Console log glossary

| Log prefix | Meaning |
|------------|---------|
| `[TEMP-DIAGNOSTIC] play() blocked by isGameplayActionBlocked` | User clicked a placement zone while blocked; see `reason` and `conditionAgeMs` |
| `[TEMP-DIAGNOSTIC] drawSequenceActive set true (forced-draw state event)` | `state:update` applied with `forcedDrawCount > 0` — **before** animation |
| `[TEMP-DIAGNOSTIC] drawSequenceActive set true` path `game:draw_animation:handler_start` | Animation event received and handler started |
| `[TEMP-DIAGNOSTIC] game:draw_animation arrived for forced-draw state event` | **`latencyMs`** = animation arrival minus state event (key metric) |
| `[TEMP-DIAGNOSTIC] game:draw_animation never arrived...` | 30s watchdog — state set active but no animation (hypothesis smoking gun) |
| `[TEMP-DIAGNOSTIC] drawSequenceActive set false` path `game:draw_animation:timer_chain_complete` | Normal clear after `steps*500+1800` ms from animation start |
| `[TEMP-DIAGNOSTIC] drawSequenceActive observed transition` | React state flip — pair with path-tagged logs above for clear attribution |
| `[TEMP-DIAGNOSTIC] flyingTiles transitioned to empty` | Observed at action layer when block from `flyingTiles` may lift |

### `reason` values on blocked `play()`

| `reason` | `conditionAgeMs` source |
|----------|-------------------------|
| `pendingActionRef` | Time since last `pendingActionRef.current = true` in this hook |
| `drawSequenceActive` | Time since `drawSequenceActive` became true |
| `flyingTiles` | Time since `flyingTiles.length` became > 0 |
| `pendingUiAction` | Time since `pendingUiAction` became `draw`/`pass`/`play` |
| `connection` | Time since socket/recovery block began |
| `missing_context` / `handOver` / `not_in_game` / `not_your_turn` | `conditionAgeMs` is `null` |

---

## How to reproduce and capture data

### Prerequisites

1. Build/run client against **staged or local** multiplayer server (both must include this instrumentation).
2. Open browser DevTools → **Console**.
3. Enable **Preserve log**.
4. Filter console: `TEMP-DIAGNOSTIC`

### Scenario A — forced draw on your turn (primary hypothesis test)

1. Start a **private 1v1** multiplayer match (two browsers or two accounts).
2. Play until **you** have no legal plays and boneyard has tiles (or lock boneyard to ≤2 if testing pass-only).
3. Let the client auto-draw or manually draw until server triggers a **forced draw chain** (`forcedDrawCount > 0` on state update).
4. As soon as the draw animation completes and it is **your turn with legal plays**, select a tile and click a placement zone **once**. If the bug occurs, click 2–3 times.
5. Capture **all** `[TEMP-DIAGNOSTIC]` lines from ~5 seconds before the first click through successful placement (or 10s after last click).

**What confirms the hypothesis:**

- `play() blocked` with `reason: 'drawSequenceActive'` and `conditionAgeMs` **greater than** `latencyMs` from the matched state/animation pair (blocked window extends past animation arrival).
- OR `play() blocked` with `reason: 'flyingTiles'` while `flyingTiles transitioned to empty` has not yet fired.
- OR `game:draw_animation never arrived` warning while `drawSequenceActive` stayed true and blocked clicks.

**Expected timer math (if animation runs):**  
`chainDurationMs = stepCount * 500 + 1800`. Example: 3 steps → 3300ms from animation handler start until `drawSequenceActive set false`.

### Scenario B — opponent forced draw while it is your turn

1. Reach a position where **opponent** force-draws (or you pass into their forced draw).
2. When it becomes **your turn**, attempt a placement immediately.
3. Capture logs as in Scenario A.

Look for `source: 'state:opponent_forced'` state events and whether your `play()` blocks while opponent animation runs.

### Scenario C — normal play (control)

1. Mid-game, play a tile on your turn with **no** forced draw in the preceding state update.
2. Confirm **no** `play() blocked` logs on first click.
3. Paste a short log snippet showing clean placement.

### What to paste back

Copy the filtered console output as plain text. Include:

- Match context (private/ranked, browser, approximate turn/hand).
- Whether bug reproduced (clicks required: 1 / 2 / 3+).
- Full `[TEMP-DIAGNOSTIC]` sequence for one failed-then-succeeded placement attempt.

Optional: also capture existing `[draw-audit]` lines if present — they complement but are not required.

---

## Hypothesis checklist (for investigator)

| # | Prediction | Log evidence |
|---|------------|--------------|
| 1 | `drawSequenceActive` true on state update before animation | `drawSequenceActive set true (forced-draw state event)` timestamp **<** `game:draw_animation arrived` |
| 2 | Block window can exceed animation latency | `play() blocked` + `reason: drawSequenceActive` + `conditionAgeMs` large while animation already arrived |
| 3 | Clear only via animation timer (normal path) | `drawSequenceActive set false` with `path: game:draw_animation:timer_chain_complete` |
| 4 | Missing animation leaves flag stuck | `game:draw_animation never arrived` warning + repeated blocked `play()` |
| 5 | `flyingTiles` contributes silent no-op | `play() blocked` + `reason: flyingTiles` before `flyingTiles transitioned to empty` |

---

## Build verification

```
cd client && npm run build  → pass (post-instrumentation)
```

---

## Cleanup follow-up (after investigation)

1. `rg 'TEMP-DIAGNOSTIC' client/src` — remove all matches.
2. Remove `diagnoseGameplayBlockReason` / `blockConditionAgeMs` / diagnostic refs if no longer needed.
3. Remove `recordForcedDrawStateEvent` / `recordForcedDrawAnimationArrival` helpers from `useRoomSocketSync.ts`.
4. Restore direct `pendingActionRef.current =` assignments in `useLiveMatchActions.ts`.

---

*Instrumentation pass complete. Awaiting live/staged console captures.*

---

## Follow-up: coverage gaps closed

**Date:** 2026-07-05  
**Scope:** Diagnostic-only — closes three pre-collection gaps. No behavior changes.

---

### PART 1 — Two additional `drawSequenceActive` clear paths instrumented

All `drawSequenceActive` clear sites are now path-tagged. Complete inventory:

| `path` value | File | Trigger |
|--------------|------|---------|
| `clearDrawPreview` | `useRoomSocketSync.ts` | No forced-draw on state update |
| `game:draw_animation:timer_chain_complete` | `useRoomSocketSync.ts` | Animation timer chain finished |
| `useTransientRoomUi:clearTransientRoomUi` | `useTransientRoomUi.ts` | Room/session UI reset |
| `MultiplayerGameShell:stateNullEffect` | `MultiplayerGameShell.tsx` | `state` becomes null |

#### New log lines

**`client/src/match/session/transientUi/useTransientRoomUi.ts` — before `setDrawSequenceActiveBoth(false)` in `clearTransientRoomUi`:**

```typescript
    // TEMP-DIAGNOSTIC
    console.log('[TEMP-DIAGNOSTIC] drawSequenceActive set false', {
      path: 'useTransientRoomUi:clearTransientRoomUi',
      at: Date.now(),
    });
```

**`client/src/multiplayer/MultiplayerGameShell.tsx` — before `setDrawSequenceActiveBoth(false)` in state-null `useEffect`:**

```typescript
    // TEMP-DIAGNOSTIC
    console.log('[TEMP-DIAGNOSTIC] drawSequenceActive set false', {
      path: 'MultiplayerGameShell:stateNullEffect',
      at: Date.now(),
    });
```

Pair these with `[TEMP-DIAGNOSTIC] drawSequenceActive observed transition` logs from `useLiveMatchActions.ts` to attribute every clear path during live capture.

---

### PART 2 — Full before/after source verification

#### `pendingActionRef` assignment audit (`useLiveMatchActions.ts`)

| Site | Before | After |
|------|--------|-------|
| `draw()` try-path start | `pendingActionRef.current = true` | `setPendingActionRefDiag(true)` |
| `draw()` `finally` | `pendingActionRef.current = false` | `setPendingActionRefDiag(false)` |
| `pass()` try-path start | `pendingActionRef.current = true` | `setPendingActionRefDiag(true)` |
| `pass()` `finally` | `pendingActionRef.current = false` | `setPendingActionRefDiag(false)` |
| `play()` after sound | `pendingActionRef.current = true` | `setPendingActionRefDiag(true)` |
| `play()` `finally` | `pendingActionRef.current = false` | `setPendingActionRefDiag(false)` |
| `setPendingActionRefDiag` body | *(n/a)* | `pendingActionRef.current = value` (sole direct write in this file) |

**Intentional direct assignments outside this file (not routed through `setPendingActionRefDiag`):**

- `client/src/match/session/transientUi/useTransientRoomUi.ts` → `clearTransientRoomUi()` line `pendingActionRef.current = false` — clears pending flag on room teardown; does **not** reset `pendingActionTrueSinceRef` in `useLiveMatchActions`. Diagnostic `conditionAgeMs` for `pendingActionRef` may be stale after a room clear. This is acceptable for investigation (room clear ends the session); note when interpreting logs.

**Reads only (no assignment) in `useLiveMatchActions.ts`:** `isGameplayActionBlocked`, `diagnoseGameplayBlockReason`, blocked-`play()` log snapshot, auto-turn `useEffect` guard.

---

#### BEFORE — `draw()` (pre-instrumentation)

```typescript
  const draw = useCallback(async () => {
    setActionError('');
    const stateNow = stateRef.current;
    const legalMovesNow = legalMovesRef.current;
    const boneyardLockedNow = (stateNow?.boneyard.length ?? 0) <= 2;
    if (!socket || !joinedRoom || boneyardLockedNow || !canDraw || isGameplayActionBlocked()) {
      return;
    }
    emitDraggingState(false);
    const baselineSequence = stateNow?.sequence ?? -1;
    pendingGameplayActionRef.current = { kind: 'draw', baselineSequence };
    mpPerfBeginAction('draw', baselineSequence);
    setPendingUiAction('draw');
    pendingActionRef.current = true;
    const boardEnds = getBoardEnds(stateNow?.board ?? null);
    const handBefore = (stateNow?.players[you]?.hand ?? []).map(toTileTuple);
    const validMoves = legalMovesNow
      .filter((m) => m.type === 'play' && m.tile)
      .map((m) => toTileTuple(m.tile as Tile));
    const requestId = nextDrawRequestId();
    const emitAt = Date.now();
    drawAudit('forced-state-detected', {
      roomCode: joinedRoom,
      playerId: you,
      handCount: handBefore.length,
      boneyardCount: stateNow?.boneyard.length ?? 0,
      legalMoveCount: validMoves.length,
      canDraw,
      canPass: legalMovesNow.some((m) => m.type === 'pass'),
      reason: 'no_legal_play_drawable_boneyard',
    });
    drawAudit('emit', { event: 'game:action', actionType: 'DRAW', roomCode: joinedRoom, requestId });
    try {
      const resp = await emitGameAction(socket, joinedRoom, { type: 'DRAW', requestId });
      mpPerfMarkAck(Boolean(resp?.ok), resp?.sequence);
      drawAudit('ack', {
        requestId,
        ms: Date.now() - emitAt,
        ok: Boolean(resp?.ok),
        forcedDraw: resp?.forcedDraw?.drewCount ?? 0,
        drawnCount: resp?.forcedDraw?.drewCount,
        error: resp?.error,
      });
      if (!resp?.ok) {
        setActionError(resp?.error ?? 'Unable to draw.');
        return;
      }
      if (joinedRoom && typeof resp.sequence === 'number' && Number.isFinite(resp.sequence)) {
        mpAutoDrawSuppressUntilSequenceRef.current = resp.sequence;
        autoTurnActionKeyRef.current = '';
      }
      appendMultiplayerMove({
        player: 'you',
        action: 'draw',
        boardEnds,
        handBefore,
        validMoves,
        pipDelta: 0,
        pointsScored: 0,
        boardState: snapshotBoardState(stateNow?.board ?? null),
        boardRenderState: cloneBoardState(stateNow?.board ?? null),
        handSnapshot: handBefore,
        engineBestMove: pickEngineBestMove(
          legalMovesNow
            .filter((m) => m.type === 'play' && m.tile)
            .map((m) => ({ tile: toTileTuple(m.tile as Tile), position: m.position })),
          boardEnds,
          handBefore,
        ),
      });
    } catch (e) {
      mpPerfMarkAck(false);
      showToast(e instanceof Error ? e.message : 'Action failed', 2000);
    } finally {
      setPendingUiAction((prev) => (prev === 'draw' ? null : prev));
      pendingActionRef.current = false;
      pendingGameplayActionRef.current = null;
    }
  }, [
    socket,
    joinedRoom,
    you,
    canDraw,
    appendMultiplayerMove,
    emitDraggingState,
    showToast,
    isGameplayActionBlocked,
    stateRef,
    legalMovesRef,
    pendingGameplayActionRef,
    pendingActionRef,
    mpAutoDrawSuppressUntilSequenceRef,
    autoTurnActionKeyRef,
    setActionError,
    setPendingUiAction,
  ]);
```

#### AFTER — `draw()` (current)

```typescript
  const draw = useCallback(async () => {
    setActionError('');
    const stateNow = stateRef.current;
    const legalMovesNow = legalMovesRef.current;
    const boneyardLockedNow = (stateNow?.boneyard.length ?? 0) <= 2;
    if (!socket || !joinedRoom || boneyardLockedNow || !canDraw || isGameplayActionBlocked()) {
      return;
    }
    emitDraggingState(false);
    const baselineSequence = stateNow?.sequence ?? -1;
    pendingGameplayActionRef.current = { kind: 'draw', baselineSequence };
    mpPerfBeginAction('draw', baselineSequence);
    setPendingUiAction('draw');
    setPendingActionRefDiag(true);
    const boardEnds = getBoardEnds(stateNow?.board ?? null);
    const handBefore = (stateNow?.players[you]?.hand ?? []).map(toTileTuple);
    const validMoves = legalMovesNow
      .filter((m) => m.type === 'play' && m.tile)
      .map((m) => toTileTuple(m.tile as Tile));
    const requestId = nextDrawRequestId();
    const emitAt = Date.now();
    drawAudit('forced-state-detected', {
      roomCode: joinedRoom,
      playerId: you,
      handCount: handBefore.length,
      boneyardCount: stateNow?.boneyard.length ?? 0,
      legalMoveCount: validMoves.length,
      canDraw,
      canPass: legalMovesNow.some((m) => m.type === 'pass'),
      reason: 'no_legal_play_drawable_boneyard',
    });
    drawAudit('emit', { event: 'game:action', actionType: 'DRAW', roomCode: joinedRoom, requestId });
    try {
      const resp = await emitGameAction(socket, joinedRoom, { type: 'DRAW', requestId });
      mpPerfMarkAck(Boolean(resp?.ok), resp?.sequence);
      drawAudit('ack', {
        requestId,
        ms: Date.now() - emitAt,
        ok: Boolean(resp?.ok),
        forcedDraw: resp?.forcedDraw?.drewCount ?? 0,
        drawnCount: resp?.forcedDraw?.drewCount,
        error: resp?.error,
      });
      if (!resp?.ok) {
        setActionError(resp?.error ?? 'Unable to draw.');
        return;
      }
      if (joinedRoom && typeof resp.sequence === 'number' && Number.isFinite(resp.sequence)) {
        mpAutoDrawSuppressUntilSequenceRef.current = resp.sequence;
        autoTurnActionKeyRef.current = '';
      }
      appendMultiplayerMove({
        player: 'you',
        action: 'draw',
        boardEnds,
        handBefore,
        validMoves,
        pipDelta: 0,
        pointsScored: 0,
        boardState: snapshotBoardState(stateNow?.board ?? null),
        boardRenderState: cloneBoardState(stateNow?.board ?? null),
        handSnapshot: handBefore,
        engineBestMove: pickEngineBestMove(
          legalMovesNow
            .filter((m) => m.type === 'play' && m.tile)
            .map((m) => ({ tile: toTileTuple(m.tile as Tile), position: m.position })),
          boardEnds,
          handBefore,
        ),
      });
    } catch (e) {
      mpPerfMarkAck(false);
      showToast(e instanceof Error ? e.message : 'Action failed', 2000);
    } finally {
      setPendingUiAction((prev) => (prev === 'draw' ? null : prev));
      setPendingActionRefDiag(false);
      pendingGameplayActionRef.current = null;
    }
  }, [
    socket,
    joinedRoom,
    you,
    canDraw,
    appendMultiplayerMove,
    emitDraggingState,
    showToast,
    isGameplayActionBlocked,
    stateRef,
    legalMovesRef,
    pendingGameplayActionRef,
    setPendingActionRefDiag,
    mpAutoDrawSuppressUntilSequenceRef,
    autoTurnActionKeyRef,
    setActionError,
    setPendingUiAction,
  ]);
```

---

#### BEFORE — `pass()` (pre-instrumentation)

```typescript
  const pass = useCallback(async () => {
    setActionError('');
    const stateNow = stateRef.current;
    const legalMovesNow = legalMovesRef.current;
    const hasPassMove = legalMovesNow.some((m) => m.type === 'pass');
    if (!socket || !joinedRoom || !hasPassMove || isGameplayActionBlocked()) return;
    emitDraggingState(false);
    const baselineSequence = stateNow?.sequence ?? -1;
    pendingGameplayActionRef.current = { kind: 'pass', baselineSequence };
    mpPerfBeginAction('pass', baselineSequence);
    setPendingUiAction('pass');
    pendingActionRef.current = true;
    const boardEnds = getBoardEnds(stateNow?.board ?? null);
    const handBefore = (stateNow?.players[you]?.hand ?? []).map(toTileTuple);
    const validMoves = legalMovesNow
      .filter((m) => m.type === 'play' && m.tile)
      .map((m) => toTileTuple(m.tile as Tile));
    try {
      const resp = await emitGameAction(socket, joinedRoom, { type: 'PASS' });
      mpPerfMarkAck(Boolean(resp?.ok), resp?.sequence);
      if (!resp?.ok) {
        setActionError(resp?.error ?? 'Unable to pass.');
        return;
      }
      appendMultiplayerMove({
        player: 'you',
        action: 'pass',
        boardEnds,
        handBefore,
        validMoves,
        pipDelta: 0,
        pointsScored: 0,
        boardState: snapshotBoardState(stateNow?.board ?? null),
        boardRenderState: cloneBoardState(stateNow?.board ?? null),
        handSnapshot: handBefore,
        engineBestMove: pickEngineBestMove(
          legalMovesNow
            .filter((m) => m.type === 'play' && m.tile)
            .map((m) => ({ tile: toTileTuple(m.tile as Tile), position: m.position })),
          boardEnds,
          handBefore,
        ),
      });
    } catch (e) {
      mpPerfMarkAck(false);
      showToast(e instanceof Error ? e.message : 'Action failed', 2000);
    } finally {
      setPendingUiAction((prev) => (prev === 'pass' ? null : prev));
      pendingActionRef.current = false;
      pendingGameplayActionRef.current = null;
    }
  }, [
    socket,
    joinedRoom,
    you,
    appendMultiplayerMove,
    emitDraggingState,
    showToast,
    isGameplayActionBlocked,
    stateRef,
    legalMovesRef,
    pendingGameplayActionRef,
    pendingActionRef,
    setActionError,
    setPendingUiAction,
  ]);
```

#### AFTER — `pass()` (current)

```typescript
  const pass = useCallback(async () => {
    setActionError('');
    const stateNow = stateRef.current;
    const legalMovesNow = legalMovesRef.current;
    const hasPassMove = legalMovesNow.some((m) => m.type === 'pass');
    if (!socket || !joinedRoom || !hasPassMove || isGameplayActionBlocked()) return;
    emitDraggingState(false);
    const baselineSequence = stateNow?.sequence ?? -1;
    pendingGameplayActionRef.current = { kind: 'pass', baselineSequence };
    mpPerfBeginAction('pass', baselineSequence);
    setPendingUiAction('pass');
    setPendingActionRefDiag(true);
    const boardEnds = getBoardEnds(stateNow?.board ?? null);
    const handBefore = (stateNow?.players[you]?.hand ?? []).map(toTileTuple);
    const validMoves = legalMovesNow
      .filter((m) => m.type === 'play' && m.tile)
      .map((m) => toTileTuple(m.tile as Tile));
    try {
      const resp = await emitGameAction(socket, joinedRoom, { type: 'PASS' });
      mpPerfMarkAck(Boolean(resp?.ok), resp?.sequence);
      if (!resp?.ok) {
        setActionError(resp?.error ?? 'Unable to pass.');
        return;
      }
      appendMultiplayerMove({
        player: 'you',
        action: 'pass',
        boardEnds,
        handBefore,
        validMoves,
        pipDelta: 0,
        pointsScored: 0,
        boardState: snapshotBoardState(stateNow?.board ?? null),
        boardRenderState: cloneBoardState(stateNow?.board ?? null),
        handSnapshot: handBefore,
        engineBestMove: pickEngineBestMove(
          legalMovesNow
            .filter((m) => m.type === 'play' && m.tile)
            .map((m) => ({ tile: toTileTuple(m.tile as Tile), position: m.position })),
          boardEnds,
          handBefore,
        ),
      });
    } catch (e) {
      mpPerfMarkAck(false);
      showToast(e instanceof Error ? e.message : 'Action failed', 2000);
    } finally {
      setPendingUiAction((prev) => (prev === 'pass' ? null : prev));
      setPendingActionRefDiag(false);
      pendingGameplayActionRef.current = null;
    }
  }, [
    socket,
    joinedRoom,
    you,
    appendMultiplayerMove,
    emitDraggingState,
    showToast,
    isGameplayActionBlocked,
    stateRef,
    legalMovesRef,
    pendingGameplayActionRef,
    setPendingActionRefDiag,
    setActionError,
    setPendingUiAction,
  ]);
```

---

#### BEFORE — `play()` (pre-instrumentation)

```typescript
  const play = useCallback(
    async (position: PlacementPosition) => {
      setActionError('');
      const stateNow = stateRef.current;
      const legalMovesNow = legalMovesRef.current;
      const selected = selectedTileRef.current;
      if (!socket || !joinedRoom || !selected) return;

      if (isGameplayActionBlocked()) return;

      const tileToPlay = selected;
      const selectedMove = legalMovesNow.find(
        (m) =>
          m.type === 'play' &&
          m.tile &&
          m.position === position &&
          tileEquals(m.tile, tileToPlay),
      );
      if (!selectedMove) {
        emitDraggingState(false);
        setSelectedTile(null);
        setActionError('That tile cannot be played there.');
        return;
      }
      emitDraggingState(false);
      const baselineSequence = stateNow?.sequence ?? -1;
      pendingGameplayActionRef.current = { kind: 'play', baselineSequence };
      mpPerfBeginAction('play', baselineSequence);
      setPendingUiAction('play');
      playTileSound('standard', isMutedRef.current);
      pendingActionRef.current = true;
      setSelectedTile(null);
      setDrawStepMyHand(null);
      const boardEnds = getBoardEnds(stateNow?.board ?? null);
      const handBefore = (stateNow?.players[you]?.hand ?? []).map(toTileTuple);
      const validMoves = legalMovesNow
        .filter((m) => m.type === 'play' && m.tile)
        .map((m) => toTileTuple(m.tile as Tile));
      const playedTile = toTileTuple(tileToPlay);

      try {
        const resp = await emitGameAction(socket, joinedRoom, {
          type: 'MOVE',
          move: { tile: tileToPlay, position },
        });

        mpPerfMarkAck(Boolean(resp?.ok), resp?.sequence);
        if (!resp?.ok) {
          setActionError(resp?.error ?? 'Unable to play tile.');
          return;
        }
        if (joinedRoom && typeof resp.sequence === 'number' && Number.isFinite(resp.sequence)) {
          mpAutoDrawSuppressUntilSequenceRef.current = resp.sequence;
          autoTurnActionKeyRef.current = '';
        }
        flashLastPlayed(selectedMove?.tile ?? tileToPlay);
        appendMultiplayerMove({
          player: 'you',
          action: 'place',
          tile: playedTile,
          boardEnds,
          handBefore,
          validMoves,
          pipDelta: -(playedTile[0] + playedTile[1]),
          pointsScored: (() => {
            const possibleEnds = nextEndsForTile(playedTile, boardEnds);
            for (const ends of possibleEnds) {
              const s = ends[0] + ends[1];
              if (s > 0 && s % 5 === 0) return s / 5;
            }
            return 0;
          })(),
          boardState: snapshotBoardState(stateNow?.board ?? null),
          boardRenderState: cloneBoardState(stateNow?.board ?? null),
          handSnapshot: handBefore,
          engineBestMove: pickEngineBestMove(
            legalMovesNow
              .filter((m) => m.type === 'play' && m.tile)
              .map((m) => ({ tile: toTileTuple(m.tile as Tile), position: m.position })),
            boardEnds,
            handBefore,
          ),
        });
      } catch (e) {
        mpPerfMarkAck(false);
        showToast(e instanceof Error ? e.message : 'Action failed', 2000);
      } finally {
        setPendingUiAction((prev) => (prev === 'play' ? null : prev));
        pendingActionRef.current = false;
        pendingGameplayActionRef.current = null;
      }
    },
    [
      socket,
      joinedRoom,
      you,
      appendMultiplayerMove,
      emitDraggingState,
      showToast,
      flashLastPlayed,
      isGameplayActionBlocked,
      stateRef,
      legalMovesRef,
      selectedTileRef,
      pendingGameplayActionRef,
      pendingActionRef,
      mpAutoDrawSuppressUntilSequenceRef,
      autoTurnActionKeyRef,
      isMutedRef,
      setActionError,
      setPendingUiAction,
      setSelectedTile,
      setDrawStepMyHand,
    ],
  );
```

#### AFTER — `play()` (current)

```typescript
  const play = useCallback(
    async (position: PlacementPosition) => {
      setActionError('');
      const stateNow = stateRef.current;
      const legalMovesNow = legalMovesRef.current;
      const selected = selectedTileRef.current;
      if (!socket || !joinedRoom || !selected) return;

      if (isGameplayActionBlocked()) {
        const blockReason = diagnoseGameplayBlockReason();
        if (blockReason) {
          // TEMP-DIAGNOSTIC
          console.log('[TEMP-DIAGNOSTIC] play() blocked by isGameplayActionBlocked', {
            reason: blockReason,
            conditionAgeMs: blockConditionAgeMs(blockReason),
            at: Date.now(),
            position,
            selectedTile: selected ? `${selected.low}-${selected.high}` : null,
            stateSequence: stateNow?.sequence ?? null,
            drawSequenceActive,
            flyingTilesCount: flyingTiles.length,
            pendingActionRef: pendingActionRef.current,
            pendingUiAction,
            roomRecoveryState,
            socketConnected: socket?.connected ?? false,
            isRecoveringConnection,
            rejoinInFlight: rejoinInFlightRef.current,
          });
        }
        return;
      }

      const tileToPlay = selected;
      const selectedMove = legalMovesNow.find(
        (m) =>
          m.type === 'play' &&
          m.tile &&
          m.position === position &&
          tileEquals(m.tile, tileToPlay),
      );
      if (!selectedMove) {
        emitDraggingState(false);
        setSelectedTile(null);
        setActionError('That tile cannot be played there.');
        return;
      }
      emitDraggingState(false);
      const baselineSequence = stateNow?.sequence ?? -1;
      pendingGameplayActionRef.current = { kind: 'play', baselineSequence };
      mpPerfBeginAction('play', baselineSequence);
      setPendingUiAction('play');
      playTileSound('standard', isMutedRef.current);
      setPendingActionRefDiag(true);
      setSelectedTile(null);
      setDrawStepMyHand(null);
      const boardEnds = getBoardEnds(stateNow?.board ?? null);
      const handBefore = (stateNow?.players[you]?.hand ?? []).map(toTileTuple);
      const validMoves = legalMovesNow
        .filter((m) => m.type === 'play' && m.tile)
        .map((m) => toTileTuple(m.tile as Tile));
      const playedTile = toTileTuple(tileToPlay);

      try {
        const resp = await emitGameAction(socket, joinedRoom, {
          type: 'MOVE',
          move: { tile: tileToPlay, position },
        });

        mpPerfMarkAck(Boolean(resp?.ok), resp?.sequence);
        if (!resp?.ok) {
          setActionError(resp?.error ?? 'Unable to play tile.');
          return;
        }
        if (joinedRoom && typeof resp.sequence === 'number' && Number.isFinite(resp.sequence)) {
          mpAutoDrawSuppressUntilSequenceRef.current = resp.sequence;
          autoTurnActionKeyRef.current = '';
        }
        flashLastPlayed(selectedMove?.tile ?? tileToPlay);
        appendMultiplayerMove({
          player: 'you',
          action: 'place',
          tile: playedTile,
          boardEnds,
          handBefore,
          validMoves,
          pipDelta: -(playedTile[0] + playedTile[1]),
          pointsScored: (() => {
            const possibleEnds = nextEndsForTile(playedTile, boardEnds);
            for (const ends of possibleEnds) {
              const s = ends[0] + ends[1];
              if (s > 0 && s % 5 === 0) return s / 5;
            }
            return 0;
          })(),
          boardState: snapshotBoardState(stateNow?.board ?? null),
          boardRenderState: cloneBoardState(stateNow?.board ?? null),
          handSnapshot: handBefore,
          engineBestMove: pickEngineBestMove(
            legalMovesNow
              .filter((m) => m.type === 'play' && m.tile)
              .map((m) => ({ tile: toTileTuple(m.tile as Tile), position: m.position })),
            boardEnds,
            handBefore,
          ),
        });
      } catch (e) {
        mpPerfMarkAck(false);
        showToast(e instanceof Error ? e.message : 'Action failed', 2000);
      } finally {
        setPendingUiAction((prev) => (prev === 'play' ? null : prev));
        setPendingActionRefDiag(false);
        pendingGameplayActionRef.current = null;
      }
    },
    [
      socket,
      joinedRoom,
      you,
      appendMultiplayerMove,
      emitDraggingState,
      showToast,
      flashLastPlayed,
      isGameplayActionBlocked,
      diagnoseGameplayBlockReason,
      blockConditionAgeMs,
      drawSequenceActive,
      flyingTiles,
      pendingUiAction,
      roomRecoveryState,
      isRecoveringConnection,
      rejoinInFlightRef,
      stateRef,
      legalMovesRef,
      selectedTileRef,
      pendingGameplayActionRef,
      setPendingActionRefDiag,
      pendingActionRef,
      mpAutoDrawSuppressUntilSequenceRef,
      autoTurnActionKeyRef,
      isMutedRef,
      setActionError,
      setPendingUiAction,
      setSelectedTile,
      setDrawStepMyHand,
    ],
  );
```

---

#### BEFORE — transition observers (did not exist)

*(No `drawSequenceActive` or `flyingTiles` transition `useEffect` hooks in pre-instrumentation `useLiveMatchActions.ts`.)*

#### AFTER — `drawSequenceActive` transition observer (full)

```typescript
  useEffect(() => {
    const now = Date.now();
    const prev = prevDrawSequenceActiveRef.current;
    if (prev !== drawSequenceActive) {
      // TEMP-DIAGNOSTIC: correlate with useRoomSocketSync path-tagged logs for clear-path attribution.
      console.log('[TEMP-DIAGNOSTIC] drawSequenceActive observed transition', {
        from: prev,
        to: drawSequenceActive,
        at: now,
      });
      prevDrawSequenceActiveRef.current = drawSequenceActive;
    }
  }, [drawSequenceActive]);
```

#### AFTER — `flyingTiles` transition observer (full)

```typescript
  useEffect(() => {
    const now = Date.now();
    const prevCount = prevFlyingTilesCountRef.current;
    const nextCount = flyingTiles.length;
    if (nextCount > 0) {
      if (flyingTilesNonEmptySinceRef.current === null) {
        flyingTilesNonEmptySinceRef.current = now;
      }
    } else if (prevCount > 0) {
      // TEMP-DIAGNOSTIC
      console.log('[TEMP-DIAGNOSTIC] flyingTiles transitioned to empty', {
        at: now,
        wasNonEmptyForMs:
          flyingTilesNonEmptySinceRef.current === null
            ? null
            : now - flyingTilesNonEmptySinceRef.current,
        previousCount: prevCount,
      });
      flyingTilesNonEmptySinceRef.current = null;
    }
    prevFlyingTilesCountRef.current = nextCount;
  }, [flyingTiles]);
```

---

### PART 3 — `forcedDrawPendingDiags` isolation verification

#### Command

```bash
rg 'forcedDrawPendingDiags' client/src
```

#### Output

```
client/src/multiplayer/useRoomSocketSync.ts
  647:    const forcedDrawPendingDiags: ForcedDrawPendingDiag[] = [];
  667:      forcedDrawPendingDiags.push(entry);
  680:        const pending = forcedDrawPendingDiags.find(
  703:      const pending = [...forcedDrawPendingDiags]
```

#### Full declaration (inside `useRoomSocketSync` socket-registration `useEffect`)

```typescript
    type ForcedDrawPendingDiag = {
      diagId: number;
      stateEventAt: number;
      source: 'state:self_forced' | 'state:opponent_forced';
      sequence: number;
      actorId: string;
      forcedDrawCount: number;
      animationArrived: boolean;
      animationArrivedAt: number | null;
    };
    let forcedDrawDiagIdCounter = 0;
    const forcedDrawPendingDiags: ForcedDrawPendingDiag[] = [];
```

#### Read/write site analysis

| Line | Operation | Purpose |
|------|-----------|---------|
| 647 | **declare** | Empty array scoped to socket effect closure |
| 667 | **write** (`push`) | `recordForcedDrawStateEvent` — append pending state-event record |
| 680 | **read** (`find`) | 30s diagnostic watchdog — log if animation never arrived |
| 703 | **read** (`[...].reverse().find`) | `recordForcedDrawAnimationArrival` — match animation to state event, compute `latencyMs` |
| 712–713 | **write** (mutate `pending.animationArrived`, `animationArrivedAt`) | Diagnostic correlation only — fields are never read by gameplay code |

**Verdict:** **Confirmed isolated.** `forcedDrawPendingDiags` exists only inside the `useRoomSocketSync` socket-registration `useEffect` closure. All reads and writes serve diagnostic logging/correlation (`console.log` / `console.warn`). No gameplay logic (state projection, `setDrawSequenceActiveBoth`, `setFlyingTiles`, action blocking, recovery) branches on this array.

**Lifecycle note:** Array is re-created when the socket effect re-runs (socket/params change). Pending diags from a prior socket session are discarded — acceptable for per-match investigation.

---

### Follow-up build verification

```
cd client && npm run build  → pass (post follow-up instrumentation)
```

---

*Coverage gaps closed. Ready for live/staged console capture.*

---

## Block-reason helpers — full source and order verification

`diagnoseGameplayBlockReason` and `blockConditionAgeMs` exist solely to label blocked `play()` clicks for `TEMP-DIAGNOSTIC` logs. They do **not** gate actions themselves — `isGameplayActionBlocked()` remains the sole blocker.

### Full source — `diagnoseGameplayBlockReason`

```typescript
  const diagnoseGameplayBlockReason = useCallback((): GameplayBlockReason | null => {
    if (!socket || !joinedRoom || !state || !you) return 'missing_context';
    if (
      !socket.connected ||
      roomRecoveryState !== 'idle' ||
      isRecoveringConnection ||
      rejoinInFlightRef.current
    ) {
      return 'connection';
    }
    if (pendingActionRef.current) return 'pendingActionRef';
    if (drawSequenceActive) return 'drawSequenceActive';
    if (flyingTiles.length > 0) return 'flyingTiles';
    if (pendingUiAction === 'draw' || pendingUiAction === 'pass' || pendingUiAction === 'play') {
      return 'pendingUiAction';
    }
    if (state.handOver || state.gameOver) return 'handOver';
    if (!state.playerIds.includes(you)) return 'not_in_game';
    if (state.playerIds[state.currentPlayerIndex] !== you) return 'not_your_turn';
    return null;
  }, [
    socket,
    joinedRoom,
    state,
    you,
    roomRecoveryState,
    isRecoveringConnection,
    rejoinInFlightRef,
    pendingUiAction,
    drawSequenceActive,
    flyingTiles,
    pendingActionRef,
  ]);
```

### Full source — `blockConditionAgeMs`

```typescript
  const blockConditionAgeMs = useCallback(
    (reason: GameplayBlockReason): number | null => {
      const now = Date.now();
      switch (reason) {
        case 'pendingActionRef':
          return pendingActionTrueSinceRef.current === null
            ? null
            : now - pendingActionTrueSinceRef.current;
        case 'drawSequenceActive':
          return drawSequenceActiveTrueSinceRef.current === null
            ? null
            : now - drawSequenceActiveTrueSinceRef.current;
        case 'flyingTiles':
          return flyingTilesNonEmptySinceRef.current === null
            ? null
            : now - flyingTilesNonEmptySinceRef.current;
        case 'pendingUiAction':
          return pendingUiActionTrueSinceRef.current === null
            ? null
            : now - pendingUiActionTrueSinceRef.current;
        case 'connection':
          return connectionBlockedTrueSinceRef.current === null
            ? null
            : now - connectionBlockedTrueSinceRef.current;
        default:
          return null;
      }
    },
    [],
  );
```

`blockConditionAgeMs` returns `null` for `missing_context`, `handOver`, `not_in_game`, and `not_your_turn` — those reasons have no timestamp ref.

### Full source — `isGameplayActionBlocked` (reference)

```typescript
  const isGameplayActionBlocked = useCallback(() => {
    if (!socket || !joinedRoom || !state || !you) return true;
    if (
      !socket.connected ||
      roomRecoveryState !== 'idle' ||
      isRecoveringConnection ||
      rejoinInFlightRef.current
    ) {
      showToast('Reconnecting...', 1200);
      return true;
    }
    if (pendingActionRef.current || drawSequenceActive || flyingTiles.length > 0) return true;
    if (pendingUiAction === 'draw' || pendingUiAction === 'pass' || pendingUiAction === 'play') {
      return true;
    }
    if (state.handOver || state.gameOver) return true;
    if (!state.playerIds.includes(you)) return true;
    return state.playerIds[state.currentPlayerIndex] !== you;
  }, [
    socket,
    joinedRoom,
    state,
    you,
    roomRecoveryState,
    isRecoveringConnection,
    rejoinInFlightRef,
    pendingUiAction,
    showToast,
    drawSequenceActive,
    flyingTiles,
    pendingActionRef,
  ]);
```

### Condition-check order comparison

| Step | `isGameplayActionBlocked()` | `diagnoseGameplayBlockReason()` | Match? |
|------|----------------------------|--------------------------------|--------|
| 1 | `!socket \|\| !joinedRoom \|\| !state \|\| !you` → blocked | same → `'missing_context'` | **Yes** |
| 2 | `!socket.connected \|\| roomRecoveryState !== 'idle' \|\| isRecoveringConnection \|\| rejoinInFlightRef.current` → blocked (+ toast) | same → `'connection'` | **Yes** |
| 3a | `pendingActionRef.current` (first operand of combined OR) | `pendingActionRef.current` → `'pendingActionRef'` | **Yes** |
| 3b | `drawSequenceActive` (second operand) | `drawSequenceActive` → `'drawSequenceActive'` | **Yes** |
| 3c | `flyingTiles.length > 0` (third operand) | `flyingTiles.length > 0` → `'flyingTiles'` | **Yes** |
| 4 | `pendingUiAction === 'draw' \|\| 'pass' \|\| 'play'` | same → `'pendingUiAction'` | **Yes** |
| 5 | `state.handOver \|\| state.gameOver` | same → `'handOver'` | **Yes** |
| 6 | `!state.playerIds.includes(you)` | same → `'not_in_game'` | **Yes** |
| 7 | `state.playerIds[state.currentPlayerIndex] !== you` | same → `'not_your_turn'` | **Yes** |

**Explicit confirmation:** The evaluation order is **identical**. Steps 3a–3c are written as one `if (a \|\| b \|\| c)` in `isGameplayActionBlocked` and as three sequential `if` statements in `diagnoseGameplayBlockReason`, but JavaScript short-circuit OR evaluates left-to-right with the same priority: **`pendingActionRef` → `drawSequenceActive` → `flyingTiles`**. When multiple of those three are true simultaneously, both functions agree on which condition is "first" for blocking purposes.

**No order differences anywhere else.**

### Behavioral difference (diagnostic only, not order)

- `isGameplayActionBlocked` shows `'Reconnecting...'` toast on step 2; `diagnoseGameplayBlockReason` does not (it only labels the reason).
- `play()` calls `isGameplayActionBlocked()` **first** (toast fires if connection-blocked), then calls `diagnoseGameplayBlockReason()` for the log. Block outcome is unchanged.

### `play()` call sequence (for log interpretation)

```typescript
      if (isGameplayActionBlocked()) {
        const blockReason = diagnoseGameplayBlockReason();
        if (blockReason) {
          console.log('[TEMP-DIAGNOSTIC] play() blocked by isGameplayActionBlocked', { ... });
        }
        return;
      }
```

Because `isGameplayActionBlocked()` already returned `true`, `diagnoseGameplayBlockReason()` will always return a non-null reason at that point (same predicate tree, inverted return). The logged `reason` matches the first failing step in the table above.