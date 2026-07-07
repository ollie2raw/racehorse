# Phase: `registerRoomSessionHandlers` Extraction Pass 5

**Date:** 2026-07-05  
**Scope:** Risk item #10 — `game:rematch`, `game:pregame_draw_pick`.  
**Continues from:** Pass 1–4 extraction reports. Pass 1–4 modules frozen.

---

## Step 0 — Verification before extracting

### 0.1 Pass 4 end-state reconciliation

| Claim (Pass 4) | Live check | Result |
|----------------|------------|--------|
| `registerRoomSessionHandlers.ts` = 1,013 LOC | `wc -l` → **1,013** | **Match** |
| Server tests = 504 / 73 files | Baseline from Pass 4 report | Starting point |

**No discrepancy** between Pass 4 claimed end state and live file at pass start.

### 0.2 Post–Pass-4 line ranges (pre-extraction this pass)

| Handler | Lines (post-Pass-4) |
|---------|---------------------|
| `game:rematch` | L748–832 |
| `game:pregame_draw_pick` | L834–951 |

### 0.3 `withRoomGameplayLock` usage (live pre-extraction)

Unlike `game:action` / `hand:ready` (lock internal to `act()` / `readyForNextHand()` in `rooms.ts`), **both handlers in this pass call `withRoomGameplayLock` directly.**

**`game:rematch` — single lock around reset + `initiatePregameDrawOrStart`:**

```typescript
        await withRoomGameplayLock(roomCode, async () => {
          const lockedRoom = getRoom(roomCode);
          lockedRoom.matchLogged = false;
          lockedRoom.leadTracker = {
            aId: lockedRoom.players[0],
            bId: lockedRoom.players[1],
            maxLeadA: 0,
            maxLeadB: 0,
          };
          try {
            await handlerDeps.persistRoomMatchLog(
              lockedRoom,
              lockedRoom.state?.gameOver ? 'completed' : 'abandoned',
            );
          } catch (error) {
            console.error('[room-match-logs] failed to archive room before rematch reset:', error);
          }
          resetRoomEventLog(lockedRoom);
          appendRoomEvent(lockedRoom, {
            type: 'rematch_started',
            actorSocketId: socket.id,
            actorUserId: handlerDeps.normalizeUserId(socket.data?.userId),
            payload: {
              players: [...lockedRoom.players],
            },
          });
          await initiatePregameDrawOrStart(lockedRoom.code, io, { allowRestart: true });
        });
```

**`game:pregame_draw_pick` — outer lock + three nested timer locks:**

```typescript
      withRoomGameplayLock(roomCode, async () => { /* pick FSM body */ });
```

Nested inside tie timer (L878–894 pre-extraction):

```typescript
              withRoomGameplayLock(roomCode, async () => {
                const innerRoom = getRoom(roomCode);
                const innerDraw = innerRoom.preGameDraw;
                if (!innerDraw || innerDraw.phase !== 'showing-tie') return;
                // ...
              });
```

Nested inside reveal timer (L906–942) and result timer (L916–940).

### 0.4 `game:rematch:started` emit ordering relative to `broadcastStateUpdate` (verbatim, live pre-extraction)

**Post-lock, unconditional, synchronous ordering — no `await` between the two calls:**

```typescript
        const roomAfterRematch = getRoom(roomCode);
        // game:rematch:started MUST be emitted before broadcastStateUpdate so the
        // client resets its sequence watermark before the first state:update of
        // the new game arrives. If the order is reversed, a client whose watermark
        // is still at the old game's final sequence number will silently discard
        // the new game state as stale, leaving the board frozen.
        io.to(roomAfterRematch.code).emit('game:rematch:started', { roomCode: roomAfterRematch.code });
        broadcastStateUpdate(roomAfterRematch.code);
        emitRematchStatus(roomAfterRematch.code);
        cb?.({ ok: true, started: true });
```

**Confirmation:** This is a **single unconditional ordering** on the success path (`bothReady` branch after lock completes). No conditional reordering; `emitRematchStatus` follows `broadcastStateUpdate` (unchanged from before).

### 0.5 `waitForActiveGameOverPersist` position (verbatim, live pre-extraction)

**After quorum check, before gameplay lock:**

