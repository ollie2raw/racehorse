# Phase: `registerRoomSessionHandlers` Extraction Pass 2

**Date:** 2026-07-05  
**Scope:** Risk items #4–6 — `room:create`, `room:leave`, `room:abandon_match`.  
**Continues from:** Pass 1 (`docs/phase-roomsessionhandlers-extraction-1-report.md`) — utility, spectate, forfeit modules frozen.

---

## Step 0 — Verification before extracting

### 0.1 Pass 1 end-state reconciliation

| Claim (Pass 1) | Live check | Result |
|----------------|------------|--------|
| `registerRoomSessionHandlers.ts` = 1,390 LOC | `wc -l` → **1,390** | **Match** |
| Utility/spectate/forfeit extracted | Imports `registerRoomUtilityHandlers`, `registerRoomSpectateHandlers`, re-exports `applyActiveMatchForfeit` from `roomForfeit.ts` | **Match** |
| Server tests = 496 / 69 files | Pre-pass baseline confirmed in Pass 1 report | Starting baseline for arithmetic below |

**No discrepancy** between Pass 1 claimed end state and live file at pass start.

### 0.2 Post–Pass-1 line ranges (pre-extraction this pass)

Grep `socket.on('room:…')` in live `registerRoomSessionHandlers.ts` before edits:

| Handler | Lines (post-Pass-1) | Investigation report (pre-Pass-1) |
|---------|---------------------|-----------------------------------|
| `room:create` | L464–513 | L572–621 |
| `room:leave` | L800–814 | L975–989 |
| `room:abandon_match` | L816–910 | L991–1085 |

Shift of ~108 lines vs original investigation report is entirely attributable to Pass 1 removing forfeit + spectate + utility handlers.

### 0.3 `applyActiveMatchForfeit` import and call sites (live, pre-Pass-2)

**Orchestrator import (still present for `leaveTrackedRoom` internal forfeit):**

```typescript
import { applyActiveMatchForfeit } from './roomForfeit';

export { applyActiveMatchForfeit } from './roomForfeit';
```

**`leaveTrackedRoom` call (orchestrator, frozen — L125):**

```typescript
          await applyActiveMatchForfeit(io, socket, code, abandoningPlayer);
```

**`room:abandon_match` call (pre-extraction, L876):**

```typescript
        const result = await applyActiveMatchForfeit(io, socket, roomCode, abandoningPlayer);
```

Pass 2 moves the abandon handler to `registerRoomAbandonHandlers.ts`, which imports `applyActiveMatchForfeit` **directly** from `./roomForfeit` (not via orchestrator re-export).

### 0.4 Orchestrator closure dependencies

| Handler | `leaveTrackedRoom` | `leaveExistingSocketRooms` |
|---------|-------------------|---------------------------|
| `room:create` | No | **Yes** (L479) |
| `room:leave` | **Yes** (L808) | No |
| `room:abandon_match` | **Yes** (L888, after forfeit) | No |

**DI requirement:** Both closures passed explicitly via params objects (Pass 1 spectate pattern). No new `socket.__*` patterns.

### 0.5 Guards to trace (investigation §4.1 / §4.2)

| Handler | Applicable guards |
|---------|-------------------|
| `room:create` | Join ordering: `clearSocketRematchReady` + `leaveExistingSocketRooms()` before create (§4.2) |
| `room:leave` | Delegates to `leaveTrackedRoom` (forfeit guard §4.1 inside frozen closure — out of scope) |
| `room:abandon_match` | Auth (`not_authenticated`), `missing_code`, terminal reject (`abandonedAt` / `gameOver`), `not_player`, **double terminal check after `applyActiveMatchForfeit` null** (§4.1), **`applyActiveMatchForfeit` then `leaveTrackedRoom`** ordering (§4.1) |

### 0.6 Blocking-scope check

No `index.ts` changes. No frozen module edits. No later-pass handler/closure edits. **Proceed.**

---

## Extraction A — `room:create` + `room:leave` → `registerRoomLifecycleHandlers.ts`

### BEFORE — `room:create` (inlined, L464–513)

