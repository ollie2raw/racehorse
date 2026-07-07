# Phase: `registerRoomSessionHandlers` Extraction Pass 3

**Date:** 2026-07-05  
**Scope:** Risk items #7–8 — `game:action`, `hand:ready`.  
**Continues from:** Pass 1 + Pass 2 extraction reports. Pass 1/2 modules frozen.

---

## Step 0 — Verification before extracting

### 0.1 Pass 2 end-state reconciliation

| Claim (Pass 2) | Live check | Result |
|----------------|------------|--------|
| `registerRoomSessionHandlers.ts` = 1,236 LOC | `wc -l` → **1,236** | **Match** |
| Server tests = 500 / 71 files | Baseline from Pass 2 report | Starting point |

### 0.2 Post–Pass-2 line ranges (pre-extraction this pass)

| Handler | Lines (post-Pass-2) |
|---------|---------------------|
| `game:action` | L885–948 |
| `hand:ready` | L950–975 |

### 0.3 `act()` call, gameplay lock, `broadcastStateUpdate`

**Handlers do not call `withRoomGameplayLock` directly.** Locking is internal to `rooms.ts`:

```typescript
export async function act(
  code: string,
  playerSeatId: string,
  action: ActionPayload,
  io: Server,
  onStateReady: (roomCode: string) => void,
): Promise<ActResult> {
  return withRoomGameplayLock(code, () =>
    actUnlocked(code, playerSeatId, action, io, onStateReady),
  );
}
```

**`game:action` call site (pre-extraction L911):**

```typescript
const result = await act(roomCode, playerSeatId, action, io, (code) => broadcastStateUpdate(code));
```

**Post-`act` broadcast ordering (pre-extraction L919–923):**

```typescript
        // Authoritative state before draw animations so clients never render against stale hands/board.
        broadcastStateUpdate(room.code);
        if (result.forcedDrawAnimation) {
          emitForcedDrawAnimationPayload(room.code, result.forcedDrawAnimation);
        }
```

**`hand:ready` delegates lock to `readyForNextHand`**, which opens with:

```typescript
  const markPhase = await withRoomGameplayLock(code, async (): Promise<MarkPhaseResult> => {
```

**`hand:ready` broadcast calls (pre-extraction L956–960):**

```typescript
        const result = await readyForNextHand(roomCode, playerSeatId, io, handNumber, (code) => {
          broadcastStateUpdate(code);
        });
        if (result.started) {
          broadcastStateUpdate(result.room.code);
```

### 0.4 `maybeFinalizeTournamentMatch` / `setImmediate` grep (out-of-frozen-scope)

```bash
rg 'maybeFinalizeTournamentMatch|setImmediate' server/src/multiplayer/registerRoomSessionHandlers.ts
```

| Line | Code |
|------|------|
| 924 | `setImmediate(() => handlerDeps.maybeFinalizeTournamentMatch?.(room));` — **`game:action`** |
| 961 | `setImmediate(() => handlerDeps.maybeFinalizeTournamentMatch?.(result.room));` — **`hand:ready`** |

**Only these two sites** in the orchestrator (outside frozen closures). No other `maybeFinalizeTournamentMatch` references remain in-scope after extraction.

### 0.5 `hand:ready` stale/duplicate guard (handler surface + `rooms.ts` engine)

**Handler ack surface (pre-extraction L963–970):**

```typescript
        cb?.({
          ok: !result.ignored,
          started: result.started,
          ignored: Boolean(result.ignored),
          handNumber: result.room.state?.handNumber ?? null,
          waitMs: result.waitMs ?? 0,
          error: result.ignored ? 'stale_or_duplicate_hand_ready' : undefined,
        });
```

**Stale hand-number guard inside `readyForNextHand` (`rooms.ts` L647–648):**

```typescript
    if (typeof handNumber === 'number' && handNumber !== room.state.handNumber) {
      return { kind: 'return', value: { started: false, room, ignored: true } };
    }
```

**Coalescing via `nextHandStartsByRoom` (`rooms.ts` L655–657, L724–735):**

```typescript
    const existingStart = nextHandStartsByRoom.get(code);
    if (existingStart) {
      return { kind: 'coalesce', room, existingStart, readyHandNumber };
    }
```

```typescript
  if (markPhase.kind === 'coalesce') {
    const currentRoom = await markPhase.existingStart;
    const currentState = currentRoom.state;
    return {
      started: Boolean(
        currentState &&
          currentState.handNumber !== markPhase.readyHandNumber &&
          !currentState.handOver,
      ),
      room: currentRoom,
      ignored: true,
    };
  }
```

