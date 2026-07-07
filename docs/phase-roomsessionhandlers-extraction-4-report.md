# Phase: `registerRoomSessionHandlers` Extraction Pass 4

**Date:** 2026-07-05  
**Scope:** Risk item #9 — `player:ready`, `game:start` (pre-start ready/start handlers).  
**Continues from:** Pass 1–3 extraction reports. Pass 1–3 modules frozen.

---

## Step 0 — Verification before extracting

### 0.1 Pass 3 end-state reconciliation

| Claim (Pass 3) | Live check | Result |
|----------------|------------|--------|
| `registerRoomSessionHandlers.ts` = 1,145 LOC | `wc -l` → **1,145** | **Match** |
| Server tests = 502 / 72 files | Baseline from Pass 3 report | Starting point |

**No discrepancy** between Pass 3 claimed end state and live file at pass start.

### 0.2 Post–Pass-3 line ranges (pre-extraction this pass)

| Handler | Lines (post-Pass-3) |
|---------|---------------------|
| `player:ready` | L747–817 |
| `game:start` | L819–881 |

### 0.3 `tryStartMatchIfReady` call signature and `buildMatchStartDeps` usage (both handlers, live pre-extraction)

**Identical call in both handlers:**

```typescript
const startResult = await tryStartMatchIfReady(roomCode, io, buildMatchStartDeps(io));
```

**`buildMatchStartDeps` import source:** `./roomSession` (orchestrator pre-extraction; unchanged in extracted module).

**`tryStartMatchIfReady` idempotency boundary** (`matchStartReady.ts` — frozen, not modified):

```typescript
export async function tryStartMatchIfReady(
  roomCode: string,
  io: Server,
  deps: MatchStartDeps,
): Promise<{ started: boolean; waitingFor?: string[] }> {
  const room = getRoom(roomCode);
  if (room.state) {
    return { started: false };
  }
  // ...
}
```

### 0.4 Private-vs-MM/tournament branching in `player:ready` (verbatim, live pre-extraction)

```typescript
        const isPrivate = !roomAfterReady.matchmakingMatchId && !roomAfterReady.scheduledTournamentMatchId;
        if (!isPrivate) {
          const startResult = await tryStartMatchIfReady(roomCode, io, buildMatchStartDeps(io));
          if (startResult.started) {
            const started = getRoom(roomCode);
            if (started.scheduledTournamentMatchId) {
              const readyUserId = handlerDeps.normalizeUserId(socket.data?.userId);
              await promoteScheduledMatchToInProgress(
                started.scheduledTournamentMatchId,
                defaultEnginePersistence,
                new Date().toISOString(),
                readyUserId,
              );
            }
            handlerDeps.notifyRoomPlayersInGame(roomCode);
            await handlerDeps.onAfterMatchStarted(started);
          }
          cb?.({
            ok: true,
            started: startResult.started,
            waitingFor: startResult.waitingFor ?? [],
          });
        } else {
          const roster = getRoomRoster(roomCode).length > 0
            ? getRoomRoster(roomCode)
            : getRoomPlayersWithFallback(roomCode, roomAfterReady.players);
          io.to(roomCode).emit('room:update', {
            players: roster,
          });
          cb?.({
            ok: true,
            started: false,
            waitingFor: roomAfterReady.players.filter((id) => !roomAfterReady.matchStartReady.has(id)),
          });
        }
```

### 0.5 `game:start` host-seat check, live/roster quorum check, `room:request_ready` fallback (verbatim, live pre-extraction)

**Host-seat check:**

```typescript
        if (existingRoom.players[0] !== playerSeatId) {
          if (typeof cb === 'function') cb({ ok: false, error: 'Only the room host can start the game.' });
          return;
        }
```

**Live/roster quorum check:**

```typescript
        const liveCount = io.sockets.adapter.rooms.get(roomCode)?.size ?? 0;
        const rosterCount = (
          getRoomRoster(roomCode).length > 0 ? getRoomRoster(roomCode) :
          getRoomPlayersWithFallback(roomCode, existingRoom.players)
        ).length;
        if (liveCount < 2 || rosterCount < 2) {
          if (typeof cb === 'function') cb({ ok: false, error: 'waiting_for_players' });
          return;
        }
```

**`room:request_ready` fallback when `!startResult.started`:**