```typescript
        room.rematchReady.clear();
        await waitForActiveGameOverPersist(room.code);

        await withRoomGameplayLock(roomCode, async () => {
```

### 0.6 `game:pregame_draw_pick` guards (verbatim, live pre-extraction)

**Entry guards:**

```typescript
      const slotId = payload?.slotId;
      const roomCode = socket.data?.roomId;
      if (!slotId) return;
      if (!roomCode) return;
```

**Per-pick lock (one pick per player):**

```typescript
        if (preGameDraw.picks[playerSeatId] !== null) return;
```

**Invalid slot fallback:**

```typescript
        let slot = preGameDraw.tiles.find((t) => t.id === slotId);
        if (!slot || slot.outOfPlay || slot.revealed) {
          slot = preGameDraw.tiles.find((t) => !t.revealed && !t.outOfPlay);
        }
        if (!slot) return;
```

**Tie timer `innerDraw.phase` guard (L882):**

```typescript
                if (!innerDraw || innerDraw.phase !== 'showing-tie') return;
```

**Reveal timer `innerDraw.phase` guard (L909):**

```typescript
                if (!innerDraw || innerDraw.phase !== 'showing-reveal') return;
```

**Result timer `finalDraw.phase` guard (L919):**

```typescript
                    if (!finalDraw || finalDraw.phase !== 'showing-result') return;
```

**Timer delays preserved:** tie redraw `800ms`; reveal→result `2000ms`; result→`startGame` `1000ms`.

### 0.7 Orchestrator closure dependencies for DI scoping

| Symbol | Source in orchestrator | Needed by extracted handlers? |
|--------|------------------------|-------------------------------|
| `io` | `registerRoomSessionHandlers(io, socket)` param | **Yes** — first arg to `registerRematchPregameHandlers` |
| `handlerDeps` | `requireRoomSessionHandlerDeps()` | **Yes** — `{ handlerDeps }` params (`normalizeUserId`, `persistRoomMatchLog`) |
| `leaveTrackedRoom` / `attachSocketToTrackedRoom` / etc. | internal closures | **No** |

**No ref bridges.** `startGame` and `initiatePregameDrawOrStart` imported from `../rooms` in the new module (existing exported functions — `rooms.ts` not modified).

### 0.8 Cross-file `preGameDraw` / timer references (grep, orchestrator only)

```bash
rg 'preGameDraw|roomCleanupTimers' server/src/multiplayer/registerRoomSessionHandlers.ts
```

| Match | Line | Context |
|-------|------|---------|
| `room.preGameDraw` | L436 | **Frozen** `attachSocketToTrackedRoom` — `if (room.state && !room.preGameDraw)` gates `hand:ended` rejoin replay |

**`room.preGameDrawTimer`:** No reads/writes outside the two extracted handlers in this file.

**`roomCleanupTimersByCode`:** No direct references in `registerRoomSessionHandlers.ts` (lifecycle cleanup via `evaluateRoomLifecycle` / `cancelRoomCleanup` in frozen `leaveTrackedRoom` only).

---

## Extraction summary

### New file

`server/src/multiplayer/registerRematchPregameHandlers.ts` — exports `registerRematchPregameHandlers(io, socket, { handlerDeps })`.

### Orchestrator wiring (AFTER)

```typescript
import { registerRematchPregameHandlers } from './registerRematchPregameHandlers';
```

```typescript
  registerRematchPregameHandlers(io, socket, {
    handlerDeps,
  });
```

**Removed orchestrator imports (only used by extracted handlers):** `resetRoomEventLog`, `startGame`, `initiatePregameDrawOrStart`, `withRoomGameplayLock`, `emitRematchStatus`, `waitForActiveGameOverPersist`.

**Frozen paths untouched:** `attachSocketToTrackedRoom`, `leaveTrackedRoom`, `leaveExistingSocketRooms`, `room:join`, `tournament:attach_assigned_match`, `handleRoomPlayerDisconnect`.

### Proactive token-level diff verification (BEFORE vs AFTER)

Compared pre-extraction handler bodies (git removed hunk, 4-space nested indent) against `registerRematchPregameHandlers.ts` (2-space module indent) statement-by-statement:

| Aspect | Change? |
|--------|---------|
| Guard evaluation order | **No change** |
| `waitForActiveGameOverPersist` await point | **No change** |
| Locked reset + `initiatePregameDrawOrStart` sequence | **No change** |
| `game:rematch:started` → `broadcastStateUpdate` → `emitRematchStatus` ordering | **No change** — still synchronous, unconditional on success path |
| Per-pick guard `preGameDraw.picks[playerSeatId] !== null` | **No change** |
| Tie/reveal/result timer delays (800 / 2000 / 1000 ms) | **No change** |
| All three `innerDraw.phase` / `finalDraw.phase` stale-timeout guards | **No change** |
| Handler statement order | **No change** |
| Indentation | **Only cosmetic** — 4-space nested → 2-space module |

**No logic, guard, sequencing, or emit-order differences in the extracted source.**

---

## BEFORE — full handler bodies (pre-extraction, `registerRoomSessionHandlers.ts` L748–951)

### `game:rematch` (L748–832)

```typescript
    socket.on('game:rematch', async (code: unknown, cb?: AckFn) => {
      const roomCode = String(code ?? '').trim().toUpperCase();
      try {
        const room = getRoom(roomCode);
        const cfg = (room as any).config ?? {};

        if (cfg.tournamentId) {
          return cb?.({ ok: false, error: 'Rematch is unavailable in tournament rooms.' });
        }
        const playerSeatId = resolveActorSeatId(roomCode, socket);
        if (!room.players.includes(playerSeatId)) {
          return cb?.({ ok: false, error: 'Only room players can request rematch.' });
        }
        if (!room.state) {
          return cb?.({ ok: false, error: 'Game not started.' });
        }
        if (!room.state.gameOver) {
          return cb?.({ ok: false, error: 'Rematch is only available after game over.' });
        }

        room.rematchReady.add(playerSeatId);
        appendRoomEvent(room, {
          type: 'rematch_requested',
          actorSocketId: socket.id,
          actorUserId: handlerDeps.normalizeUserId(socket.data?.userId),
          payload: {
            readyCount: room.rematchReady.size,
            requiredCount: room.players.length,
          },
        });
        emitRematchStatus(room.code);

        const bothReady =
          room.players.length === 2 && room.players.every((playerId) => room.rematchReady.has(playerId));
        if (!bothReady) {
          return cb?.({ ok: true, started: false });
        }

        room.rematchReady.clear();
        await waitForActiveGameOverPersist(room.code);

        await withRoomGameplayLock(roomCode, async () => {
          const lockedRoom = getRoom(roomCode);
          lockedRoom.matchLogged = false;
          lockedRoom.leadTracker = {
            aId: lockedRoom.players[0],
            bId: lockedRoom.players[1],
            maxLeadA: 0,
            maxLeadB: 0,
          };
          try {
            await handlerDeps.persistRoomMatchLog(
              lockedRoom,
              lockedRoom.state?.gameOver ? 'completed' : 'abandoned',
            );
          } catch (error) {
            console.error('[room-match-logs] failed to archive room before rematch reset:', error);
          }
          resetRoomEventLog(lockedRoom);
          appendRoomEvent(lockedRoom, {
            type: 'rematch_started',
            actorSocketId: socket.id,
            actorUserId: handlerDeps.normalizeUserId(socket.data?.userId),
            payload: {
              players: [...lockedRoom.players],
            },
          });
          await initiatePregameDrawOrStart(lockedRoom.code, io, { allowRestart: true });
        });

        const roomAfterRematch = getRoom(roomCode);
        // game:rematch:started MUST be emitted before broadcastStateUpdate so the
        // client resets its sequence watermark before the first state:update of
        // the new game arrives. If the order is reversed, a client whose watermark
        // is still at the old game's final sequence number will silently discard
        // the new game state as stale, leaving the board frozen.
        io.to(roomAfterRematch.code).emit('game:rematch:started', { roomCode: roomAfterRematch.code });
        broadcastStateUpdate(roomAfterRematch.code);
        emitRematchStatus(roomAfterRematch.code);
        cb?.({ ok: true, started: true });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'unknown error';
        cb?.({ ok: false, error: message });
      }
    });
```

### `game:pregame_draw_pick` (L834–951)

