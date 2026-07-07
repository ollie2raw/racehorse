# Phase: `registerRoomSessionHandlers` Extraction Pass 1

**Date:** 2026-07-05  
**Scope:** Risk items #1–3 from `docs/phase-roomsessionhandlers-investigation-report.md` §8 — `mp:ping` + `player:dragging`, `room:spectate`, `applyActiveMatchForfeit` → `roomForfeit.ts`.  
**Frozen respected:** `index.ts` untouched; `disconnectGrace.ts` — import path only; all later-pass handlers/closures in `registerRoomSessionHandlers.ts` untouched.

---

## Step 0 — Verification before extracting

### 0.1 Consumer grep (`applyActiveMatchForfeit` / `handleRoomPlayerDisconnect`)

**Command:**

```bash
rg 'applyActiveMatchForfeit|handleRoomPlayerDisconnect' server/src
```

**Results:**

| Symbol | File | Role |
|--------|------|------|
| `applyActiveMatchForfeit` | `registerRoomSessionHandlers.ts` | Definition (now re-export) + internal calls in `leaveTrackedRoom`, `room:abandon_match` |
| `applyActiveMatchForfeit` | `disconnectGrace.ts:116` | Dynamic `require` on 2nd disconnect-grace expiry |
| `handleRoomPlayerDisconnect` | `registerRoomSessionHandlers.ts` | Definition |
| `handleRoomPlayerDisconnect` | `index.ts:197,680` | Import + `disconnect` handler |

**Conclusion:** No consumers beyond investigation report. `applyActiveMatchForfeit` has **no** direct importers outside `registerRoomSessionHandlers` + `disconnectGrace`; re-export from `registerRoomSessionHandlers.ts` preserves any `import { applyActiveMatchForfeit } from './registerRoomSessionHandlers'` path (none found). `handleRoomPlayerDisconnect` consumer is **only** `index.ts`.

### 0.2 Line-range re-confirmation (live file at pass start)

| Item | Investigation report | Live file at pass start | Discrepancy |
|------|---------------------|-------------------------|-------------|
| `applyActiveMatchForfeit` | L81–179 | L81–179 | None |
| `room:spectate` | L624–689 | L624–689 | None |
| `mp:ping` | L1223–1225 | L1223–1225 | None |
| `player:dragging` | L1524–1538 | L1524–1538 | None |

**Total file LOC before:** 1,580 (`wc -l`).

### 0.3 Blocking-scope check

| Required touch | Allowed? | Action |
|----------------|----------|--------|
| `index.ts` | No | Not modified |
| `disconnectGrace.ts` import path | Yes (one line) | `require('./roomForfeit')` |
| Other frozen server modules | No | Not modified |

**No blocking findings.**

---

## Extraction 1 — `mp:ping` + `player:dragging` → `registerRoomUtilityHandlers.ts`

**Module choice:** Separate utility file per investigation §7.2. Kept spectate in its own file (not folded in) because spectate depends on `handlerDeps`, `leaveExistingSocketRooms`, and event/roster helpers — materially more than `getRoom` / `resolveActorSeatId`.

### Before (inlined in `registerRoomSessionHandlers.ts`)

```typescript
    socket.on('mp:ping', (_sentAt: unknown, cb?: (serverAt: number) => void) => {
      if (typeof cb === 'function') cb(Date.now());
    });
```

```typescript
    socket.on('player:dragging', (code: unknown, payload?: { dragging?: boolean }) => {
      const roomCode = String(code ?? '').trim().toUpperCase();
      if (!roomCode) return;
      try {
        const room = getRoom(roomCode);
        const playerSeatId = resolveActorSeatId(roomCode, socket);
        if (!room.players.includes(playerSeatId)) return;
        socket.to(roomCode).emit('player:dragging', {
          playerId: playerSeatId,
          dragging: Boolean(payload?.dragging),
        });
      } catch {
        // ignore invalid room
      }
    });
```

### After (`registerRoomUtilityHandlers.ts`)

```typescript
export function registerRoomUtilityHandlers(socket: Socket): void {
  socket.on('mp:ping', (_sentAt: unknown, cb?: (serverAt: number) => void) => {
    if (typeof cb === 'function') cb(Date.now());
  });

  socket.on('player:dragging', (code: unknown, payload?: { dragging?: boolean }) => {
    const roomCode = String(code ?? '').trim().toUpperCase();
    if (!roomCode) return;
    try {
      const room = getRoom(roomCode);
      const playerSeatId = resolveActorSeatId(roomCode, socket);
      if (!room.players.includes(playerSeatId)) return;
      socket.to(roomCode).emit('player:dragging', {
        playerId: playerSeatId,
        dragging: Boolean(payload?.dragging),
      });
    } catch {
      // ignore invalid room
    }
  });
}
```