```typescript
        if (!startResult.started) {
          const waitingFor = startResult.waitingFor ?? auditMissing;
          io.to(roomCode).emit('room:request_ready', {
            roomCode,
            waitingFor,
          });
          if (typeof cb === 'function') {
            cb({ ok: false, error: 'waiting_for_ready', waitingFor });
          }
          return;
        }
```

### 0.6 `matchStartReady` shared-state verification (grep)

**Handlers (pre-extraction) and frozen attach paths all use the same exported APIs from `matchStartReady.ts`:**

| Site | File | API |
|------|------|-----|
| `player:ready` | `registerRoomSessionHandlers.ts` (now `registerMatchStartHandlers.ts`) | `markMatchStartReady`, read `room.matchStartReady` |
| `game:start` | same | `markMatchStartReady`, read `room.matchStartReady` |
| MM auto-start | `registerRoomSessionHandlers.ts` L339–346 (frozen `attachSocketToTrackedRoom`) | `markMatchStartReady`, `tryStartMatchIfReady` |
| Tournament auto-start | `registerRoomSessionHandlers.ts` L648–650 (frozen `tournament:attach_assigned_match`) | `markMatchStartReady`, `tryStartMatchIfReady` |

**Grep proof — no duplicate/local `matchStartReady` state in handlers.** Raw terminal output in **Follow-up appendix §F.2** (re-run 2026-07-05).

**State owner:** `room.matchStartReady` (`Set<string>` on `Room` in `rooms.ts`). Mutations go through `markMatchStartReady()` and `tryStartMatchIfReady()` (which clears on successful start). **No separate handler-local state.**

**Race-safety property (investigation §4.5, §4.15):** Concurrent `player:ready`-triggered auto-start and `attachSocketToTrackedRoom` MM auto-start both call `tryStartMatchIfReady`; first caller wins via `initiatePregameDrawOrStart`; second no-ops because `room.state` exists. Extraction does not alter this boundary.

### 0.7 Orchestrator closure dependencies for DI scoping

| Symbol | Source in orchestrator | Needed by extracted handlers? |
|--------|------------------------|-------------------------------|
| `io` | `registerRoomSessionHandlers(io, socket)` param | **Yes** — passed as first arg to `registerMatchStartHandlers` |
| `handlerDeps` | `requireRoomSessionHandlerDeps()` at L74 | **Yes** — passed via `{ handlerDeps }` params |
| `leaveTrackedRoom` | internal closure | **No** |
| `leaveExistingSocketRooms` | internal closure | **No** |
| `attachSocketToTrackedRoom` | internal closure | **No** |

**DI params type:**

```typescript
export type RegisterMatchStartHandlersParams = {
  handlerDeps: RoomSessionHandlerDeps;
};
```

**No ref bridges.** `io` and `handlerDeps` passed explicitly per Pass 1–3 pattern.

---

## Extraction summary

### New file

`server/src/multiplayer/registerMatchStartHandlers.ts` — exports `registerMatchStartHandlers(io, socket, { handlerDeps })`.

### Orchestrator wiring (AFTER)

```typescript
import { registerMatchStartHandlers } from './registerMatchStartHandlers';
```

Registrar call (end of handler registration block):

```typescript
  registerMatchStartHandlers(io, socket, {
    handlerDeps,
  });
```

**Frozen paths untouched:** `attachSocketToTrackedRoom`, `leaveTrackedRoom`, `leaveExistingSocketRooms`, `room:join`, `tournament:attach_assigned_match`, `game:rematch`, `game:pregame_draw_pick`, `handleRoomPlayerDisconnect`. Orchestrator still imports `markMatchStartReady`, `tryStartMatchIfReady`, `buildMatchStartDeps` for frozen MM/tournament auto-start blocks.

### Explicit diff callouts (BEFORE vs AFTER handler bodies)