```typescript
    socket.on('game:pregame_draw_pick', (payload?: { slotId?: string }) => {
      const slotId = payload?.slotId;
      const roomCode = socket.data?.roomId;
      if (!slotId) return;
      if (!roomCode) return;

      withRoomGameplayLock(roomCode, async () => {
        const room = getRoom(roomCode);
        const playerSeatId = resolveActorSeatId(roomCode, socket);
        const preGameDraw = room.preGameDraw;
        if (!preGameDraw) return;
        if (preGameDraw.picks[playerSeatId] !== null) return;

        let slot = preGameDraw.tiles.find((t) => t.id === slotId);
        if (!slot || slot.outOfPlay || slot.revealed) {
          slot = preGameDraw.tiles.find((t) => !t.revealed && !t.outOfPlay);
        }
        if (!slot) return;

        // Record the pick
        slot.revealed = true;
        slot.pickedBy = playerSeatId;
        preGameDraw.picks[playerSeatId] = {
          slotId: slot.id,
          tile: slot.tile,
          pipSum: slot.tile.low + slot.tile.high,
        };

        const players = room.players;
        const opponentSeatId = players.find((id) => id !== playerSeatId) ?? '';
        const ownPick = preGameDraw.picks[playerSeatId];
        const oppPick = preGameDraw.picks[opponentSeatId];

        const bothPicked = ownPick !== null && oppPick !== null;

        if (bothPicked) {
          // Both have picked! Compare pips.
          if (ownPick.pipSum === oppPick.pipSum) {
            // It's a tie!
            preGameDraw.phase = 'showing-tie';
            broadcastStateUpdate(roomCode);

            // Schedule tie-hold redraw
            if (room.preGameDrawTimer) clearTimeout(room.preGameDrawTimer);
            room.preGameDrawTimer = setTimeout(() => {
              withRoomGameplayLock(roomCode, async () => {
                const innerRoom = getRoom(roomCode);
                const innerDraw = innerRoom.preGameDraw;
                if (!innerDraw || innerDraw.phase !== 'showing-tie') return;

                // Eliminate the 2 picked tiles
                innerDraw.tiles.forEach((t) => {
                  if (t.revealed) {
                    t.outOfPlay = true;
                    t.revealed = false;
                  }
                });
                innerDraw.picks = Object.fromEntries(innerRoom.players.map((pid) => [pid, null]));
                innerDraw.phase = 'pick-player';
                broadcastStateUpdate(roomCode);
              });
            }, 800);
          } else {
            // We have a winner!
            const winnerSeatId = ownPick.pipSum > oppPick.pipSum ? playerSeatId : opponentSeatId;
            preGameDraw.winnerId = winnerSeatId;
            preGameDraw.phase = 'showing-reveal';
            broadcastStateUpdate(roomCode);

            // Stagger timeouts to resolved then done/startGame
            if (room.preGameDrawTimer) clearTimeout(room.preGameDrawTimer);
            room.preGameDrawTimer = setTimeout(() => {
              withRoomGameplayLock(roomCode, async () => {
                const innerRoom = getRoom(roomCode);
                const innerDraw = innerRoom.preGameDraw;
                if (!innerDraw || innerDraw.phase !== 'showing-reveal') return;

                innerDraw.phase = 'showing-result';
                broadcastStateUpdate(roomCode);

                if (innerRoom.preGameDrawTimer) clearTimeout(innerRoom.preGameDrawTimer);
                innerRoom.preGameDrawTimer = setTimeout(() => {
                  withRoomGameplayLock(roomCode, async () => {
                    const finalRoom = getRoom(roomCode);
                    const finalDraw = finalRoom.preGameDraw;
                    if (!finalDraw || finalDraw.phase !== 'showing-result') return;

                    // Remaining deck (excluding the 2 picked tiles)
                    const remainingDeck = finalDraw.tiles
                      .filter((t) => !t.revealed && !t.outOfPlay)
                      .map((t) => t.tile);

                    // Clear preGameDraw properties before starting game to avoid loops
                    if (finalRoom.preGameDrawTimer) {
                      clearTimeout(finalRoom.preGameDrawTimer);
                      finalRoom.preGameDrawTimer = null;
                    }
                    finalRoom.preGameDraw = null;

                    // Deal hand 1 and start gameplay!
                    await startGame(roomCode, io, {
                      customDeck: remainingDeck,
                      startingPlayerId: winnerSeatId,
                      allowRestart: true,
                    });
                    broadcastStateUpdate(roomCode);
                  });
                }, 1000);
              });
            }, 2000);
          }
        } else {
          // Only one player picked, wait for opponent
          preGameDraw.phase = 'pick-opponent';
          broadcastStateUpdate(roomCode);
        }
      });
    });
```