### Orchestrator wiring (after)

```typescript
  registerRoomUtilityHandlers(socket);
```

**Equivalence:** Same event strings, callback guard, `Date.now()` timestamp, room code normalization, `getRoom` / `resolveActorSeatId` / `room.players.includes` guards, `socket.to(roomCode).emit('player:dragging', { playerId, dragging })` payload, silent catch on invalid room.

**DI:** `socket` passed explicitly — no `io`, no `handlerDeps`, no socket property stash.

---

## Extraction 2 — `room:spectate` → `registerRoomSpectateHandlers.ts`

### Before (inlined)

```typescript
  socket.on('room:spectate', async (argCode: unknown, arg2?: unknown, arg3?: unknown) => {
      const cb = (
        typeof arg3 === 'function' ? arg3 : typeof arg2 === 'function' ? arg2 : undefined
      ) as AckFn | undefined;
      const config =
        arg2 && typeof arg2 === 'object' && !Array.isArray(arg2) ? (arg2 as RoomJoinConfig) : {};
      const code = String(argCode ?? '').trim().toUpperCase();
      try {
        const { username, userId } = await handlerDeps.resolveSocketIdentity(config);
        if (!code) return cb?.({ ok: false, error: 'missing_code' });
        clearSocketRematchReady((socket.data?.roomId as string | undefined) ?? undefined, socket.id);
        leaveExistingSocketRooms();

        let room: Room | null = null;
        try {
          room = getRoom(code);
        } catch {
          return cb?.({ ok: false, error: 'not_found' });
        }
        if (room.abandonedAt) {
          return cb?.({ ok: false, error: 'match_abandoned' });
        }

        // Socket room only — DO NOT join the game engine.
        socket.join(code);
        socket.data.roomId = code;
        socket.data.username = username;
        socket.data.userId = userId;
        socket.data.playerId = socket.id;

        const roster = getRoomRoster(code);
        socket.emit('room:update', { players: roster });

        if (room.state) {
          const specMasked = maskStateForRecipient(room.state, null);
          socket.emit('state:update', {
            state: { ...specMasked, handCounts: getHandCounts(room.state) },
            legalMoves: [],
            canDraw: false,
            eventMeta: getRoomMatchEventMeta(code),
            matchStarted: true,
          });
        }

        appendRoomEvent(room, {
          type: 'spectator_joined',
          actorSocketId: socket.id,
          actorUserId: userId,
          payload: { username },
        });

        cb?.({
          ok: true,
          roomCode: code,
          players: roster,
          eventMeta: getRoomMatchEventMeta(code),
          matchStarted: Boolean(room.state),
        });
      } catch (e) {
        cb?.({ ok: false, error: 'spectate_failed' });
      }
    });
```

### After (`registerRoomSpectateHandlers.ts`)

Handler body is **byte-for-byte equivalent** inside `registerRoomSpectateHandlers(socket, params)`; `handlerDeps` and `leaveExistingSocketRooms` arrive via explicit params:

```typescript
export type RegisterRoomSpectateHandlersParams = {
  handlerDeps: RoomSessionHandlerDeps;
  leaveExistingSocketRooms: () => void;
};

export function registerRoomSpectateHandlers(
  socket: Socket,
  params: RegisterRoomSpectateHandlersParams,
): void {
  const { handlerDeps, leaveExistingSocketRooms } = params;
  socket.on('room:spectate', async (argCode: unknown, arg2?: unknown, arg3?: unknown) => {
    // ... identical handler body ...
  });
}
```

### Orchestrator wiring (after)

```typescript
  registerRoomSpectateHandlers(socket, {
    handlerDeps,
    leaveExistingSocketRooms,
  });
```

**Equivalence tracing (guards preserved per investigation §4):**

