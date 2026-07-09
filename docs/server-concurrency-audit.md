# Server-Side Concurrency & Race-Condition Audit

An audit of the server-side multiplayer action mutation path was performed to analyze resilience against race conditions, simultaneous events, disconnect timer conflicts, and double submissions.

---

## 1. Concurrent Action Handling
*   **Verdict**: SOLID
*   **Mechanism**:
    Every mutation of the game state via `act()` or `readyForNextHand()` is serialized using a custom promise-chain mutex, `withRoomGameplayLock(roomCode, ...)` (defined in `roomGameplayLock.ts`). 
    Furthermore, the actual state mutation logic inside `actUnlocked()` is 100% synchronous and contains **zero `await` statements**. Control is never yielded to the V8 event loop during a read-modify-write cycle, preventing interleaved execution.
*   **Evidence** ([roomGameplayLock.ts](file:///Users/olivermorid/racehorse-dominoes/server/src/multiplayer/roomGameplayLock.ts#L9-L32)):
    ```typescript
    export async function withRoomGameplayLock<T>(
      roomCode: string,
      work: () => Promise<T>,
    ): Promise<T> {
      const code = roomCode.trim().toUpperCase();
      const previous = chains.get(code) ?? Promise.resolve();

      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const next = previous.then(() => gate);
      chains.set(code, next);

      await previous;
      try {
        return await work();
      } finally {
        release();
        if (chains.get(code) === next) {
          chains.delete(code);
        }
      }
    }
    ```

---

## 2. Turn Validation Ordering
*   **Verdict**: SOLID
*   **Mechanism**:
    Checking the active player's seat ID and updating the turn state occurs sequentially and synchronously inside `actUnlocked()` without any yielding of control (no `await`). Since `act()` is wrapped in `withRoomGameplayLock()`, overlapping socket events are processed one after the other. The first action updates the turn index, and the second action immediately fails the turn check `It's not your turn.` when it gets its turn to execute.
*   **Evidence** ([rooms.ts](file:///Users/olivermorid/racehorse-dominoes/server/src/rooms.ts#L823-L827)):
    ```typescript
    if (!canDraw(state, playerSeatId)) {
      const currentId = state.playerIds[state.currentPlayerIndex];
      if (currentId !== playerSeatId) {
        throw new Error("It's not your turn.");
      }
    ```

---

## 3. Disconnect-Grace Auto-Action vs. Manual Action Race
*   **Verdict**: SOLID
*   **Mechanism**:
    When a player rejoins, `onPlayerSocketRejoined()` immediately clears the grace timer (`clearTimeout`).
    If the timeout has already fired and the callback `handleDisconnectGraceExpired()` is queued in the event loop, it performs a connection check before executing the auto-move. If the player has successfully rejoined and is connected, it aborts. If both manual and auto-actions attempt to execute simultaneously, the room gameplay lock serializes them, and the second action is rejected because the turn has shifted.
*   **Evidence** ([disconnectGrace.ts](file:///Users/olivermorid/racehorse-dominoes/server/src/multiplayer/disconnectGrace.ts#L109-L113)):
    ```typescript
    const connectionId = resolveSeatSocket(code, disconnectedPlayerSeatId);
    const stillConnected = connectionId
      ? io.sockets.sockets.get(connectionId)?.connected
      : false;
    if (stillConnected) return;
    ```

---

## 4. Double-Submit at the Server Level
*   **Verdict**: SOLID
*   **Mechanism**:
    For `DRAW` actions, the server utilizes `withGameActionIdempotency()`, which caches successful actions for 5 minutes and resolves in-flight actions with the same `requestId`.
    For `MOVE` (play) and `PASS` actions, no `requestId` is supplied by the client, so the idempotency check is skipped. However, because these actions shift the turn, the synchronous turn check naturally prevents double-submits from applying.
*   **Evidence** ([gameActionIdempotency.ts](file:///Users/olivermorid/racehorse-dominoes/server/src/multiplayer/gameActionIdempotency.ts#L113-L125)):
    ```typescript
    export async function withGameActionIdempotency(
      roomCode: string,
      playerSeatId: string,
      requestId: unknown,
      execute: () => Promise<GameActionAck>,
    ): Promise<GameActionAck> {
      const normalizedRequestId = normalizeGameActionRequestId(requestId);
      if (!normalizedRequestId) {
        return execute();
      }

      const cached = readCachedAck(roomCode, playerSeatId, normalizedRequestId);
      if (cached) return cached;
    ```

---

## 5. Room Object Mutation Safety
*   **Verdict**: SOLID
*   **Mechanism**:
    Rooms are stored in a simple, in-memory `Map` (`rooms`). However, access is serialized per room code using `withRoomGameplayLock`. Because `actUnlocked()` contains no `await` points, the entire mutation (including validations, board placements, score updates, and event logging) runs atomically in a single V8 call stack execution.
    The database persistence hook (`schedulePersistLiveRoomSession()`) is debounced and scheduled out-of-band via `setTimeout` so that it never blocks the V8 thread or creates asynchronous interleaving windows in the main gameplay loop.
*   **Evidence** ([roomLivePersistence.ts](file:///Users/olivermorid/racehorse-dominoes/server/src/multiplayer/roomLivePersistence.ts#L518-L535)):
    ```typescript
    export function schedulePersistLiveRoomSession(room: Room, roster: LiveRosterEntry[]): void {
      const roomCode = room.code.trim().toUpperCase();
      pendingPersistByRoomCode.set(roomCode, { room, roster });
      if (persistenceShuttingDown) return;

      const existingTimer = flushTimersByRoomCode.get(roomCode);
      if (existingTimer) return;

      const timer = setTimeout(() => {
        flushTimersByRoomCode.delete(roomCode);
        const pending = pendingPersistByRoomCode.get(roomCode);
        pendingPersistByRoomCode.delete(roomCode);
        if (!pending) return;
        void persistLiveRoomSessionNow(pending.room, pending.roster);
      }, LIVE_PERSIST_DEBOUNCE_MS);

      flushTimersByRoomCode.set(roomCode, timer);
    }
    ```