Handler does not implement coalescing itself — it surfaces `result.ignored` from `readyForNextHand`.

### 0.6 Orchestrator closure dependencies

| Need | `game:action` | `hand:ready` |
|------|---------------|---------------|
| `io` | Yes (`act`, `readyForNextHand`) | Yes |
| `socket` | Yes | Yes |
| `handlerDeps` | Yes (`maybeFinalizeTournamentMatch`) | Yes (`maybeFinalizeTournamentMatch`) |
| `leaveTrackedRoom` / `leaveExistingSocketRooms` | No | No |

**DI params:** `{ handlerDeps: RoomSessionHandlerDeps }` plus `io` and `socket` as function arguments.

### 0.7 Blocking-scope check

No `index.ts`, `rooms.ts`, `roomGameplayLock.ts`, or frozen handler edits required. **Proceed.**

---

## Extraction — `game:action` + `hand:ready` → `registerGameplayActionHandlers.ts`

### BEFORE — `game:action` (inlined, L885–948)

```typescript
    socket.on('game:action', async (code, action, cb) => {
      const roomCode = String(code).trim().toUpperCase();
      console.log(`[game:action] socket=${socket.id}, code=${roomCode}, action=${action?.type}`);
      try {
        if (!action || typeof action !== 'object' || typeof action.type !== 'string') {
          if (typeof cb === 'function') cb({ ok: false, error: 'Invalid action payload.' });
          return;
        }
        if (!['DRAW', 'MOVE', 'PASS'].includes(action.type)) {
          if (typeof cb === 'function') cb({ ok: false, error: 'Unknown action type.' });
          return;
        }
        const existingRoom = getRoom(roomCode);
        const playerSeatId = resolveActorSeatId(roomCode, socket);
        if (!existingRoom.players.includes(playerSeatId)) {
          if (typeof cb === 'function') cb({ ok: false, error: 'Spectators cannot act.' });
          return;
        }
        if (!existingRoom.state) {
          if (typeof cb === 'function') cb({ ok: false, error: 'Game not started.' });
          return;
        }
        if (existingRoom.state.gameOver) {
          if (typeof cb === 'function') cb({ ok: false, error: 'Game is over.' });
          return;
        }
        const result = await act(roomCode, playerSeatId, action, io, (code) => broadcastStateUpdate(code));
        const room = result.room;
        room.pendingForcedDrawBroadcast = result.forcedDrawAnimation
          ? {
              playerId: result.forcedDrawAnimation.playerId,
              count: result.forcedDrawAnimation.steps.length,
            }
          : undefined;
        // Authoritative state before draw animations so clients never render against stale hands/board.
        broadcastStateUpdate(room.code);
        if (result.forcedDrawAnimation) {
          emitForcedDrawAnimationPayload(room.code, result.forcedDrawAnimation);
        }
        setImmediate(() => handlerDeps.maybeFinalizeTournamentMatch?.(room));
        if (process.env.NODE_ENV !== 'production' || process.env.MP_DEBUG === '1' || process.env.DEBUG_MP === '1') {
          console.log('[mp-action-ack]', {
            roomCode: room.code,
            playerId: socket.id,
            action: action?.type,
            sequence: room.state?.sequence ?? null,
          });
        }
        const forcedMeta = result.forcedDrawAnimation
          ? {
              drewCount: result.forcedDrawAnimation.steps.length,
              stoppedReason: result.forcedDrawAnimation.stoppedReason,
              drawChainId: room.state?.sequence ?? null,
            }
          : undefined;
        if (typeof cb === 'function') {
          cb({ ok: true, sequence: room.state?.sequence ?? null, forcedDraw: forcedMeta });
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'unknown error';
        console.log(`[game:action] ERROR: ${message}`);
        if (typeof cb === 'function') cb({ ok: false, error: message });
      }
    });
```

### BEFORE — `hand:ready` (inlined, L950–975)

```typescript
    socket.on('hand:ready', async (code, arg2?: unknown, arg3?: unknown) => {
      const roomCode = String(code).trim().toUpperCase();
      const handNumber = typeof arg2 === 'number' && Number.isFinite(arg2) ? arg2 : undefined;
      const cb = (typeof arg2 === 'function' ? arg2 : arg3) as AckFn | undefined;
      try {
        const playerSeatId = resolveActorSeatId(roomCode, socket);
        const result = await readyForNextHand(roomCode, playerSeatId, io, handNumber, (code) => {
          broadcastStateUpdate(code);
        });
        if (result.started) {
          broadcastStateUpdate(result.room.code);
          setImmediate(() => handlerDeps.maybeFinalizeTournamentMatch?.(result.room));
        }
        cb?.({
          ok: !result.ignored,
          started: result.started,
          ignored: Boolean(result.ignored),
          handNumber: result.room.state?.handNumber ?? null,
          waitMs: result.waitMs ?? 0,
          error: result.ignored ? 'stale_or_duplicate_hand_ready' : undefined,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'unknown error';
        cb?.({ ok: false, error: message });
      }
    });
```