| Guard / behavior | Before | After |
|------------------|--------|-------|
| Ack fn resolution (`arg3` / `arg2`) | ✓ | ✓ |
| `missing_code` | ✓ | ✓ |
| `clearSocketRematchReady` before join | ✓ | ✓ |
| `leaveExistingSocketRooms()` | ✓ | ✓ (passed-in closure, same instance) |
| `not_found` on `getRoom` throw | ✓ | ✓ |
| `match_abandoned` on `room.abandonedAt` | ✓ | ✓ |
| Socket room only; `socket.data.playerId = socket.id` | ✓ | ✓ |
| Masked `state:update` with empty legalMoves | ✓ | ✓ |
| `spectator_joined` event | ✓ | ✓ |
| `spectate_failed` catch-all | ✓ | ✓ |

**DI:** `leaveExistingSocketRooms` passed as function reference from orchestrator closure — not a ref bridge on `socket`.

---

## Extraction 3 — `applyActiveMatchForfeit` → `roomForfeit.ts`

### Before (in `registerRoomSessionHandlers.ts` L81–179)

```typescript
export async function applyActiveMatchForfeit(
  io: Server,
  socket: Socket,
  roomCode: string,
  abandoningPlayer: ForfeitLeavingPlayer,
): Promise<{ winnerUserId: string | null } | null> {
  const handlerDeps = requireRoomSessionHandlerDeps();
  const room = getRoom(roomCode);

  if (room.abandonedAt || room.state?.gameOver) {
    return null;
  }
  // ... tournament applyMatchResult, matchmaking recordMatchEnd,
  // clearReconnectSeatsForRoom, appendRoomEvent, persistRoomMatchLog,
  // io.to(roomCode).emit('room:match_abandoned', { ... }) ...
  return { winnerUserId };
}
```

### After (`roomForfeit.ts`)

Function signature and body **unchanged** — moved verbatim with imports relocated:

```typescript
export type ForfeitLeavingPlayer = {
  id: string;
  username: string;
  userId: string | null;
};

export async function applyActiveMatchForfeit(
  io: Server,
  socket: Socket,
  roomCode: string,
  abandoningPlayer: ForfeitLeavingPlayer,
): Promise<{ winnerUserId: string | null } | null> {
  const handlerDeps = requireRoomSessionHandlerDeps();
  const room = getRoom(roomCode);

  if (room.abandonedAt || room.state?.gameOver) {
    return null;
  }
  // ... identical through return { winnerUserId };
}
```

### Orchestrator import + re-export (preserves external import path)

```typescript
import { applyActiveMatchForfeit } from './roomForfeit';
export { applyActiveMatchForfeit } from './roomForfeit';
```

Internal calls in frozen `leaveTrackedRoom` / `room:abandon_match` still call `applyActiveMatchForfeit(io, socket, ...)` via the local import — same symbol, same arity.

### `disconnectGrace.ts` import update

**Before:**

```typescript
const { applyActiveMatchForfeit } = require('./registerRoomSessionHandlers');
```

**After:**

```typescript
const { applyActiveMatchForfeit } = require('./roomForfeit');
```

No other lines in `disconnectGrace.ts` changed.

**Equivalence (terminal guard from investigation §4.1):**

```typescript
if (room.abandonedAt || room.state?.gameOver) {
  return null;
}
```

Preserved in `roomForfeit.ts` — covered by new `roomForfeit.test.ts` and existing `registerRoomSessionHandlers.abandon.test.ts` (7 tests).

---

## LOC summary

| File | Before | After | Δ |
|------|--------|-------|---|
| `registerRoomSessionHandlers.ts` | 1,580 | 1,390 | **−190** |
| `roomForfeit.ts` | — | 121 | +121 |
| `registerRoomUtilityHandlers.ts` | — | 24 | +24 |
| `registerRoomSpectateHandlers.ts` | — | 90 | +90 |
| **New test files** | — | 3 files | +6 tests |
| `disconnectGrace.ts` | 151 | 151 | 0 (1 line changed) |

Net production LOC: 1,390 + 121 + 24 + 90 = **1,625** (+45 vs original — module headers/exports; behavior-neutral).

---

## New tests added

| File | Tests | Coverage |
|------|-------|----------|
| `registerRoomUtilityHandlers.test.ts` | 3 | `mp:ping` timestamp; `player:dragging` relay; invalid room ignore |
| `registerRoomSpectateHandlers.test.ts` | 2 | `match_abandoned` reject; successful spectate ack + socket room join |
| `roomForfeit.test.ts` | 1 | Terminal `abandonedAt` → `null`, no persist/emit |

Existing integration suites still exercise forfeit via abandon path and full orchestrator registration.

---

## Build and test results