| Aspect | Change? |
|--------|---------|
| Guard evaluation order | **No change** |
| `isPrivate` branching | **No change** |
| `tryStartMatchIfReady` call + idempotency reliance | **No change** |
| `onAfterMatchStarted` / `notifyRoomPlayersInGame` ordering relative to `startResult.started` | **No change** |
| `promoteScheduledMatchToInProgress` on tournament `player:ready` start | **No change** |
| `room:request_ready` emit + `waiting_for_ready` ack | **No change** |
| Handler statement order | **No change** |
| Indentation | **Only cosmetic** — handlers moved from 4-space nested indent inside `registerRoomSessionHandlers` to 2-space module-level indent |
| `player:ready` post-mark log variable (`room` vs `roomAfterReady`) | **No runtime change** — live pre-extraction source already used `roomAfterReady.matchStartReady` (see Follow-up appendix); report §BEFORE had a transcription typo (`room.matchStartReady`). At that program point `room` and `roomAfterReady` are the same `Room` reference (see Follow-up appendix). |

**No logic, guard, or sequencing differences in the extracted source.** Handler bodies are a verbatim move aside from indentation. See **Follow-up appendix** for the undisclosed diff-callout correction and `getRoom` reference proof.

---

## BEFORE — full handler bodies (pre-extraction, `registerRoomSessionHandlers.ts` L747–881)

### `player:ready` (L747–817)

```typescript
    socket.on('player:ready', async (code: unknown, cb?: AckFn) => {
      const roomCode = String(code ?? '').trim().toUpperCase();
      try {
        const room = getRoom(roomCode);
        const playerSeatId = resolveActorSeatId(roomCode, socket);
        if (!room.players.includes(playerSeatId)) {
          console.log('[player:ready] rejected — seat not in room.players', {
            roomCode,
            playerSeatId,
            socketId: socket.id,
            roomPlayers: [...room.players],
            matchStartReady: [...room.matchStartReady],
          });
          cb?.({ ok: false, error: 'Only room players can ready up.' });
          return;
        }
        console.log('[player:ready] marking seat ready', {
          roomCode,
          playerSeatId,
          socketId: socket.id,
          roomPlayers: [...room.players],
          matchStartReadyBefore: [...room.matchStartReady],
        });
        markMatchStartReady(roomCode, playerSeatId);
        const roomAfterReady = getRoom(roomCode);
        console.log('[player:ready] matchStartReady after mark', {
          roomCode,
          playerSeatId,
          matchStartReady: [...roomAfterReady.matchStartReady],
        });
        const isPrivate = !roomAfterReady.matchmakingMatchId && !roomAfterReady.scheduledTournamentMatchId;
        if (!isPrivate) {
          const startResult = await tryStartMatchIfReady(roomCode, io, buildMatchStartDeps(io));
          if (startResult.started) {
            const started = getRoom(roomCode);
            if (started.scheduledTournamentMatchId) {
              const readyUserId = handlerDeps.normalizeUserId(socket.data?.userId);
              await promoteScheduledMatchToInProgress(
                started.scheduledTournamentMatchId,
                defaultEnginePersistence,
                new Date().toISOString(),
                readyUserId,
              );
            }
            handlerDeps.notifyRoomPlayersInGame(roomCode);
            await handlerDeps.onAfterMatchStarted(started);
          }
          cb?.({
            ok: true,
            started: startResult.started,
            waitingFor: startResult.waitingFor ?? [],
          });
        } else {
          const roster = getRoomRoster(roomCode).length > 0
            ? getRoomRoster(roomCode)
            : getRoomPlayersWithFallback(roomCode, roomAfterReady.players);
          io.to(roomCode).emit('room:update', {
            players: roster,
          });
          cb?.({
            ok: true,
            started: false,
            waitingFor: roomAfterReady.players.filter((id) => !roomAfterReady.matchStartReady.has(id)),
          });
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'unknown error';
        console.log('[player:ready] ERROR', { roomCode, socketId: socket.id, error: message });
        cb?.({ ok: false, error: message });
      }
    });
```

### `game:start` (L819–881)