### AFTER — full `registerGameplayActionHandlers.ts` (112 LOC)

```typescript
import type { Server, Socket } from 'socket.io';
import { act, getRoom, readyForNextHand } from '../rooms';
import {
  broadcastStateUpdate,
  emitForcedDrawAnimationPayload,
  resolveActorSeatId,
  type AckFn,
  type RoomSessionHandlerDeps,
} from './roomSession';

export type RegisterGameplayActionHandlersParams = {
  handlerDeps: RoomSessionHandlerDeps;
};

export function registerGameplayActionHandlers(
  io: Server,
  socket: Socket,
  params: RegisterGameplayActionHandlersParams,
): void {
  const { handlerDeps } = params;

  socket.on('game:action', async (code, action, cb) => {
    const roomCode = String(code).trim().toUpperCase();
    console.log(`[game:action] socket=${socket.id}, code=${roomCode}, action=${action?.type}`);
    try {
      if (!action || typeof action !== 'object' || typeof action.type !== 'string') {
        if (typeof cb === 'function') cb({ ok: false, error: 'Invalid action payload.' });
        return;
      }
      if (!['DRAW', 'MOVE', 'PASS'].includes(action.type)) {
        if (typeof cb === 'function') cb({ ok: false, error: 'Unknown action type.' });
        return;
      }
      const existingRoom = getRoom(roomCode);
      const playerSeatId = resolveActorSeatId(roomCode, socket);
      if (!existingRoom.players.includes(playerSeatId)) {
        if (typeof cb === 'function') cb({ ok: false, error: 'Spectators cannot act.' });
        return;
      }
      if (!existingRoom.state) {
        if (typeof cb === 'function') cb({ ok: false, error: 'Game not started.' });
        return;
      }
      if (existingRoom.state.gameOver) {
        if (typeof cb === 'function') cb({ ok: false, error: 'Game is over.' });
        return;
      }
      const result = await act(roomCode, playerSeatId, action, io, (code) => broadcastStateUpdate(code));
      const room = result.room;
      room.pendingForcedDrawBroadcast = result.forcedDrawAnimation
        ? {
            playerId: result.forcedDrawAnimation.playerId,
            count: result.forcedDrawAnimation.steps.length,
          }
        : undefined;
      // Authoritative state before draw animations so clients never render against stale hands/board.
      broadcastStateUpdate(room.code);
      if (result.forcedDrawAnimation) {
        emitForcedDrawAnimationPayload(room.code, result.forcedDrawAnimation);
      }
      setImmediate(() => handlerDeps.maybeFinalizeTournamentMatch?.(room));
      if (process.env.NODE_ENV !== 'production' || process.env.MP_DEBUG === '1' || process.env.DEBUG_MP === '1') {
        console.log('[mp-action-ack]', {
          roomCode: room.code,
          playerId: socket.id,
          action: action?.type,
          sequence: room.state?.sequence ?? null,
        });
      }
      const forcedMeta = result.forcedDrawAnimation
        ? {
            drewCount: result.forcedDrawAnimation.steps.length,
            stoppedReason: result.forcedDrawAnimation.stoppedReason,
            drawChainId: room.state?.sequence ?? null,
          }
        : undefined;
      if (typeof cb === 'function') {
        cb({ ok: true, sequence: room.state?.sequence ?? null, forcedDraw: forcedMeta });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown error';
      console.log(`[game:action] ERROR: ${message}`);
      if (typeof cb === 'function') cb({ ok: false, error: message });
    }
  });

  socket.on('hand:ready', async (code, arg2?: unknown, arg3?: unknown) => {
    const roomCode = String(code).trim().toUpperCase();
    const handNumber = typeof arg2 === 'number' && Number.isFinite(arg2) ? arg2 : undefined;
    const cb = (typeof arg2 === 'function' ? arg2 : arg3) as AckFn | undefined;
    try {
      const playerSeatId = resolveActorSeatId(roomCode, socket);
      const result = await readyForNextHand(roomCode, playerSeatId, io, handNumber, (code) => {
        broadcastStateUpdate(code);
      });
      if (result.started) {
        broadcastStateUpdate(result.room.code);
        setImmediate(() => handlerDeps.maybeFinalizeTournamentMatch?.(result.room));
      }
      cb?.({
        ok: !result.ignored,
        started: result.started,
        ignored: Boolean(result.ignored),
        handNumber: result.room.state?.handNumber ?? null,
        waitMs: result.waitMs ?? 0,
        error: result.ignored ? 'stale_or_duplicate_hand_ready' : undefined,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown error';
      cb?.({ ok: false, error: message });
    }
  });
}
```