```typescript
    socket.on('room:create', async (arg1?: unknown, arg2?: unknown) => {
      const config = (
        arg1 && typeof arg1 === 'object' && !Array.isArray(arg1) ? arg1 : {}
      ) as RoomJoinConfig;
      const cb = (typeof arg1 === 'function' ? arg1 : arg2) as AckFn | undefined;
      const {
        username: _ignoredUsername,
        userId: _ignoredUserId,
        authToken: _ignoredAuthToken,
        ...roomConfig
      } = config as Record<string, unknown>;
      console.log(`[room:create] socket=${socket.id}`);
      try {
        const { username, userId } = await handlerDeps.resolveSocketIdentity(config);
        clearSocketRematchReady((socket.data?.roomId as string | undefined) ?? undefined, socket.id);
        leaveExistingSocketRooms();
        const playerSeatId = allocatePlayerSeatId();
        const room = createRoom(playerSeatId, sanitizePrivateRoomConfig(roomConfig));
        socket.join(room.code);
        socket.data.roomId = room.code;
        socket.data.username = username;
        socket.data.userId = userId;
        ensureSocketDataSeat(socket, playerSeatId);
        const roomPlayers: RoomPlayer[] = [{ id: playerSeatId, socketId: socket.id, username, userId }];
        setRoomRoster(room.code, roomPlayers);
        schedulePersistLiveRoomSessionForRoom(room);
        appendRoomEvent(room, {
          type: 'player_joined',
          actorSocketId: socket.id,
          actorUserId: userId,
          payload: {
            username,
            via: 'room:create',
          },
        });
        console.log(`[room:create] created room=${room.code}, players=${room.players.length}`);
        cb?.({
          ok: true,
          roomCode: room.code,
          you: playerSeatId,
          players: roomPlayers,
          eventMeta: getRoomMatchEventMeta(room.code),
          matchStarted: false,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'unknown error';
        console.log(`[room:create] ERROR: ${message}`);
        cb?.({ ok: false, error: message });
      }
    });
```

### BEFORE — `room:leave` (inlined, L800–814)

```typescript
    socket.on('room:leave', async (roomCode: unknown, cb?: AckFn) => {
      const code = typeof roomCode === 'string' ? roomCode.trim().toUpperCase() : '';
      if (!code) {
        cb?.({ ok: false, error: 'missing_code' });
        return;
      }

      try {
        await leaveTrackedRoom(code);
        cb?.({ ok: true, roomCode: code });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'leave_failed';
        cb?.({ ok: false, error: message });
      }
    });
```

### AFTER — full `registerRoomLifecycleHandlers.ts`

```typescript
import type { Socket } from 'socket.io';
import { appendRoomEvent } from '../roomEvents';
import { createRoom, getRoomMatchEventMeta } from '../rooms';
import { schedulePersistLiveRoomSessionForRoom } from './roomLivePersistence';
import { sanitizePrivateRoomConfig } from './privateRoomConfig';
import {
  allocatePlayerSeatId,
  clearSocketRematchReady,
  ensureSocketDataSeat,
  setRoomRoster,
  type AckFn,
  type RoomJoinConfig,
  type RoomPlayer,
  type RoomSessionHandlerDeps,
} from './roomSession';

export type LeaveTrackedRoomFn = (
  roomCode: string | undefined,
  options?: { preserveSeat?: boolean },
) => Promise<void>;

export type RegisterRoomLifecycleHandlersParams = {
  handlerDeps: RoomSessionHandlerDeps;
  leaveExistingSocketRooms: () => void;
  leaveTrackedRoom: LeaveTrackedRoomFn;
};

export function registerRoomLifecycleHandlers(
  socket: Socket,
  params: RegisterRoomLifecycleHandlersParams,
): void {
  const { handlerDeps, leaveExistingSocketRooms, leaveTrackedRoom } = params;

  socket.on('room:create', async (arg1?: unknown, arg2?: unknown) => {
    const config = (
      arg1 && typeof arg1 === 'object' && !Array.isArray(arg1) ? arg1 : {}
    ) as RoomJoinConfig;
    const cb = (typeof arg1 === 'function' ? arg1 : arg2) as AckFn | undefined;
    const {
      username: _ignoredUsername,
      userId: _ignoredUserId,
      authToken: _ignoredAuthToken,
      ...roomConfig
    } = config as Record<string, unknown>;
    console.log(`[room:create] socket=${socket.id}`);
    try {
      const { username, userId } = await handlerDeps.resolveSocketIdentity(config);
      clearSocketRematchReady((socket.data?.roomId as string | undefined) ?? undefined, socket.id);
      leaveExistingSocketRooms();
      const playerSeatId = allocatePlayerSeatId();
      const room = createRoom(playerSeatId, sanitizePrivateRoomConfig(roomConfig));
      socket.join(room.code);
      socket.data.roomId = room.code;
      socket.data.username = username;
      socket.data.userId = userId;
      ensureSocketDataSeat(socket, playerSeatId);
      const roomPlayers: RoomPlayer[] = [{ id: playerSeatId, socketId: socket.id, username, userId }];
      setRoomRoster(room.code, roomPlayers);
      schedulePersistLiveRoomSessionForRoom(room);
      appendRoomEvent(room, {
        type: 'player_joined',
        actorSocketId: socket.id,
        actorUserId: userId,
        payload: {
          username,
          via: 'room:create',
        },
      });
      console.log(`[room:create] created room=${room.code}, players=${room.players.length}`);
      cb?.({
        ok: true,
        roomCode: room.code,
        you: playerSeatId,
        players: roomPlayers,
        eventMeta: getRoomMatchEventMeta(room.code),
        matchStarted: false,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown error';
      console.log(`[room:create] ERROR: ${message}`);
      cb?.({ ok: false, error: message });
    }
  });

  socket.on('room:leave', async (roomCode: unknown, cb?: AckFn) => {
    const code = typeof roomCode === 'string' ? roomCode.trim().toUpperCase() : '';
    if (!code) {
      cb?.({ ok: false, error: 'missing_code' });
      return;
    }

    try {
      await leaveTrackedRoom(code);
      cb?.({ ok: true, roomCode: code });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'leave_failed';
      cb?.({ ok: false, error: message });
    }
  });
}
```