```typescript
    socket.on('game:start', async (code, cb) => {
      const roomCode = String(code).trim().toUpperCase();
      console.log(`[game:start] socket=${socket.id}, code=${roomCode}`);
      try {
        const existingRoom = getRoom(roomCode);
        const playerSeatId = resolveActorSeatId(roomCode, socket);
        if (!existingRoom.players.includes(playerSeatId)) {
          if (typeof cb === 'function') cb({ ok: false, error: 'Only room players can start the game.' });
          return;
        }
        if (existingRoom.players[0] !== playerSeatId) {
          if (typeof cb === 'function') cb({ ok: false, error: 'Only the room host can start the game.' });
          return;
        }
        const liveCount = io.sockets.adapter.rooms.get(roomCode)?.size ?? 0;
        const rosterCount = (
          getRoomRoster(roomCode).length > 0 ? getRoomRoster(roomCode) :
          getRoomPlayersWithFallback(roomCode, existingRoom.players)
        ).length;
        if (liveCount < 2 || rosterCount < 2) {
          if (typeof cb === 'function') cb({ ok: false, error: 'waiting_for_players' });
          return;
        }
        markMatchStartReady(roomCode, playerSeatId);
        const startResult = await tryStartMatchIfReady(roomCode, io, buildMatchStartDeps(io));
        const roomForAudit = getRoom(roomCode);
        const auditPlayers = [...roomForAudit.players];
        const auditReady = [...roomForAudit.matchStartReady];
        const auditMissing = auditPlayers.filter((id) => !roomForAudit.matchStartReady.has(id));
        console.log('[game:start] matchStartReady audit', {
          roomCode,
          hostSeatId: playerSeatId,
          socketId: socket.id,
          roomPlayers: auditPlayers,
          matchStartReady: auditReady,
          missing: auditMissing,
          waitingFor: startResult.waitingFor ?? [],
          started: startResult.started,
        });
        if (!startResult.started) {
          const waitingFor = startResult.waitingFor ?? auditMissing;
          io.to(roomCode).emit('room:request_ready', {
            roomCode,
            waitingFor,
          });
          if (typeof cb === 'function') {
            cb({ ok: false, error: 'waiting_for_ready', waitingFor });
          }
          return;
        }
        const room = getRoom(roomCode);
        console.log(
          `[game:start] game started, handNumber=${room.state?.handNumber}, handOver=${room.state?.handOver}`,
        );
        handlerDeps.notifyRoomPlayersInGame(roomCode);
        await handlerDeps.onAfterMatchStarted(room);
        if (typeof cb === 'function') cb({ ok: true });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'unknown error';
        console.log(`[game:start] ERROR: ${message}`);
        if (typeof cb === 'function') cb({ ok: false, error: message });
      }
    });
```

---

## AFTER — full module (`registerMatchStartHandlers.ts`, 160 LOC)