```bash
npm run build --prefix server
# exit 0

npm test --prefix server
# Test Files  69 passed (69)
# Tests       496 passed (496)

npm test --prefix server -- registerRoomSessionHandlers.private registerRoomSessionHandlers.abandon \
  registerRoomSessionHandlers.tournament registerRoomSessionHandlers.privateRoomConfig \
  handReadyGameplayLock tournamentHumanBotFlow registerRoomUtilityHandlers \
  registerRoomSpectateHandlers roomForfeit
# Test Files  9 passed (9)
# Tests       29 passed (29)
```

---

## Files changed

| File | Change |
|------|--------|
| `server/src/multiplayer/roomForfeit.ts` | **Created** — `applyActiveMatchForfeit` + `ForfeitLeavingPlayer` |
| `server/src/multiplayer/registerRoomUtilityHandlers.ts` | **Created** — `mp:ping`, `player:dragging` |
| `server/src/multiplayer/registerRoomSpectateHandlers.ts` | **Created** — `room:spectate` |
| `server/src/multiplayer/registerRoomSessionHandlers.ts` | Removed inlined handlers/forfeit; wired registrars; re-export forfeit |
| `server/src/multiplayer/disconnectGrace.ts` | `require('./roomForfeit')` (import path only) |
| `server/src/multiplayer/registerRoomUtilityHandlers.test.ts` | **Created** |
| `server/src/multiplayer/registerRoomSpectateHandlers.test.ts` | **Created** |
| `server/src/multiplayer/roomForfeit.test.ts` | **Created** |

**Not touched:** `index.ts`, `roomSession.ts`, `rooms.ts`, `matchStartReady.ts`, `roomGameplayLock.ts`, all frozen client paths, all later-pass handlers/closures in `registerRoomSessionHandlers.ts`.

---

## Remaining risks / next pass

1. **`attachSocketToTrackedRoom` / `leaveTrackedRoom`** — still in orchestrator; spectate depends on `leaveExistingSocketRooms` closure until pass 10 (highest risk).
2. **`socket.__leaveTrackedRoom`** — unchanged; out of scope this pass.
3. **`finalizeTournamentMatchHook`** — still indirect via deps; untouched.
4. Next extraction candidates per plan §7.3: `room:leave` + `room:abandon_match` handlers (after forfeit already extracted), then gameplay handlers.

---

## Appendix — Full verbatim AFTER bodies (zero elisions)

Follow-up: replaces placeholder elisions in Extraction 2 §"After" and Extraction 3 §"After" with the complete current source. BEFORE references are the inlined quotes already in those sections above (or the abbreviated Extraction 3 BEFORE block where the middle was elided — the full original body is reproduced below as AFTER and compared to the pre-extraction source).

### A.1 Extraction 2 — full `socket.on('room:spectate', ...)` in `registerRoomSpectateHandlers.ts`

**File:** `server/src/multiplayer/registerRoomSpectateHandlers.ts` (handler lines 25–90 as of this append).

```typescript
  socket.on('room:spectate', async (argCode: unknown, arg2?: unknown, arg3?: unknown) => {
    const cb = (
      typeof arg3 === 'function' ? arg3 : typeof arg2 === 'function' ? arg2 : undefined
    ) as AckFn | undefined;
    const config =
      arg2 && typeof arg2 === 'object' && !Array.isArray(arg2) ? (arg2 as RoomJoinConfig) : {};
    const code = String(argCode ?? '').trim().toUpperCase();
    try {
      const { username, userId } = await handlerDeps.resolveSocketIdentity(config);
      if (!code) return cb?.({ ok: false, error: 'missing_code' });
      clearSocketRematchReady((socket.data?.roomId as string | undefined) ?? undefined, socket.id);
      leaveExistingSocketRooms();

      let room: Room | null = null;
      try {
        room = getRoom(code);
      } catch {
        return cb?.({ ok: false, error: 'not_found' });
      }
      if (room.abandonedAt) {
        return cb?.({ ok: false, error: 'match_abandoned' });
      }

      // Socket room only — DO NOT join the game engine.
      socket.join(code);
      socket.data.roomId = code;
      socket.data.username = username;
      socket.data.userId = userId;
      socket.data.playerId = socket.id;

      // Send roster snapshot
      const roster = getRoomRoster(code);
      socket.emit('room:update', { players: roster });

      // Send a spectator-safe snapshot to just this socket.
      if (room.state) {
        const specMasked = maskStateForRecipient(room.state, null);
        socket.emit('state:update', {
          state: { ...specMasked, handCounts: getHandCounts(room.state) },
          legalMoves: [],
          canDraw: false,
          eventMeta: getRoomMatchEventMeta(code),
          matchStarted: true,
        });
      }

      appendRoomEvent(room, {
        type: 'spectator_joined',
        actorSocketId: socket.id,
        actorUserId: userId,
        payload: {
          username,
        },
      });

      cb?.({
        ok: true,
        roomCode: code,
        players: roster,
        eventMeta: getRoomMatchEventMeta(code),
        matchStarted: Boolean(room.state),
      });
    } catch (e) {
      cb?.({ ok: false, error: 'spectate_failed' });
    }
  });
```