---

## AFTER — full module (`registerRematchPregameHandlers.ts`, 228 LOC)

```typescript
import type { Server, Socket } from 'socket.io';
import { appendRoomEvent, resetRoomEventLog } from '../roomEvents';
import { getRoom, initiatePregameDrawOrStart, startGame } from '../rooms';
import { withRoomGameplayLock } from './roomGameplayLock';
import {
  broadcastStateUpdate,
  emitRematchStatus,
  resolveActorSeatId,
  waitForActiveGameOverPersist,
  type AckFn,
  type RoomSessionHandlerDeps,
} from './roomSession';

export type RegisterRematchPregameHandlersParams = {
  handlerDeps: RoomSessionHandlerDeps;
};

export function registerRematchPregameHandlers(
  io: Server,
  socket: Socket,
  params: RegisterRematchPregameHandlersParams,
): void {
  const { handlerDeps } = params;

  socket.on('game:rematch', async (code: unknown, cb?: AckFn) => {
    const roomCode = String(code ?? '').trim().toUpperCase();
    try {
      const room = getRoom(roomCode);
      const cfg = (room as any).config ?? {};

      if (cfg.tournamentId) {
        return cb?.({ ok: false, error: 'Rematch is unavailable in tournament rooms.' });
      }
      const playerSeatId = resolveActorSeatId(roomCode, socket);
      if (!room.players.includes(playerSeatId)) {
        return cb?.({ ok: false, error: 'Only room players can request rematch.' });
      }
      if (!room.state) {
        return cb?.({ ok: false, error: 'Game not started.' });
      }
      if (!room.state.gameOver) {
        return cb?.({ ok: false, error: 'Rematch is only available after game over.' });
      }

      room.rematchReady.add(playerSeatId);
      appendRoomEvent(room, {
        type: 'rematch_requested',
        actorSocketId: socket.id,
        actorUserId: handlerDeps.normalizeUserId(socket.data?.userId),
        payload: {
          readyCount: room.rematchReady.size,
          requiredCount: room.players.length,
        },
      });
      emitRematchStatus(room.code);

      const bothReady =
        room.players.length === 2 && room.players.every((playerId) => room.rematchReady.has(playerId));
      if (!bothReady) {
        return cb?.({ ok: true, started: false });
      }

      room.rematchReady.clear();
      await waitForActiveGameOverPersist(room.code);

      await withRoomGameplayLock(roomCode, async () => {
        const lockedRoom = getRoom(roomCode);
        lockedRoom.matchLogged = false;
        lockedRoom.leadTracker = {
          aId: lockedRoom.players[0],
          bId: lockedRoom.players[1],
          maxLeadA: 0,
          maxLeadB: 0,
        };
        try {
          await handlerDeps.persistRoomMatchLog(
            lockedRoom,
            lockedRoom.state?.gameOver ? 'completed' : 'abandoned',
          );
        } catch (error) {
          console.error('[room-match-logs] failed to archive room before rematch reset:', error);
        }
        resetRoomEventLog(lockedRoom);
        appendRoomEvent(lockedRoom, {
          type: 'rematch_started',
          actorSocketId: socket.id,
          actorUserId: handlerDeps.normalizeUserId(socket.data?.userId),
          payload: {
            players: [...lockedRoom.players],
          },
        });
        await initiatePregameDrawOrStart(lockedRoom.code, io, { allowRestart: true });
      });

      const roomAfterRematch = getRoom(roomCode);
      // game:rematch:started MUST be emitted before broadcastStateUpdate so the
      // client resets its sequence watermark before the first state:update of
      // the new game arrives. If the order is reversed, a client whose watermark
      // is still at the old game's final sequence number will silently discard
      // the new game state as stale, leaving the board frozen.
      io.to(roomAfterRematch.code).emit('game:rematch:started', { roomCode: roomAfterRematch.code });
      broadcastStateUpdate(roomAfterRematch.code);
      emitRematchStatus(roomAfterRematch.code);
      cb?.({ ok: true, started: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown error';
      cb?.({ ok: false, error: message });
    }
  });

  socket.on('game:pregame_draw_pick', (payload?: { slotId?: string }) => {
    const slotId = payload?.slotId;
    const roomCode = socket.data?.roomId;
    if (!slotId) return;
    if (!roomCode) return;

    withRoomGameplayLock(roomCode, async () => {
      const room = getRoom(roomCode);
      const playerSeatId = resolveActorSeatId(roomCode, socket);
      const preGameDraw = room.preGameDraw;
      if (!preGameDraw) return;
      if (preGameDraw.picks[playerSeatId] !== null) return;

      let slot = preGameDraw.tiles.find((t) => t.id === slotId);
      if (!slot || slot.outOfPlay || slot.revealed) {
        slot = preGameDraw.tiles.find((t) => !t.revealed && !t.outOfPlay);
      }
      if (!slot) return;

      // Record the pick
      slot.revealed = true;
      slot.pickedBy = playerSeatId;
      preGameDraw.picks[playerSeatId] = {
        slotId: slot.id,
        tile: slot.tile,
        pipSum: slot.tile.low + slot.tile.high,
      };

      const players = room.players;
      const opponentSeatId = players.find((id) => id !== playerSeatId) ?? '';
      const ownPick = preGameDraw.picks[playerSeatId];
      const oppPick = preGameDraw.picks[opponentSeatId];

      const bothPicked = ownPick !== null && oppPick !== null;

      if (bothPicked) {
        // Both have picked! Compare pips.
        if (ownPick.pipSum === oppPick.pipSum) {
          // It's a tie!
          preGameDraw.phase = 'showing-tie';
          broadcastStateUpdate(roomCode);

          // Schedule tie-hold redraw
          if (room.preGameDrawTimer) clearTimeout(room.preGameDrawTimer);
          room.preGameDrawTimer = setTimeout(() => {
            withRoomGameplayLock(roomCode, async () => {
              const innerRoom = getRoom(roomCode);
              const innerDraw = innerRoom.preGameDraw;
              if (!innerDraw || innerDraw.phase !== 'showing-tie') return;

              // Eliminate the 2 picked tiles
              innerDraw.tiles.forEach((t) => {
                if (t.revealed) {
                  t.outOfPlay = true;
                  t.revealed = false;
                }
              });
              innerDraw.picks = Object.fromEntries(innerRoom.players.map((pid) => [pid, null]));
              innerDraw.phase = 'pick-player';
              broadcastStateUpdate(roomCode);
            });
          }, 800);
        } else {
          // We have a winner!
          const winnerSeatId = ownPick.pipSum > oppPick.pipSum ? playerSeatId : opponentSeatId;
          preGameDraw.winnerId = winnerSeatId;
          preGameDraw.phase = 'showing-reveal';
          broadcastStateUpdate(roomCode);

          // Stagger timeouts to resolved then done/startGame
          if (room.preGameDrawTimer) clearTimeout(room.preGameDrawTimer);
          room.preGameDrawTimer = setTimeout(() => {
            withRoomGameplayLock(roomCode, async () => {
              const innerRoom = getRoom(roomCode);
              const innerDraw = innerRoom.preGameDraw;
              if (!innerDraw || innerDraw.phase !== 'showing-reveal') return;

              innerDraw.phase = 'showing-result';
              broadcastStateUpdate(roomCode);

              if (innerRoom.preGameDrawTimer) clearTimeout(innerRoom.preGameDrawTimer);
              innerRoom.preGameDrawTimer = setTimeout(() => {
                withRoomGameplayLock(roomCode, async () => {
                  const finalRoom = getRoom(roomCode);
                  const finalDraw = finalRoom.preGameDraw;
                  if (!finalDraw || finalDraw.phase !== 'showing-result') return;

                  // Remaining deck (excluding the 2 picked tiles)
                  const remainingDeck = finalDraw.tiles
                    .filter((t) => !t.revealed && !t.outOfPlay)
                    .map((t) => t.tile);

                  // Clear preGameDraw properties before starting game to avoid loops
                  if (finalRoom.preGameDrawTimer) {
                    clearTimeout(finalRoom.preGameDrawTimer);
                    finalRoom.preGameDrawTimer = null;
                  }
                  finalRoom.preGameDraw = null;

                  // Deal hand 1 and start gameplay!
                  await startGame(roomCode, io, {
                    customDeck: remainingDeck,
                    startingPlayerId: winnerSeatId,
                    allowRestart: true,
                  });
                  broadcastStateUpdate(roomCode);
                });
              }, 1000);
            });
          }, 2000);
        }
      } else {
        // Only one player picked, wait for opponent
        preGameDraw.phase = 'pick-opponent';
        broadcastStateUpdate(roomCode);
      }
    });
  });
}
```