```typescript
import type { Server, Socket } from 'socket.io';
import { getRoom } from '../rooms';
import { defaultEnginePersistence } from '../scheduledTournament/persistenceInterface';
import { promoteScheduledMatchToInProgress } from '../scheduledTournament/matchDispatch';
import { markMatchStartReady, tryStartMatchIfReady } from './matchStartReady';
import {
  buildMatchStartDeps,
  getRoomPlayersWithFallback,
  getRoomRoster,
  resolveActorSeatId,
  type AckFn,
  type RoomSessionHandlerDeps,
} from './roomSession';

export type RegisterMatchStartHandlersParams = {
  handlerDeps: RoomSessionHandlerDeps;
};

export function registerMatchStartHandlers(
  io: Server,
  socket: Socket,
  params: RegisterMatchStartHandlersParams,
): void {
  const { handlerDeps } = params;

  socket.on('player:ready', async (code: unknown, cb?: AckFn) => {
    const roomCode = String(code ?? '').trim().toUpperCase();
    try {
      const room = getRoom(roomCode);
      const playerSeatId = resolveActorSeatId(roomCode, socket);
      if (!room.players.includes(playerSeatId)) {
        console.log('[player:ready] rejected — seat not in room.players', {
          roomCode,
          playerSeatId,
          socketId: socket.id,
          roomPlayers: [...room.players],
          matchStartReady: [...room.matchStartReady],
        });
        cb?.({ ok: false, error: 'Only room players can ready up.' });
        return;
      }
      console.log('[player:ready] marking seat ready', {
        roomCode,
        playerSeatId,
        socketId: socket.id,
        roomPlayers: [...room.players],
        matchStartReadyBefore: [...room.matchStartReady],
      });
      markMatchStartReady(roomCode, playerSeatId);
      const roomAfterReady = getRoom(roomCode);
      console.log('[player:ready] matchStartReady after mark', {
        roomCode,
        playerSeatId,
        matchStartReady: [...roomAfterReady.matchStartReady],
      });
      const isPrivate = !roomAfterReady.matchmakingMatchId && !roomAfterReady.scheduledTournamentMatchId;
      if (!isPrivate) {
        const startResult = await tryStartMatchIfReady(roomCode, io, buildMatchStartDeps(io));
        if (startResult.started) {
          const started = getRoom(roomCode);
          if (started.scheduledTournamentMatchId) {
            const readyUserId = handlerDeps.normalizeUserId(socket.data?.userId);
            await promoteScheduledMatchToInProgress(
              started.scheduledTournamentMatchId,
              defaultEnginePersistence,
              new Date().toISOString(),
              readyUserId,
            );
          }
          handlerDeps.notifyRoomPlayersInGame(roomCode);
          await handlerDeps.onAfterMatchStarted(started);
        }
        cb?.({
          ok: true,
          started: startResult.started,
          waitingFor: startResult.waitingFor ?? [],
        });
      } else {
        const roster = getRoomRoster(roomCode).length > 0
          ? getRoomRoster(roomCode)
          : getRoomPlayersWithFallback(roomCode, roomAfterReady.players);
        io.to(roomCode).emit('room:update', {
          players: roster,
        });
        cb?.({
          ok: true,
          started: false,
          waitingFor: roomAfterReady.players.filter((id) => !roomAfterReady.matchStartReady.has(id)),
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown error';
      console.log('[player:ready] ERROR', { roomCode, socketId: socket.id, error: message });
      cb?.({ ok: false, error: message });
    }
  });

  socket.on('game:start', async (code, cb) => {
    const roomCode = String(code).trim().toUpperCase();
    console.log(`[game:start] socket=${socket.id}, code=${roomCode}`);
    try {
      const existingRoom = getRoom(roomCode);
      const playerSeatId = resolveActorSeatId(roomCode, socket);
      if (!existingRoom.players.includes(playerSeatId)) {
        if (typeof cb === 'function') cb({ ok: false, error: 'Only room players can start the game.' });
        return;
      }
      if (existingRoom.players[0] !== playerSeatId) {
        if (typeof cb === 'function') cb({ ok: false, error: 'Only the room host can start the game.' });
        return;
      }
      const liveCount = io.sockets.adapter.rooms.get(roomCode)?.size ?? 0;
      const rosterCount = (
        getRoomRoster(roomCode).length > 0 ? getRoomRoster(roomCode) :
        getRoomPlayersWithFallback(roomCode, existingRoom.players)
      ).length;
      if (liveCount < 2 || rosterCount < 2) {
        if (typeof cb === 'function') cb({ ok: false, error: 'waiting_for_players' });
        return;
      }
      markMatchStartReady(roomCode, playerSeatId);
      const startResult = await tryStartMatchIfReady(roomCode, io, buildMatchStartDeps(io));
      const roomForAudit = getRoom(roomCode);
      const auditPlayers = [...roomForAudit.players];
      const auditReady = [...roomForAudit.matchStartReady];
      const auditMissing = auditPlayers.filter((id) => !roomForAudit.matchStartReady.has(id));
      console.log('[game:start] matchStartReady audit', {
        roomCode,
        hostSeatId: playerSeatId,
        socketId: socket.id,
        roomPlayers: auditPlayers,
        matchStartReady: auditReady,
        missing: auditMissing,
        waitingFor: startResult.waitingFor ?? [],
        started: startResult.started,
      });
      if (!startResult.started) {
        const waitingFor = startResult.waitingFor ?? auditMissing;
        io.to(roomCode).emit('room:request_ready', {
          roomCode,
          waitingFor,
        });
        if (typeof cb === 'function') {
          cb({ ok: false, error: 'waiting_for_ready', waitingFor });
        }
        return;
      }
      const room = getRoom(roomCode);
      console.log(
        `[game:start] game started, handNumber=${room.state?.handNumber}, handOver=${room.state?.handOver}`,
      );
      handlerDeps.notifyRoomPlayersInGame(roomCode);
      await handlerDeps.onAfterMatchStarted(room);
      if (typeof cb === 'function') cb({ ok: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown error';
      console.log(`[game:start] ERROR: ${message}`);
      if (typeof cb === 'function') cb({ ok: false, error: message });
    }
  });
}
```

---