**Surrounding registrar (not part of handler body, but required for `handlerDeps` / `leaveExistingSocketRooms` binding):**

```typescript
export function registerRoomSpectateHandlers(
  socket: Socket,
  params: RegisterRoomSpectateHandlersParams,
): void {
  const { handlerDeps, leaveExistingSocketRooms } = params;

  socket.on('room:spectate', async (argCode: unknown, arg2?: unknown, arg3?: unknown) => {
    // ... handler body quoted above ...
  });
}
```

#### A.1.1 BEFORE vs AFTER differences (Extraction 2)

Compared to the **pre-extraction inlined handler** in `registerRoomSessionHandlers.ts` (investigation pass line range L624–689):

| Change | Detail |
|--------|--------|
| **Wrapper only** | Handler now registers inside `registerRoomSpectateHandlers()`; `handlerDeps` and `leaveExistingSocketRooms` are bound via `params` destructuring (`const { handlerDeps, leaveExistingSocketRooms } = params;`) instead of closing over `registerRoomSessionHandlers`'s `const handlerDeps` and `leaveExistingSocketRooms` locals. **Same closure values** are passed from the orchestrator — behavior equivalent. |
| **Indentation** | Handler body dedented by 4 spaces (was nested inside `registerRoomSessionHandlers`). No statement reorder. |
| **No logic/payload/guard changes** | Event string, ack resolution, guards (`missing_code`, `not_found`, `match_abandoned`), socket.data fields, emit payloads, `appendRoomEvent` shape, and catch `spectate_failed` are **unchanged** vs the live pre-extraction source. |

