# Multiplayer / PvP Deep Audit Findings

## 1. Connection Lifecycle

### Disconnect Mid-Turn / Mid-Animation Recovery
*   **File/line**: [useTransientRoomUi.ts](file:///Users/olivermorid/racehorse-dominoes/client/src/match/session/transientUi/useTransientRoomUi.ts#L86) and [useLiveMatchSession.ts](file:///Users/olivermorid/racehorse-dominoes/client/src/match/session/useLiveMatchSession.ts#L247)
*   **Mechanism**: On socket disconnect or reconnect, `clearTransientRoomUi` is triggered. This clears all active draw animation loops, resets in-flight request flags, clears `flyingTiles` animations, and resets `drawSequenceActive`.
*   **Verdict**: SOLID (race-safe, has cleanup coverage).
*   **Evidence**:
    ```typescript
    const clearTransientRoomUi = useCallback(() => {
      setSelectedTile(null);
      setPendingUiAction(null);
      setActionError('');
      setOpponentDragging(false);
      draggingStateRef.current = false;
      pendingActionRef.current = false;
      pendingGameplayActionRef.current = null;
      mpPerfResetAction();
      setHandReveal(null);
      if (drawSequenceTimeoutRef.current) {
        clearTimeout(drawSequenceTimeoutRef.current);
        drawSequenceTimeoutRef.current = null;
      }
      setDrawSequenceActiveBoth(false);
      setDrawStepMyHand(null);
      setDrawStepActorId(null);
      setDrawStepOpponentHandCount(null);
      setPreGameDraw(null);
      setFlyingTiles([]);
    }, [...]);
    ```

### Authoritative State Rebuild on Reconnect
*   **File/line**: [useMultiplayerResync.ts](file:///Users/olivermorid/racehorse-dominoes/client/src/multiplayer/useMultiplayerResync.ts#L79-L140)
*   **Mechanism**: The reconnect flow does not play back stale cached state updates. Instead, `fetchGameState` performs a fresh `room:join` emit to the server, receives the full authoritative game state snapshot, and applies it to the UI via `applyJoinedRoomResponseRef.current(resp)`.
*   **Verdict**: SOLID (server-authoritative).
*   **Evidence**:
    ```typescript
    const resp = await emitRoomJoin(activeSocket, roomCode, identity);
    if (!resp?.ok) {
      recordResyncFailed(reason, { roomCode, error: resp?.error });
      logger.error('App.tsx', new Error('[mp] fetchGameState failed'), { reason, error: resp?.error });
      return false;
    }
    applyJoinedRoomResponseRef.current(resp);
    ```

### Disconnect Grace / Timeout-to-Forfeit Logic
*   **File/line**: [disconnectGrace.ts](file:///Users/olivermorid/racehorse-dominoes/server/src/multiplayer/disconnectGrace.ts#L51-L92) and [disconnectGrace.ts](file:///Users/olivermorid/racehorse-dominoes/server/src/multiplayer/disconnectGrace.ts#L131-L165)
*   **Mechanism**: If a player disconnects on their turn, the server starts a 30-second timer (`DISCONNECT_GRACE_MS`). If it expires, the server auto-acts (`PASS` or `DRAW`) and increments `room.disconnectExpiries`. On the second consecutive expiry (`currentCount >= 2`), the server auto-forfeits the match via `applyActiveMatchForfeit`.
*   **Verdict**: SOLID (handled authoritatively on the server).
*   **Evidence**:
    ```typescript
    if (currentCount >= 2) {
      const { getRoomRoster, getRoomPlayersWithFallback } = await import('./roomSession');
      const { applyActiveMatchForfeit } = await import('./roomForfeit');
      // ...
      await applyActiveMatchForfeit(io, mockSocket, code, abandoningPlayer);
      broadcast(code);
      return;
    }
    ```

### Opponent View of Connection Status
*   **File/line**: [useRoomSocketSync.ts](file:///Users/olivermorid/racehorse-dominoes/client/src/multiplayer/useRoomSocketSync.ts#L628-L649)
*   **Mechanism**: The opponent's client listens to `player:disconnected`, `player:reconnected`, and `player:reconnect_timeout` events, displaying a fixed status warning banner at the top of the game screen with the remaining grace period.
*   **Verdict**: SOLID.
*   **Evidence**:
    ```typescript
    const onPlayerDisconnected = wrapSocketHandler(
      'player:disconnected',
      (payload: { playerId?: string; graceMs?: number }) => {
        if (!payload?.playerId || payload.playerId === scope.dom.youRef.current) return;
        scope.ui.setOpponentDisconnected(true);
        const seconds = Math.max(1, Math.round((payload.graceMs ?? 30_000) / 1000));
        scope.ui.setOpponentDisconnectMessage(`Opponent disconnected. Waiting up to ${seconds}s…`);
        scope.ui.showToast('Opponent disconnected.', 2500);
      },
    );
    ```

---

## 2. Action Race Conditions

### Double-Submit and Rapid-Click Protection
*   **File/line**: [useLiveMatchActions.ts](file:///Users/olivermorid/racehorse-dominoes/client/src/match/session/actions/useLiveMatchActions.ts#L592-L614)
*   **Mechanism**: Action functions like `play()`, `draw()`, and `pass()` check `isGameplayActionBlocked()`. When an emit begins, `pendingActionRef.current` is set to `true`. If the user rapid double-clicks or triggers buttons while an request is in flight, the block prevents any secondary emits.
*   **Verdict**: SOLID.
*   **Evidence**:
    ```typescript
    if (isGameplayActionBlocked()) {
      const blockReason = diagnoseGameplayBlockReason();
      // ...
      return;
    }
    // ...
    setPendingActionRefDiag(true);
    ```

### Optimistic State Rollback / Reject Handling
*   **File/line**: [useLiveMatchActions.ts](file:///Users/olivermorid/racehorse-dominoes/client/src/match/session/actions/useLiveMatchActions.ts#L646-L696)
*   **Mechanism**: The client does not use optimistic client-side updates for board placements. The UI changes are only committed after the server-authoritative socket response/broadcast is received. If `resp.ok` is false, it clears the pending UI states and displays the error without needing to roll back any board state.
*   **Verdict**: SOLID (race-safe).
*   **Evidence**:
    ```typescript
    const resp = await emitGameAction(socket, joinedRoom, {
      type: 'MOVE',
      move: { tile: tileToPlay, position },
    });
    if (!resp?.ok) {
      setActionError(resp?.error ?? 'Unable to play tile.');
      return;
    }
    ```

---

## 3. Socket Event Ordering & Reliability

### Stuck `opponentDragging` Flag on Lost/Out-of-Order Events
*   **File/line**: [connectionGameplaySocketHandlers.ts](file:///Users/olivermorid/racehorse-dominoes/client/src/multiplayer/connectionGameplaySocketHandlers.ts#L75-L81) and [useLiveMatchViewModel.ts](file:///Users/olivermorid/racehorse-dominoes/client/src/match/session/viewModel/useLiveMatchViewModel.ts#L104)
*   **Mechanism**: When the opponent drags a tile, a `player:dragging` event triggers `opponentDragging = true`. If the opponent plays a tile or disconnects, the corresponding `dragging: false` event is either not sent or may be lost. The client has no safety reset on turn/state change, leaving the `opponentDragging` flag stuck at `true`, causing the open board ends to glow continuously on the local player's turn.
*   **Verdict**: BROKEN (reproduces a visual bug where the board open ends glow permanently when it becomes your turn).
*   **Evidence**:
    ```typescript
    export function applyPlayerDraggingSocketEvent(
      scope: MultiplayerConnectionScope,
      payload: { playerId?: string; dragging?: boolean },
    ): void {
      if (!payload?.playerId || payload.playerId === scope.room.youRef.current) return;
      scope.ui.setOpponentDragging(Boolean(payload.dragging));
    }
    ```

### Draw Sequence Timer Sequence Cleanup
*   **File/line**: [useRoomSocketSync.ts](file:///Users/olivermorid/racehorse-dominoes/client/src/multiplayer/useRoomSocketSync.ts#L668-L679)
*   **Mechanism**: Staggered step timers for forced draw animations are pushed to `drawAnimationStepTimers`. On sync component unmount or transition reset, the cleanup function clears all scheduled timeout handles in the list to prevent lingering flags.
*   **Verdict**: SOLID.
*   **Evidence**:
    ```typescript
    return () => {
      scope.recovery.resyncFlushRef.current = null;
      unregisterNormalized();
      for (const unregister of unregisterRaw) {
        unregister();
      }
      clearPendingDrawAnimationTimers();
      if (scope.dom.drawSequenceTimeoutRef.current) {
        clearTimeout(scope.dom.drawSequenceTimeoutRef.current);
        scope.dom.drawSequenceTimeoutRef.current = null;
      }
    };
    ```

---

## 4. Client-side Guessing vs. Server-Authoritative State

### Fragile Pass Detection Heuristic in multiplayer Match Log
*   **File/line**: [MultiplayerGameShell.tsx](file:///Users/olivermorid/racehorse-dominoes/client/src/multiplayer/MultiplayerGameShell.tsx#L541-L546)
*   **Mechanism**: Similar to the pass-toast bug we just resolved, the multiplayer match history logger infers an opponent "pass" using the heuristic `state.currentPlayerIndex !== prev.currentPlayerIndex && prevHandLen === nextHandLen`. If the opponent plays a double or non-scoring branch tile and the hand size is identical (or temporarily out of sync), the log will record a false "pass" event.
*   **Verdict**: RISKY (fragile heuristic — should use the server-authoritative `recentAutoPasses` list).
*   **Evidence**:
    ```typescript
    } else if (
      state.currentPlayerIndex !== prev.currentPlayerIndex &&
      prevHandLen === nextHandLen
    ) {
      action = 'pass';
    }
    ```

---

## 5. Game-Ending & Edge-State Handling

### Forfeit Engine Updates
*   **File/line**: [roomForfeit.ts](file:///Users/olivermorid/racehorse-dominoes/server/src/multiplayer/roomForfeit.ts#L24-L54)
*   **Mechanism**: Marking a match as forfeited updates the room properties (`abandonedAt`, `abandonedByUserId`, `abandonedReason = 'forfeit'`), computes the winner, calls `recordMatchEnd` for matchmaking or `applyMatchResult` for tournament brackets, and emits `room:match_abandoned`.
*   **Verdict**: SOLID.
*   **Evidence**:
    ```typescript
    const nowIso = new Date().toISOString();
    room.abandonedAt = nowIso;
    room.abandonedByUserId = authenticatedUserId;
    room.abandonedReason = 'forfeit';
    ```

### Abandonment Event Routing for Private/Matchmaking Games
*   **File/line**: [registerTournamentSocketHandlers.ts](file:///Users/olivermorid/racehorse-dominoes/client/src/tournament/registerTournamentSocketHandlers.ts#L110-L126) and [useTournamentSessionSockets.ts](file:///Users/olivermorid/racehorse-dominoes/client/src/match/session/tournament/useTournamentSessionSockets.ts#L103-L143)
*   **Mechanism**: The `room:match_abandoned` event is captured by the tournament socket router, which is always loaded. It correctly processes the abandon payload and routes it to `onPrivateMatchAbandoned` for standard matchmaking/private games, triggering the win-by-forfeit notice.
*   **Verdict**: SOLID (works, but placement is unintuitive since it is housed inside the tournament namespace).
*   **Evidence**:
    ```typescript
    setAppMode('multiplayer');
    onPrivateMatchAbandoned({
      context: 'multiplayer',
      title: 'Opponent left the game',
      detail:
        payload.message ??
        `${payload.abandonedUsername ?? 'Your opponent'} left the game. You win by forfeit.`,
    });
    ```

---

## 6. Interactive Element Failure Modes

### Silent Fails on Draw Button Click
*   **File/line**: [useLiveMatchActions.ts](file:///Users/olivermorid/racehorse-dominoes/client/src/match/session/actions/useLiveMatchActions.ts#L425-L427)
*   **Mechanism**: If the user clicks the Draw button when `boneyardLockedNow`, `!canDraw`, or `isGameplayActionBlocked()` is true, the handler returns immediately without showing any warning toast or changing the UI state.
*   **Verdict**: RISKY (fails silently if the user taps when blocked by invisible recovery states).
*   **Evidence**:
    ```typescript
    const boneyardLockedNow = (stateNow?.boneyard.length ?? 0) <= 2;
    if (!socket || !joinedRoom || boneyardLockedNow || !canDraw || isGameplayActionBlocked()) {
      return;
    }
    ```

### Silent Fails on Pass Button Click
*   **File/line**: [useLiveMatchActions.ts](file:///Users/olivermorid/racehorse-dominoes/client/src/match/session/actions/useLiveMatchActions.ts#L522)
*   **Mechanism**: If the user clicks the Pass button when `!hasPassMove` or `isGameplayActionBlocked()` is true, the handler returns immediately without showing any toast or warning feedback, giving no indicator to the user.
*   **Verdict**: RISKY (fails silently).
*   **Evidence**:
    ```typescript
    if (!socket || !joinedRoom || !hasPassMove || isGameplayActionBlocked()) return;
    ```

### Silent Fails on Rematch Request
*   **File/line**: [useLiveMatchActions.ts](file:///Users/olivermorid/racehorse-dominoes/client/src/match/session/actions/useLiveMatchActions.ts#L406)
*   **Mechanism**: If the user clicks the rematch button when `!state?.gameOver` or `rematchRequested` is true, the handler returns silently.
*   **Verdict**: RISKY (fails silently).
*   **Evidence**:
    ```typescript
    if (!socket || !joinedRoom || !state?.gameOver || rematchRequested) return;
    ```