## AFTER — orchestrator registrar block (excerpt)

```typescript
  registerGameplayActionHandlers(io, socket, {
    handlerDeps,
  });
  registerMatchStartHandlers(io, socket, {
    handlerDeps,
  });
  registerRoomSpectateHandlers(socket, {
    handlerDeps,
    leaveExistingSocketRooms,
  });
  registerRoomUtilityHandlers(socket);
}
```

---

## New tests (`registerMatchStartHandlers.test.ts`, 133 LOC)

**2 tests added** (direct module coverage):

1. `game:start rejects non-host players` — host-seat guard (`players[0]` check).
2. `player:ready on private room emits room:update without auto-starting` — private branch (`isPrivate`) emits roster update, `started: false`, no auto-start.

**Existing integration suites still pass** (exercise `player:ready` / `game:start` via full `registerRoomSessionHandlers`):

| Suite | Coverage |
|-------|----------|
| `registerRoomSessionHandlers.private.test.ts` | Private ready + host `game:start` flow |
| `registerRoomSessionHandlers.privateRoomConfig.test.ts` | 14-tile deal after `game:start` |
| `handReadyGameplayLock.test.ts` | Ready/start setup before hand:ready lock tests |
| `tournamentHumanBotFlow.test.ts` | Tournament attach auto-start path |

---

## LOC arithmetic (checkable against Pass 3)

| File | Pass 3 end | Pass 4 end | Δ |
|------|------------|------------|---|
| `registerRoomSessionHandlers.ts` | 1,145 | **1,013** | **−132** |
| `registerMatchStartHandlers.ts` | — | 160 | +160 |
| `registerMatchStartHandlers.test.ts` | — | 133 | +133 |
| Pass 1–3 modules (frozen) | 428 | 428 | 0 |

Net handler extraction: −132 removed from orchestrator, +160 in new module = **+28** wrapper/import overhead.

### Test / build arithmetic

| Metric | Pass 3 end | Pass 4 end | Δ |
|--------|------------|------------|---|
| Server test files | 72 | **73** | +1 |
| Server tests | 502 | **504** | +2 |
| Build | pass | **pass** | — |

```bash
npm run build --prefix server
# exit 0

npm test --prefix server
# Test Files  73 passed (73)
# Tests       504 passed (504)
```

---

## Files changed

| File | Change |
|------|--------|
| `server/src/multiplayer/registerMatchStartHandlers.ts` | **Created** — `player:ready`, `game:start` |
| `server/src/multiplayer/registerMatchStartHandlers.test.ts` | **Created** — 2 unit tests |
| `server/src/multiplayer/registerRoomSessionHandlers.ts` | Removed inlined handlers; wired `registerMatchStartHandlers` |

**Not touched (frozen):**

- `matchStartReady.ts`, `rooms.ts`, `roomSession.ts`, `disconnectGrace.ts`, `index.ts`
- Pass 1–3 modules (`registerRoomUtilityHandlers`, `registerRoomSpectateHandlers`, `roomForfeit`, `registerRoomLifecycleHandlers`, `registerRoomAbandonHandlers`, `registerGameplayActionHandlers`) and their tests
- Frozen orchestrator closures/handlers: `attachSocketToTrackedRoom`, `leaveTrackedRoom`, `leaveExistingSocketRooms`, `room:join`, `tournament:attach_assigned_match`, `game:rematch`, `game:pregame_draw_pick`, `handleRoomPlayerDisconnect`
- All frozen client paths per task brief

**Blocking-finding check:** Extraction did **not** require modifying `attachSocketToTrackedRoom`, `matchStartReady.ts`, or any other frozen file. Proceed was safe.

---

## Remaining for Pass 5+

Per investigation risk ranking:

- **Pass 5 (#10):** `game:rematch` + `game:pregame_draw_pick`
- **Pass 6 (#11 highest):** `attachSocketToTrackedRoom` + `room:join` + `tournament:attach_assigned_match` + disconnect/`leaveTrackedRoom` integration

---

## Follow-up appendix — undisclosed diff correction + grep evidence

### F.1 `player:ready` post-mark log: `room` vs `roomAfterReady`

**Issue raised:** The original diff-callout table claimed zero differences, but the §BEFORE handler quote showed `matchStartReady: [...room.matchStartReady]` while the §AFTER quote showed `matchStartReady: [...roomAfterReady.matchStartReady]`.

**Correction — report transcription error, not an extraction edit:**

Live pre-extraction source (post–Pass-3 orchestrator, verified via `git diff` removed hunk and `git show HEAD` for the same handler) already reads `roomAfterReady.matchStartReady`:

```typescript
        markMatchStartReady(roomCode, playerSeatId);
        const roomAfterReady = getRoom(roomCode);
        console.log('[player:ready] matchStartReady after mark', {
          roomCode,
          playerSeatId,
          matchStartReady: [...roomAfterReady.matchStartReady],
        });
```

The §BEFORE block in this report incorrectly transcribed `room.matchStartReady` (typo). The extracted `registerMatchStartHandlers.ts` matches the live pre-extraction source on this line. **No code correction is required.**

**Reference equality proof — `room` and `roomAfterReady` are the same object at that log site:**

Sequence in `player:ready`:

1. `const room = getRoom(roomCode);` — first fetch.
2. `markMatchStartReady(roomCode, playerSeatId);` — mutates `room.matchStartReady` in place (no room replacement).
3. `const roomAfterReady = getRoom(roomCode);` — second fetch, no intervening `rooms.set` / `rooms.delete` for this code.

`rooms` is a process-wide `Map<RoomCode, Room>`; `getRoom` returns the stored reference without cloning:

```typescript
const rooms = new Map<RoomCode, Room>();
// ...

export function peekRoom(code: string): Room | undefined {
  const key = String(code ?? '').trim().toUpperCase();
  if (!key) return undefined;
  return rooms.get(key);
}

export function getRoom(code: string): Room {
  const room = peekRoom(code);
  if (!room) throw new Error('Room not found.');
  return room;
}
```

(`server/src/rooms.ts` L109, L297–307.)

`markMatchStartReady` fetches the same map entry and mutates the existing `Set` in place:

```typescript
export function markMatchStartReady(roomCode: string, socketId: string): Room {
  const room = getRoom(roomCode);
  room.matchStartReady.add(socketId);
  return room;
}
```

(`server/src/multiplayer/matchStartReady.ts` L13–17.)

**Conclusion:** After step 2, `room === roomAfterReady` (identical reference). `[...room.matchStartReady]` and `[...roomAfterReady.matchStartReady]` would produce the same spread contents. Using either variable name is a cosmetic textual choice only; the extraction did not change which Set is read. The diff-callout table above is corrected to disclose the report typo and reference equality; the prior “zero differences / verbatim move” claim stands for the **actual source**, not the erroneous §BEFORE transcription.

### F.2 Section 0.6 — raw grep terminal output

**Command 1:**

```bash
rg 'markMatchStartReady|matchStartReady' server/src/multiplayer/registerMatchStartHandlers.ts
```

**Raw output:**

```
import { markMatchStartReady, tryStartMatchIfReady } from './matchStartReady';
          matchStartReady: [...room.matchStartReady],
        matchStartReadyBefore: [...room.matchStartReady],
      markMatchStartReady(roomCode, playerSeatId);
      console.log('[player:ready] matchStartReady after mark', {
        matchStartReady: [...roomAfterReady.matchStartReady],
          waitingFor: roomAfterReady.players.filter((id) => !roomAfterReady.matchStartReady.has(id)),
      markMatchStartReady(roomCode, playerSeatId);
      const auditReady = [...roomForAudit.matchStartReady];
      const auditMissing = auditPlayers.filter((id) => !roomForAudit.matchStartReady.has(id));
      console.log('[game:start] matchStartReady audit', {
        matchStartReady: auditReady,
```

**Command 2:**

```bash
rg 'markMatchStartReady' server/src/multiplayer/registerRoomSessionHandlers.ts
```

**Raw output:**

```
import { markMatchStartReady, tryStartMatchIfReady } from './matchStartReady';
        markMatchStartReady(room.code, joinedPlayerSeatId);
          markMatchStartReady(room.code, attached.joinedPlayerSeatId);
```

**Interpretation:** Extracted module uses `markMatchStartReady` + `room.matchStartReady` reads only. Orchestrator retains `markMatchStartReady` solely in frozen MM auto-start (attach) and tournament attach paths — no duplicate/local ready state.