Compared to the **abbreviated BEFORE quote in Extraction 2 §"Before" above** (this report's first draft):

| Change | Detail |
|--------|--------|
| **Comments restored** | AFTER includes `// Send roster snapshot` and `// Send a spectator-safe snapshot to just this socket.` — those comments were present in the real pre-extraction file but omitted from the abbreviated BEFORE quote in §"Before". |
| **`appendRoomEvent` payload formatting** | AFTER uses multiline `payload: { username, }`; abbreviated BEFORE used single-line `payload: { username }`. Semantically identical. |

**No variable renames, no reordered statements, no changed error strings, no changed emit field names** inside the handler body relative to pre-extraction source.

---

### A.2 Extraction 3 — full `applyActiveMatchForfeit` in `roomForfeit.ts`

**File:** `server/src/multiplayer/roomForfeit.ts` (lines 14–122 as of this append).

```typescript
export type ForfeitLeavingPlayer = {
  id: string;
  username: string;
  userId: string | null;
};

/**
 * Marks a match as forfeited. No-op when already abandoned or game over.
 * Does not remove the seat — leaveTrackedRoom does that after forfeit.
 */
export async function applyActiveMatchForfeit(
  io: Server,
  socket: Socket,
  roomCode: string,
  abandoningPlayer: ForfeitLeavingPlayer,
): Promise<{ winnerUserId: string | null } | null> {
  const handlerDeps = requireRoomSessionHandlerDeps();
  const room = getRoom(roomCode);

  if (room.abandonedAt || room.state?.gameOver) {
    return null;
  }

  const authenticatedUserId =
    handlerDeps.normalizeUserId(abandoningPlayer.userId ?? socket.data?.userId);
  const rosterCached = getRoomRoster(roomCode);
  const roster =
    rosterCached.length > 0 ? rosterCached : getRoomPlayersWithFallback(roomCode, room.players);

  const opponentSeatId = room.players.find((seatId) => seatId !== abandoningPlayer.id) ?? null;
  const opponentPlayer =
    opponentSeatId
      ? roster.find((player) => player.id === opponentSeatId)
        ?? { id: opponentSeatId, socketId: '', username: 'Opponent', userId: null }
      : null;

  const nowIso = new Date().toISOString();
  room.abandonedAt = nowIso;
  room.abandonedByUserId = authenticatedUserId;
  room.abandonedReason = 'forfeit';

  let winnerUserId = opponentPlayer?.userId ?? null;
  if (room.scheduledTournamentMatchId) {
    const match = await fetchMatchById(room.scheduledTournamentMatchId);
    if (!match || !match.player1_id || !match.player2_id) {
      throw new Error('match_not_found');
    }
    winnerUserId =
      match.player1_id === authenticatedUserId ? match.player2_id : match.player1_id;
    const winTarget =
      typeof room.config.winningScore === 'number' && Number.isFinite(room.config.winningScore)
        ? room.config.winningScore
        : 30;
    const statusReason =
      match.player1_id === authenticatedUserId ? 'player1_forfeit' : 'player2_forfeit';
    await applyMatchResult(io, {
      matchId: match.id,
      winnerId: winnerUserId,
      player1Score: match.player1_id === winnerUserId ? winTarget : 0,
      player2Score: match.player2_id === winnerUserId ? winTarget : 0,
      winnerSource: 'forfeit',
      statusReason,
      forfeitUserId: authenticatedUserId,
    });
    console.log('[tournament:forfeit] applied', {
      matchId: match.id,
      tournamentId: match.tournament_id,
      loserId: authenticatedUserId,
      winnerId: winnerUserId,
    });
  }

  if (room.matchmakingMatchId) {
    await recordMatchEnd({
      matchId: room.matchmakingMatchId,
      status: 'forfeit',
      winnerId: winnerUserId,
      playerARatingChange: null,
      playerBRatingChange: null,
      isSim: false,
    });
  }

  room.abandonedWinnerUserId = winnerUserId;
  clearReconnectSeatsForRoom(roomCode);
  appendRoomEvent(room, {
    type: 'player_left',
    actorSocketId: socket.id,
    actorUserId: authenticatedUserId,
    payload: {
      preserveSeat: false,
      playerSeatId: abandoningPlayer.id,
      abandoned: true,
    },
  });
  await handlerDeps.persistRoomMatchLog(room, 'abandoned');
  io.to(roomCode).emit('room:match_abandoned', {
    roomCode,
    abandonedUserId: authenticatedUserId,
    abandonedUsername: abandoningPlayer.username,
    winnerId: winnerUserId,
    message: `${abandoningPlayer.username} left the game`,
    tournamentId: room.scheduledTournamentId ?? null,
    scheduledTournamentMatchId: room.scheduledTournamentMatchId ?? null,
    isTournament: Boolean(room.scheduledTournamentMatchId),
  });

  return { winnerUserId };
}
```

#### A.2.1 BEFORE vs AFTER differences (Extraction 3)

Compared to the **pre-extraction function** in `registerRoomSessionHandlers.ts` (L81–179 at pass start):

| Change | Detail |
|--------|--------|
| **File location / imports** | Function body moved to `roomForfeit.ts`. Imports (`appendRoomEvent`, `getRoom`, `fetchMatchById`, `applyMatchResult`, `recordMatchEnd`, `clearReconnectSeatsForRoom`, `getRoomPlayersWithFallback`, `getRoomRoster`, `requireRoomSessionHandlerDeps`) now live at the top of `roomForfeit.ts` instead of `registerRoomSessionHandlers.ts`. **No import paths inside the function** — N/A. |
| **`ForfeitLeavingPlayer` export** | Was `type ForfeitLeavingPlayer` (module-private) in `registerRoomSessionHandlers.ts`; now `export type ForfeitLeavingPlayer` in `roomForfeit.ts`. **Function signature unchanged**; export visibility widened only. |
| **Re-export** | `registerRoomSessionHandlers.ts` adds `export { applyActiveMatchForfeit } from './roomForfeit';` so prior import path via that file still resolves. |
| **`disconnectGrace.ts`** | Dynamic `require` target changed from `'./registerRoomSessionHandlers'` to `'./roomForfeit'`. |

**No differences inside the function body:** statement order, variable names, guards (`abandonedAt` / `gameOver` no-op), tournament `applyMatchResult` arguments, matchmaking `recordMatchEnd` arguments, `clearReconnectSeatsForRoom`, `appendRoomEvent` payload, `persistRoomMatchLog(room, 'abandoned')`, and `io.to(roomCode).emit('room:match_abandoned', { ... })` fields are **byte-for-byte identical** to the pre-extraction implementation.