### Orchestrator wiring (after)

**Import added:**

```typescript
import { registerGameplayActionHandlers } from './registerGameplayActionHandlers';
```

**Registrar call (orchestrator tail):**

```typescript
  registerGameplayActionHandlers(io, socket, {
    handlerDeps,
  });
```

**Imports removed from orchestrator** (relocated to gameplay module): `act`, `readyForNextHand`, `emitForcedDrawAnimationPayload`.

### Diff callouts

| Change | Detail |
|--------|--------|
| **Wrapper / DI** | `handlerDeps` bound from `params`; `io` and `socket` are explicit function args instead of closing over orchestrator locals. **Same object references** passed from orchestrator. |
| **New exported type** | `RegisterGameplayActionHandlersParams`. |
| **Imports relocated** | `act`, `readyForNextHand`, `broadcastStateUpdate`, `emitForcedDrawAnimationPayload`, `resolveActorSeatId` imported in gameplay module. |
| **`setImmediate` deferral** | **Unchanged** — still `setImmediate(() => handlerDeps.maybeFinalizeTournamentMatch?.(room))` after `broadcastStateUpdate` + optional `emitForcedDrawAnimationPayload`; hand:ready still defers only when `result.started`. |
| **Gameplay lock** | Still **internal** to `act()` / `readyForNextHand()` — no lock call added or removed in handler layer. |
| **Handler bodies** | Statement order, guards, error strings, ack payloads, broadcast/animation ordering — **identical** to BEFORE. Indentation dedented 4 spaces inside registrar. |

**No variable renames, no reordered statements, no synchronous finalize**, no changes to `stale_or_duplicate_hand_ready` surfacing.

---

## LOC arithmetic (checkable against Pass 2)

| File | Pass 2 end | Pass 3 end | Δ |
|------|------------|------------|---|
| `registerRoomSessionHandlers.ts` | 1,236 | **1,145** | **−91** |
| `registerGameplayActionHandlers.ts` | — | 112 | +112 |
| Pass 1+2 modules (frozen) | 316 | 316 | 0 |

Net: −91 + 112 = **+21** module overhead (exports/imports wrapper).

### Test / build arithmetic

| Metric | Pass 2 end | Pass 3 end | Δ |
|--------|------------|------------|---|
| Server test files | 71 | **72** | +1 |
| Server tests | 500 | **502** | +2 |
| Build | pass | **pass** | — |

**New test file:** `registerGameplayActionHandlers.test.ts` (2 tests: unknown action type rejection; hand:ready game-not-started error).

**Critical integration suites (all pass):**

- `handReadyGameplayLock.test.ts` — hand:ready vs game:action race at hand boundary
- `registerRoomSessionHandlers.private.test.ts` — game:action happy path + concurrent serialization
- `tournamentHumanBotFlow.test.ts`
- `registerRoomSessionHandlers.abandon.test.ts`
- All Pass 1 + Pass 2 module tests

```bash
npm run build --prefix server
# exit 0

npm test --prefix server
# Test Files  72 passed (72)
# Tests       502 passed (502)
```

---

## Files changed

| File | Change |
|------|--------|
| `server/src/multiplayer/registerGameplayActionHandlers.ts` | **Created** |
| `server/src/multiplayer/registerRoomSessionHandlers.ts` | Removed inlined handlers; wired registrar |
| `server/src/multiplayer/registerGameplayActionHandlers.test.ts` | **Created** |

**Not touched:** Pass 1/2 frozen modules, `index.ts`, `rooms.ts`, `roomGameplayLock.ts`, `roomSession.ts`, all later-pass orchestrator closures/handlers, all frozen client paths.

---

## Remaining for Pass 4+

Per investigation risk ranking: `player:ready` + `game:start` (#9), `game:rematch` + `game:pregame_draw_pick` (#10), then `attachSocketToTrackedRoom` + `room:join` + `tournament:attach_assigned_match` + disconnect integration (#11 highest).