---

## AFTER — orchestrator registrar block (excerpt)

```typescript
  registerMatchStartHandlers(io, socket, {
    handlerDeps,
  });
  registerRematchPregameHandlers(io, socket, {
    handlerDeps,
  });
  registerRoomSpectateHandlers(socket, {
    handlerDeps,
    leaveExistingSocketRooms,
  });
```

---

## New tests (`registerRematchPregameHandlers.test.ts`, 224 LOC)

| Test | Coverage |
|------|----------|
| `game:rematch rejects tournament rooms` | `cfg.tournamentId` guard |
| `game:rematch rejects when game is not over` | `!room.state.gameOver` guard |
| `game:rematch emits game:rematch:started before broadcastStateUpdate when both ready` | **Ordering invariant** — `io.emit:game:rematch:started` index precedes next `broadcastStateUpdate` |
| `game:pregame_draw_pick no-ops without slotId` | Entry guard |
| `game:pregame_draw_pick rejects duplicate pick per player` | Per-pick lock `picks[playerSeatId] !== null` |

**Existing integration suites (all pass):**

- `handReadyGameplayLock.test.ts` — gameplay lock nesting at hand boundary
- `registerRoomSessionHandlers.private.test.ts`, `.abandon.test.ts`, `.tournament.test.ts`
- All Pass 1–4 module tests