### Orchestrator wiring (after)

```typescript
  registerRoomLifecycleHandlers(socket, {
    handlerDeps,
    leaveExistingSocketRooms,
    leaveTrackedRoom,
  });
```

### Diff callouts — Lifecycle (A)

| Change | Detail |
|--------|--------|
| **Wrapper / DI** | Handlers register inside `registerRoomLifecycleHandlers()`; `handlerDeps`, `leaveExistingSocketRooms`, and `leaveTrackedRoom` bound from `params` instead of closing over orchestrator locals. Same function references passed from orchestrator. |
| **New exported types** | `LeaveTrackedRoomFn`, `RegisterRoomLifecycleHandlersParams` (shared with abandon module). |
| **Imports relocated** | `createRoom`, `sanitizePrivateRoomConfig`, `schedulePersistLiveRoomSessionForRoom`, etc. moved to lifecycle module top-level imports. |
| **Handler bodies** | `room:create` and `room:leave` statement order, guards, payloads, log strings — **identical** to BEFORE. Indentation dedented 4 spaces inside registrar. |

---

## Extraction B — `room:abandon_match` → `registerRoomAbandonHandlers.ts`

### BEFORE — full handler (inlined, L816–910)

```typescript
    socket.on('room:abandon_match', async (payload: unknown, cb?: AckFn) => {
      const roomCode =
        payload && typeof payload === 'object' && !Array.isArray(payload) &&
        typeof (payload as { roomCode?: unknown }).roomCode === 'string'
          ? String((payload as { roomCode: string }).roomCode).trim().toUpperCase()
          : '';
      const authenticatedUserId = handlerDeps.normalizeUserId(socket.data?.userId);
      console.log('[room:abandon] request', {
        roomCode,
        userId: authenticatedUserId,
      });
      if (!authenticatedUserId) {
        console.log('[room:abandon] rejected', {
          roomCode,
          userId: null,
          reason: 'not_authenticated',
        });
        cb?.({ ok: false, error: 'not_authenticated' });
        return;
      }
      if (!roomCode) {
        console.log('[room:abandon] rejected', {
          roomCode,
          userId: authenticatedUserId,
          reason: 'missing_code',
        });
        cb?.({ ok: false, error: 'missing_code' });
        return;
      }

      try {
        const room = getRoom(roomCode);
        if (room.abandonedAt || room.state?.gameOver) {
          const error = room.abandonedAt ? 'match_abandoned' : 'match_completed';
          console.log('[room:abandon] rejected', {
            roomCode,
            userId: authenticatedUserId,
            reason: error,
          });
          cb?.({ ok: false, error });
          return;
        }

        const rosterCached = getRoomRoster(roomCode);
        const roster =
          rosterCached.length > 0 ? rosterCached : getRoomPlayersWithFallback(roomCode, room.players);
        const abandoningPlayer =
          roster.find((player) => player.userId === authenticatedUserId)
          ?? roster.find((player) => player.socketId === socket.id)
          ?? null;
        if (!abandoningPlayer || !room.players.includes(abandoningPlayer.id)) {
          console.log('[room:abandon] rejected', {
            roomCode,
            userId: authenticatedUserId,
            reason: 'not_player',
          });
          cb?.({ ok: false, error: 'not_player' });
          return;
        }

        const result = await applyActiveMatchForfeit(io, socket, roomCode, abandoningPlayer);
        if (!result) {
          const error = room.abandonedAt ? 'match_abandoned' : 'match_completed';
          console.log('[room:abandon] rejected', {
            roomCode,
            userId: authenticatedUserId,
            reason: error,
          });
          cb?.({ ok: false, error });
          return;
        }

        await leaveTrackedRoom(roomCode);
        console.log('[room:abandon] completed', {
          roomCode,
          abandonedUserId: authenticatedUserId,
          winnerId: result.winnerUserId,
        });
        cb?.({
          ok: true,
          roomCode,
          winnerId: result.winnerUserId,
          isTournament: Boolean(room.scheduledTournamentMatchId),
          tournamentId: room.scheduledTournamentId ?? null,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'abandon_failed';
        console.log('[room:abandon] rejected', {
          roomCode,
          userId: authenticatedUserId,
          reason: message,
        });
        cb?.({ ok: false, error: message });
      }
    });
```

### AFTER — full `registerRoomAbandonHandlers.ts`

```typescript
import type { Server, Socket } from 'socket.io';
import { getRoom } from '../rooms';
import { applyActiveMatchForfeit } from './roomForfeit';
import {
  getRoomPlayersWithFallback,
  getRoomRoster,
  type AckFn,
  type RoomSessionHandlerDeps,
} from './roomSession';
import type { LeaveTrackedRoomFn } from './registerRoomLifecycleHandlers';

export type RegisterRoomAbandonHandlersParams = {
  handlerDeps: RoomSessionHandlerDeps;
  leaveTrackedRoom: LeaveTrackedRoomFn;
};

export function registerRoomAbandonHandlers(
  io: Server,
  socket: Socket,
  params: RegisterRoomAbandonHandlersParams,
): void {
  const { handlerDeps, leaveTrackedRoom } = params;

  socket.on('room:abandon_match', async (payload: unknown, cb?: AckFn) => {
    const roomCode =
      payload && typeof payload === 'object' && !Array.isArray(payload) &&
      typeof (payload as { roomCode?: unknown }).roomCode === 'string'
        ? String((payload as { roomCode: string }).roomCode).trim().toUpperCase()
        : '';
    const authenticatedUserId = handlerDeps.normalizeUserId(socket.data?.userId);
    console.log('[room:abandon] request', {
      roomCode,
      userId: authenticatedUserId,
    });
    if (!authenticatedUserId) {
      console.log('[room:abandon] rejected', {
        roomCode,
        userId: null,
        reason: 'not_authenticated',
      });
      cb?.({ ok: false, error: 'not_authenticated' });
      return;
    }
    if (!roomCode) {
      console.log('[room:abandon] rejected', {
        roomCode,
        userId: authenticatedUserId,
        reason: 'missing_code',
      });
      cb?.({ ok: false, error: 'missing_code' });
      return;
    }

    try {
      const room = getRoom(roomCode);
      if (room.abandonedAt || room.state?.gameOver) {
        const error = room.abandonedAt ? 'match_abandoned' : 'match_completed';
        console.log('[room:abandon] rejected', {
          roomCode,
          userId: authenticatedUserId,
          reason: error,
        });
        cb?.({ ok: false, error });
        return;
      }

      const rosterCached = getRoomRoster(roomCode);
      const roster =
        rosterCached.length > 0 ? rosterCached : getRoomPlayersWithFallback(roomCode, room.players);
      const abandoningPlayer =
        roster.find((player) => player.userId === authenticatedUserId)
        ?? roster.find((player) => player.socketId === socket.id)
        ?? null;
      if (!abandoningPlayer || !room.players.includes(abandoningPlayer.id)) {
        console.log('[room:abandon] rejected', {
          roomCode,
          userId: authenticatedUserId,
          reason: 'not_player',
        });
        cb?.({ ok: false, error: 'not_player' });
        return;
      }

      const result = await applyActiveMatchForfeit(io, socket, roomCode, abandoningPlayer);
      if (!result) {
        const error = room.abandonedAt ? 'match_abandoned' : 'match_completed';
        console.log('[room:abandon] rejected', {
          roomCode,
          userId: authenticatedUserId,
          reason: error,
        });
        cb?.({ ok: false, error });
        return;
      }

      await leaveTrackedRoom(roomCode);
      console.log('[room:abandon] completed', {
        roomCode,
        abandonedUserId: authenticatedUserId,
        winnerId: result.winnerUserId,
      });
      cb?.({
        ok: true,
        roomCode,
        winnerId: result.winnerUserId,
        isTournament: Boolean(room.scheduledTournamentMatchId),
        tournamentId: room.scheduledTournamentId ?? null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'abandon_failed';
      console.log('[room:abandon] rejected', {
        roomCode,
        userId: authenticatedUserId,
        reason: message,
      });
      cb?.({ ok: false, error: message });
    }
  });
}
```