---

## LOC arithmetic (checkable against Pass 4)

| File | Pass 4 end | Pass 5 end | Δ |
|------|------------|------------|---|
| `registerRoomSessionHandlers.ts` | 1,013 | **806** | **−207** |
| `registerRematchPregameHandlers.ts` | — | 228 | +228 |
| `registerRematchPregameHandlers.test.ts` | — | 224 | +224 |
| Pass 1–4 modules (frozen) | — | — | 0 (unchanged) |

Net handler extraction: −207 removed, +228 in new module = **+21** wrapper/import overhead.

### Test / build arithmetic

| Metric | Pass 4 end | Pass 5 end | Δ |
|--------|------------|------------|---|
| Server test files | 73 | **74** | +1 |
| Server tests | 504 | **509** | +5 |
| Build | pass | **pass** | — |

```bash
npm run build --prefix server
# exit 0

npm test --prefix server
# Test Files  74 passed (74)
# Tests       509 passed (509)
```

---

## Files changed

| File | Change |
|------|--------|
| `server/src/multiplayer/registerRematchPregameHandlers.ts` | **Created** — `game:rematch`, `game:pregame_draw_pick` |
| `server/src/multiplayer/registerRematchPregameHandlers.test.ts` | **Created** — 5 unit tests |
| `server/src/multiplayer/registerRoomSessionHandlers.ts` | Removed inlined handlers; wired registrar; pruned imports |

**Not touched (frozen):**

- `roomGameplayLock.ts`, `rooms.ts`, `roomSession.ts`, `matchStartReady.ts`, `disconnectGrace.ts`, `index.ts`
- Pass 1–4 modules and their tests
- Frozen orchestrator closures/handlers: `attachSocketToTrackedRoom`, `leaveTrackedRoom`, `leaveExistingSocketRooms`, `room:join`, `tournament:attach_assigned_match`, `handleRoomPlayerDisconnect`
- All frozen client paths per task brief

**Blocking-finding check:** Extraction did **not** require modifying `roomGameplayLock.ts`, `rooms.ts`, or any later-pass handler/closure. Proceed was safe.

---

## Remaining for Pass 6

Per investigation risk ranking:

- **Pass 6 (#11 highest):** `attachSocketToTrackedRoom` + `room:join` + `tournament:attach_assigned_match` + disconnect/`leaveTrackedRoom` integration