### Orchestrator wiring (after)

```typescript
  registerRoomAbandonHandlers(io, socket, {
    handlerDeps,
    leaveTrackedRoom,
  });
```

### Diff callouts — Abandon (B)

| Change | Detail |
|--------|--------|
| **`applyActiveMatchForfeit` import** | Handler module imports from `./roomForfeit` directly. Orchestrator still imports for `leaveTrackedRoom` + re-export; abandon no longer resolves through orchestrator. **Call site unchanged:** `applyActiveMatchForfeit(io, socket, roomCode, abandoningPlayer)`. |
| **Wrapper / DI** | `io`, `socket`, `handlerDeps`, `leaveTrackedRoom` passed as explicit params. |
| **Cross-module type** | `LeaveTrackedRoomFn` imported from `registerRoomLifecycleHandlers.ts` (type-only). |
| **Handler body** | All guards, log payloads, error strings, ack shapes, and **`applyActiveMatchForfeit` → `leaveTrackedRoom` ordering** — **identical** to BEFORE. Indentation dedented 4 spaces. |

---

## Orchestrator tail (full registrar calls, after Pass 2)

```typescript
  registerRoomLifecycleHandlers(socket, {
    handlerDeps,
    leaveExistingSocketRooms,
    leaveTrackedRoom,
  });
  registerRoomAbandonHandlers(io, socket, {
    handlerDeps,
    leaveTrackedRoom,
  });
  registerRoomSpectateHandlers(socket, {
    handlerDeps,
    leaveExistingSocketRooms,
  });
  registerRoomUtilityHandlers(socket);
}
```

**Orchestrator imports added:**

```typescript
import { registerRoomAbandonHandlers } from './registerRoomAbandonHandlers';
import { registerRoomLifecycleHandlers } from './registerRoomLifecycleHandlers';
```

**Orchestrator imports removed** (relocated to lifecycle module): `createRoom`, `sanitizePrivateRoomConfig`, `schedulePersistLiveRoomSessionForRoom`.

---

## LOC arithmetic (checkable against Pass 1)

| File | Pass 1 end | Pass 2 end | Δ |
|------|------------|------------|---|
| `registerRoomSessionHandlers.ts` | 1,390 | **1,236** | **−154** |
| `registerRoomLifecycleHandlers.ts` | — | 99 | +99 |
| `registerRoomAbandonHandlers.ts` | — | 118 | +118 |
| Pass 1 modules (frozen) | 235 | 235 | 0 |

Pass 2 extracted **~154 lines** from orchestrator into **217 lines** of new modules (+63 net module overhead: exports, types, imports).

### Test / build arithmetic

| Metric | Pass 1 end | Pass 2 end | Δ |
|--------|------------|------------|---|
| Server test files | 69 | **71** | +2 |
| Server tests | 496 | **500** | +4 |
| Build | pass | **pass** | — |

**New tests:**

| File | Tests |
|------|-------|
| `registerRoomLifecycleHandlers.test.ts` | 2 (`room:create` ack, `room:leave` missing_code + delegate) |
| `registerRoomAbandonHandlers.test.ts` | 2 (`not_authenticated`, forfeit-then-leave ordering with mock) |

**Commands run:**

```bash
npm run build --prefix server
# exit 0

npm test --prefix server
# Test Files  71 passed (71)
# Tests       500 passed (500)
```

All Pass 1 + integration suites (`registerRoomSessionHandlers.private`, `.abandon`, `.tournament`, `.privateRoomConfig`, `handReadyGameplayLock`, `tournamentHumanBotFlow`, Pass 1 module tests) included in full run — **all pass**.

---

## Files changed

| File | Change |
|------|--------|
| `server/src/multiplayer/registerRoomLifecycleHandlers.ts` | **Created** |
| `server/src/multiplayer/registerRoomAbandonHandlers.ts` | **Created** |
| `server/src/multiplayer/registerRoomSessionHandlers.ts` | Removed 3 inlined handlers; wired 2 registrars |
| `server/src/multiplayer/registerRoomLifecycleHandlers.test.ts` | **Created** |
| `server/src/multiplayer/registerRoomAbandonHandlers.test.ts` | **Created** |

**Not touched:** Pass 1 frozen modules, `index.ts`, `disconnectGrace.ts`, `roomForfeit.ts`, all later-pass orchestrator closures/handlers, all frozen client paths.

---

## Remaining for Pass 3+

Per investigation risk ranking: `game:action`, `hand:ready`, `player:ready` + `game:start`, rematch/pregame, then `attachSocketToTrackedRoom` + join/tournament attach (highest risk).