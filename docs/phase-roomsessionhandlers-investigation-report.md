# Phase: `registerRoomSessionHandlers.ts` Investigation & Decomposition Plan

**Date:** 2026-07-05  
**Task:** Investigation-and-planning-only pass on `server/src/multiplayer/registerRoomSessionHandlers.ts` (1,580 LOC). **Zero code changes** — read/analyze only.  
**Frozen this pass:** `registerRoomSessionHandlers.ts` (read-only), all paths listed in the task brief.

---

## Executive summary

`registerRoomSessionHandlers.ts` is the per-socket registration surface for **14 inbound Socket.IO events**, **2 exported helpers** (`applyActiveMatchForfeit`, `handleRoomPlayerDisconnect`), and **3 large internal closures** (`leaveTrackedRoom`, `leaveExistingSocketRooms`, `attachSocketToTrackedRoom`). It does **not** own the in-memory room map (`rooms` in `rooms.ts`) or roster/reconnect stores (`roomSession.ts`); it **mutates** those stores and `Room` objects through imported APIs.

The audit’s six-way split (lifecycle / tournament attach / matchmaking auto-start / abandon / ready-start / game actions) is **directionally correct but incomplete**. The file also owns **spectate**, **rematch**, **pre-game draw picks**, **hand:ready**, **mp:ping**, **player:dragging**, **session supersession/reconnect**, **live-session hydration**, and **disconnect/reconnect-seat coordination** (via `handleRoomPlayerDisconnect`).

**Highest extraction risk:** `attachSocketToTrackedRoom` and anything that shares it (`room:join`, `tournament:attach_assigned_match`, matchmaking auto-start, reconnect supersession). **Lowest risk:** `mp:ping` and `player:dragging`.

**`socketsByUserId`:** Not referenced in this file. Presence uses it indirectly via `handlerDeps.notifyRoomPlayersInGame` (wired in `index.ts`).

**`finalizeTournamentMatchHook`:** Not referenced by name. Tournament finalization reaches legacy hook through `handlerDeps.maybeFinalizeTournamentMatch` (`game:action`, `hand:ready`) and `broadcastStateUpdate` → `deps.finalizeTournamentMatch` (in `roomSession.ts`). The **last-connection-wins** reassignment of `finalizeTournamentMatchHook` in `index.ts` remains a cross-connection coupling **outside** this file.

---

## 1. Full responsibility inventory

Line ranges are from the current file (`wc -l` → **1,580 lines**).

| # | Concern | Lines | One-line description (code-grounded) |
|---|---------|-------|--------------------------------------|
| 1 | **Forfeit / abandon core** | 71–179 | `applyActiveMatchForfeit`: sets `room.abandonedAt`, persists tournament/matchmaking forfeit, emits `room:match_abandoned`; no-op if already abandoned or `gameOver`. |
| 2 | **Leave + implicit forfeit** | 184–275 | `leaveTrackedRoom`: optional forfeit on leave during active game, roster/seat cleanup, `evaluateRoomLifecycle`; stashed on `socket.__leaveTrackedRoom`. |
| 3 | **Multi-room socket cleanup** | 279–285 | `leaveExistingSocketRooms`: leaves all prior Socket.IO rooms via `leaveTrackedRoom` before a new join/create. |
| 4 | **Shared join/attach/reconnect pipeline** | 287–570 | `attachSocketToTrackedRoom`: hydrate DB roster, matchmaking shell hydrate, abandoned/completed guards, userId supersession, reconnect-seat reclaim, roster join, **matchmaking auto-start**, tournament metadata fetch, rejoin `hand:ended`, `onPlayerSocketRejoined`. |
| 5 | **Private room create** | 572–621 | `room:create`: identity, `createRoom`, roster, persist schedule, `player_joined` event. |
| 6 | **Spectate (non-player)** | 624–689 | `room:spectate`: socket room only (no engine seat), masked `state:update`, `spectator_joined` event. |
| 7 | **Private room join** | 691–742 | `room:join`: delegates to `attachSocketToTrackedRoom` with `hydrateMatchmakingRoom: true`. |
| 8 | **Scheduled tournament attach** | 744–973 | `tournament:attach_assigned_match`: auth/participant/status guards, `dispatchTournamentMatch` repair, attach pipeline, `humanJoinedAt` patch, tournament auto-start + `promoteScheduledMatchToInProgress`, ack-once. |
| 9 | **Explicit leave** | 975–989 | `room:leave`: calls `leaveTrackedRoom`. |
| 10 | **Explicit abandon** | 991–1085 | `room:abandon_match`: auth + player checks, `applyActiveMatchForfeit`, then `leaveTrackedRoom`. |
| 11 | **Pre-start ready (MM/tournament/private)** | 1087–1157 | `player:ready`: `markMatchStartReady`; auto-start for non-private rooms via `tryStartMatchIfReady`; private rooms broadcast roster only. |
| 12 | **Host-driven private start** | 1159–1221 | `game:start`: host-only (`players[0]`), min 2 connected, `tryStartMatchIfReady`, `room:request_ready` on failure. |
| 13 | **Latency ping** | 1223–1225 | `mp:ping`: returns server timestamp. |
| 14 | **Gameplay actions** | 1227–1290 | `game:action`: validates DRAW/MOVE/PASS, `act()` + `broadcastStateUpdate`, forced-draw animation, deferred `maybeFinalizeTournamentMatch`. |
| 15 | **Next-hand ready** | 1292–1317 | `hand:ready`: `readyForNextHand` with stale-hand dedup (`ignored`), deferred tournament finalize on start. |
| 16 | **Post-game rematch** | 1319–1403 | `game:rematch`: blocks tournament rooms, `rematchReady` quorum, `waitForActiveGameOverPersist`, locked reset + `initiatePregameDrawOrStart`, **ordered** `game:rematch:started` before `broadcastStateUpdate`. |
| 17 | **Pre-game draw pick FSM** | 1405–1522 | `game:pregame_draw_pick`: per-pick lock, tie/reveal timers, `startGame` on resolution. |
| 18 | **Drag cosmetic sync** | 1524–1538 | `player:dragging`: relays drag state to room peers. |
| 19 | **Disconnect orchestration** | 1542–1580 | `handleRoomPlayerDisconnect`: reconnect seat reserve, disconnect grace, `leaveTrackedRoom` with `preserveSeat` when active player. |

**Registration entry** (orchestrator only): 181–183 (`registerRoomSessionHandlers`), 1540 (closes handler block).

---

## 2. Every socket event registered in this file

Grep proof (`rg 'socket\.on\(' server/src/multiplayer/registerRoomSessionHandlers.ts`):

| Line | Event string | Responsibility bucket |
|------|--------------|----------------------|
| 572 | `room:create` | Room lifecycle — create |
| 624 | `room:spectate` | Room lifecycle — spectate |
| 691 | `room:join` | Room lifecycle — join (+ shared attach pipeline) |
| 744 | `tournament:attach_assigned_match` | Tournament attach |
| 975 | `room:leave` | Room lifecycle — leave |
| 991 | `room:abandon_match` | Abandon / forfeit |
| 1087 | `player:ready` | Ready / start (pre-game ready + MM/tournament auto-start) |
| 1159 | `game:start` | Ready / start (private host start) |
| 1223 | `mp:ping` | Utility — latency |
| 1227 | `game:action` | Game actions |
| 1292 | `hand:ready` | Game actions — next hand |
| 1319 | `game:rematch` | Post-game rematch |
| 1405 | `game:pregame_draw_pick` | Pre-game draw FSM |
| 1524 | `player:dragging` | Utility — cosmetic sync |

**Total: 14 handlers.** No other `socket.on(...)` registrations exist in this file.

**Outbound events emitted directly from this file** (not via `broadcastStateUpdate`):

| Event | Emit sites | Bucket |
|-------|------------|--------|
| `room:match_abandoned` | 167 | Abandon |
| `room:update` | 271, 444, 656, 1143 | Lifecycle / ready |
| `room:session:superseded` | 348 | Reconnect supersession |
| `hand:ended` | 553 | Rejoin replay |
| `state:update` | 661 | Spectate snapshot |
| `room:request_ready` | 1200 | Private start |
| `game:rematch:started` | 1395 | Rematch |
| `player:dragging` | 1531 | Cosmetic |

---

## 3. Shared mutable state — inventory and cross-handler coupling

### 3.1 Module-level / process-wide stores (reached by handlers)

| Store | Owner module | Read by (this file) | Written by (this file) | Cross-bucket overlap |
|-------|--------------|----------------------|------------------------|----------------------|
| `rooms` (`Map<RoomCode, Room>`) | `rooms.ts:109` | All handlers via `getRoom` / `peekRoom` | `createRoom`, `joinRoom`, field mutations on `Room`, `act`, `startGame`, `readyForNextHand`, `initiatePregameDrawOrStart` (indirect) | **All buckets** |
| `nextHandStartsByRoom` | `rooms.ts:110` | — (via `readyForNextHand`) | — (via `hand:ready`) | Game actions ↔ hand:ready coalescing |
| `roomPlayersByCode` (roster) | `roomSession.ts:59` | leave, attach, abandon, create, spectate, ready, start | `setRoomRoster`, `deleteRoomRoster`, `migrateRoomSeat` | Lifecycle ↔ abandon ↔ attach |
| `reconnectSeatsByCode` | `roomSession.ts:52` | attach (`pruneReconnectSeats`) | `releaseReconnectSeat` (attach), `clearReconnectSeatsForRoom` (forfeit), `clearReconnectSeatsForSocket` (leave) | Lifecycle ↔ disconnect (`reserveReconnectSeat` in `handleRoomPlayerDisconnect`) |
| `roomCleanupTimersByCode` | `roomSession.ts:53` | — | `cancelRoomCleanup` (leave path), `evaluateRoomLifecycle` | Lifecycle |
| `sessionDeps` / `ioRef` | `roomSession.ts:62–103` | `requireRoomSessionHandlerDeps()` at 87, 182, 1557 | — (injected at `initRoomSession`) | All buckets via deps callbacks |
| `graceTimersByRoom` | `disconnectGrace.ts:12` | — | — (written by `onActivePlayerSocketDisconnect` from disconnect handler) | Disconnect grace ↔ game:action (`act` under same gameplay lock) |
| `chains` (gameplay lock) | `roomGameplayLock.ts:7` | rematch, pregame_draw_pick | `withRoomGameplayLock` | Rematch ↔ pregame ↔ `act`/`readyForNextHand` |
| Socket.IO adapter rooms | `io.sockets.adapter.rooms` | `game:start` (live count) | `socket.join` / `socket.leave` (attach, create, spectate, leave) | Lifecycle ↔ start |

### 3.2 Per-connection mutable state

| State | Read | Write | Cross-bucket |
|-------|------|-------|--------------|
| `socket.data.roomId` | abandon, pregame_draw_pick, disconnect | create, join, attach, spectate, leave | **All join/leave paths** |
| `socket.data.username` / `userId` | abandon, ready, rematch | create, join, attach, spectate | Identity / abandon |
| `socket.data.playerId` (seat) | `resolveActorSeatId` in action handlers | `ensureSocketDataSeat` in attach/create | Gameplay ↔ attach |
| `(socket as any).__leaveTrackedRoom` | `handleRoomPlayerDisconnect:1574` | `registerRoomSessionHandlers:277` | Leave ↔ disconnect ↔ abandon |

### 3.3 `Room` object fields mutated by this file (high-signal)

| Field(s) | Writers in this file | Readers / guards |
|----------|---------------------|------------------|
| `abandonedAt`, `abandonedByUserId`, `abandonedReason`, `abandonedWinnerUserId` | `applyActiveMatchForfeit` | attach, spectate, abandon, leave forfeit guard |
| `players` | `leaveTrackedRoom` (filter seat) | all player-seat checks |
| `matchStartReady` | via `markMatchStartReady` / `tryStartMatchIfReady` | `player:ready`, `game:start`, attach auto-start, tournament attach |
| `rematchReady` | `game:rematch`; cleared via `clearSocketRematchReady` on join | rematch |
| `preGameDraw`, `preGameDrawTimer` | `game:pregame_draw_pick` | attach rejoin `hand:ended` guard |
| `pendingForcedDrawBroadcast` | `game:action` | cleared in `broadcastStateUpdate` |
| `matchLogged`, `leadTracker` | `game:rematch` reset | rematch archive |
| `scheduledTournamentMatchId`, `matchmakingMatchId` | — (set elsewhere) | branch logic in ready/attach/forfeit |

### 3.4 Dependency injection surface (`RoomSessionHandlerDeps`)

From `roomSession.ts:78–96`, consumed via `requireRoomSessionHandlerDeps()`:

```typescript
export type RoomSessionHandlerDeps = {
  resolveSocketIdentity: (config: RoomJoinConfig) => Promise<{ username: string; userId: string | null }>;
  normalizeUsername: (value: unknown) => string;
  normalizeUserId: (value: unknown) => string | null;
  tryHydrateMatchmakingRoomShell: (roomCode: string) => Promise<'skipped' | 'already' | 'hydrated' | 'miss'>;
  waitUntilMatchmakingRoomSocketsReady: (io: Server, roomCode: string, engineSeatSocketIds: string[]) => Promise<void>;
  onAfterMatchStarted: (room: Room) => Promise<void>;
  notifyRoomPlayersInGame: (roomCode: string) => void;
  maybeFinalizeTournamentMatch?: (room: Room) => void;
  persistRoomMatchLog: (room: Room, status: PersistedRoomMatchLogStatus) => Promise<void>;
};
```

**Handlers touching each dep:**

| Dep | Handlers |
|-----|----------|
| `resolveSocketIdentity` | `room:create`, `room:spectate`, `room:join` |
| `normalizeUserId` / `normalizeUsername` | abandon, leave, rematch, forfeit, tournament attach (logging) |
| `tryHydrateMatchmakingRoomShell` | `attachSocketToTrackedRoom` when `hydrateMatchmakingRoom: true` |
| `waitUntilMatchmakingRoomSocketsReady` | matchmaking auto-start block in attach (447–468) |
| `onAfterMatchStarted` | tournament attach auto-start, `player:ready` start, `game:start` success path |
| `notifyRoomPlayersInGame` | tournament attach, `player:ready`, `game:start` |
| `maybeFinalizeTournamentMatch` | `game:action`, `hand:ready` |
| `persistRoomMatchLog` | `applyActiveMatchForfeit`, `game:rematch` |

### 3.5 Cross-boundary shared-state risk summary

**Safe to split only with explicit shared context** (same closure today):

1. **`attachSocketToTrackedRoom` + `leaveTrackedRoom` + `leaveExistingSocketRooms`** — shared by create/join/tournament/leave/abandon/disconnect.
2. **`matchStartReady` / `tryStartMatchIfReady`** — touched from attach (MM), tournament attach, `player:ready`, `game:start`.
3. **`applyActiveMatchForfeit`** — called from leave (implicit), abandon (explicit), and `disconnectGrace.ts` (dynamic `require`).

**`socketsByUserId`:** Grep `server/src/multiplayer/` → **no matches**. Presence `in_game` updates go through `notifyRoomPlayersInGame` in `index.ts:567–578`, which reads `socketsByUserId` — **outside** this file.

---

## 4. Sequencing / idempotency / race-relevant guards

### 4.1 Forfeit and terminal-state guards

```typescript
// applyActiveMatchForfeit — no-op if terminal
if (room.abandonedAt || room.state?.gameOver) {
  return null;
}
```

```typescript
// leaveTrackedRoom — forfeit only during active, non-terminal game
const shouldForfeit =
  !preserveSeat &&
  wasPlayer &&
  playerSeatId &&
  room.state != null &&
  !room.state.gameOver &&
  !room.abandonedAt;
```

```typescript
// attachSocketToTrackedRoom — reject dead rooms before seat work
if (existingRoom.abandonedAt) {
  throw new Error('match_abandoned');
}
if (existingRoom.state?.gameOver) {
  throw new Error('match_completed');
}
```

```typescript
// room:abandon_match — early reject + double-check after forfeit
if (room.abandonedAt || room.state?.gameOver) { /* reject */ }
const result = await applyActiveMatchForfeit(...);
if (!result) { /* reject match_abandoned | match_completed */ }
```

**Purpose:** Prevent double-forfeit, abandon-after-complete, and rejoin into terminal rooms.

### 4.2 Join ordering assumptions

| Assumption | Guard / behavior | Lines |
|------------|------------------|-------|
| Join clears prior rooms | `leaveExistingSocketRooms()` before attach | 296, 587, 635 |
| Join clears stale rematch | `clearSocketRematchReady` | 295, 586, 634, 209 |
| `ready` / `game:start` require prior join | `resolveActorSeatId` / `room.players.includes(playerSeatId)` | 1092, 1165, 1241 |
| Tournament attach requires auth on socket | `normalizeUserId(socket.data?.userId)` | 770–775 |
| Spectate does not claim engine seat | Comment + no `joinRoom` | 647–652 |

### 4.3 Session supersession (reconnect race)

```typescript
if (oldSocket && oldSocket.id !== socket.id && oldSocket.connected) {
  oldSocket.emit('room:session:superseded', { reason: 'new_session', newSocketId: socket.id });
  oldSocket.disconnect(true);
  await new Promise(resolve => setTimeout(resolve, 50));
}
```

**Purpose:** Last socket wins for same `userId`; 50ms pause before seat migration to let old socket tear down.

### 4.4 Room-full → reconnect seat reclaim

```typescript
const seats = pruneReconnectSeats(roomCode);
const match = seats.find((seat) => identityMatchesReconnectSeat(seat, { username, userId }));
if (!match) throw err;
joinedPlayerSeatId = match.seatId;
migrateRoomSeat(roomCode, match.seatId, socket.id);
releaseReconnectSeat(roomCode, match.seatId);
```

**Purpose:** Join after disconnect grace can reclaim reserved seat instead of failing “room is full”.

### 4.5 Matchmaking auto-start sequencing

In `attachSocketToTrackedRoom` after join:

```typescript
if (room.matchmakingMatchId && !room.state) {
  markMatchStartReady(room.code, joinedPlayerSeatId);
  const mmSeatSockets = getEngineSeatSocketIds(room.code, [...room.players]);
  if (mmSeatSockets.length >= 2) {
    await handlerDeps.waitUntilMatchmakingRoomSocketsReady(io, room.code, mmSeatSockets);
    const startResult = await tryStartMatchIfReady(room.code, io, buildMatchStartDeps(io));
  }
}
```

**Purpose:** Auto-start only when both engine seats have sockets; waits for MM socket readiness before `tryStartMatchIfReady`.  
**Race note:** Overlaps with `player:ready` path — `tryStartMatchIfReady` no-ops if `room.state` already exists (`matchStartReady.ts:25–27`).

### 4.6 Tournament attach ack dedup

```typescript
let acked = false;
const ackOnce: AckFn = (response) => {
  if (acked) return;
  acked = true;
  cb?.(response);
};
// ...
finally {
  if (!acked) {
    ackOnce({ ok: false, error: 'attach_ack_missing' });
  }
}
```

**Purpose:** Exactly one client ack per attach attempt; `attach_ack_missing` safety net.

### 4.7 Tournament attach status / room repair guards

| Guard | Lines | Purpose |
|-------|-------|---------|
| `match_completed` / `bye` / `winner_id` | 787–790 | DB terminal match |
| `existingRoom?.state?.gameOver` | 793–797 | In-memory terminal room |
| `tournament_not_assigned` | 799–806 | Participant check |
| `match_not_ready` | 807–810 | Status must be `ready` or `in_progress` |
| `dispatchTournamentMatch` repair | 811–838 | Create/rehydrate room shell if missing |
| `humanJoinedAt` skip patch | 862–868 | Idempotent `player*_joined_at` update |

### 4.8 Private vs MM/tournament ready branching

```typescript
const isPrivate = !roomAfterReady.matchmakingMatchId && !roomAfterReady.scheduledTournamentMatchId;
if (!isPrivate) {
  const startResult = await tryStartMatchIfReady(...);
  // promoteScheduledMatchToInProgress when started + tournament
} else {
  io.to(roomCode).emit('room:update', { players: roster });
  // waitingFor = players not in matchStartReady
}
```

**Purpose:** Private lobbies wait for `game:start` host; MM/tournament auto-start when all seats ready.

### 4.9 `game:start` host and quorum guards

| Guard | Lines |
|-------|-------|
| Only `room.players[0]` (host seat) | 1169–1171 |
| `liveCount < 2 \|\| rosterCount < 2` | 1178–1180 |
| `room:request_ready` + `waiting_for_ready` ack if not started | 1198–1207 |

### 4.10 Gameplay action guards

```typescript
if (!['DRAW', 'MOVE', 'PASS'].includes(action.type)) { /* reject */ }
if (!existingRoom.players.includes(playerSeatId)) { /* spectators cannot act */ }
if (!existingRoom.state) { /* game not started */ }
if (existingRoom.state.gameOver) { /* game is over */ }
```

`act()` runs under `withRoomGameplayLock` inside `rooms.ts:773`.

**Post-action:** `broadcastStateUpdate` before forced-draw animation (1261–1264); `setImmediate(() => handlerDeps.maybeFinalizeTournamentMatch?.(room))` (1266).

### 4.11 `hand:ready` stale / duplicate guards (delegated to `rooms.ts`)

```typescript
if (typeof handNumber === 'number' && handNumber !== room.state.handNumber) {
  return { kind: 'return', value: { started: false, room, ignored: true } };
}
// coalesce concurrent hand:ready via nextHandStartsByRoom
if (existingStart) {
  return { kind: 'coalesce', room, existingStart, readyHandNumber };
}
```

Handler surfaces: `ignored: Boolean(result.ignored)`, error `stale_or_duplicate_hand_ready` (1306–1311).

### 4.12 Rematch ordering invariant

```typescript
// game:rematch:started MUST be emitted before broadcastStateUpdate so the
// client resets its sequence watermark before the first state:update of the new game arrives.
io.to(roomAfterRematch.code).emit('game:rematch:started', { roomCode: roomAfterRematch.code });
broadcastStateUpdate(roomAfterRematch.code);
```

Also: `await waitForActiveGameOverPersist(room.code)` before rematch reset (1358).

### 4.13 Pre-game draw pick guards

| Guard | Lines | Purpose |
|-------|-------|---------|
| `preGameDraw.picks[playerSeatId] !== null` return | 1416 | One pick per player |
| Invalid slot → fallback unrevealed tile | 1419–1421 | Resilient pick |
| Timer callbacks check `innerDraw.phase` | 1453, 1480, 1490 | Prevent stale timeout advancing wrong phase |
| All mutations under `withRoomGameplayLock` | 1411+ | Serialize with other gameplay |

### 4.14 Disconnect vs abandon vs action race

```typescript
// handleRoomPlayerDisconnect
if (room.abandonedAt) {
  wasActiveRoomPlayer = false;
} else if (playerSeatId && room.players.includes(playerSeatId)) {
  reserveReconnectSeat(...);
  onActivePlayerSocketDisconnect(...); // 30s grace, may auto-pass or forfeit via disconnectGrace
}
void leaveTrackedRoom?.(roomCode, { preserveSeat: wasActiveRoomPlayer });
```

**Purpose:** Active disconnect **preserves seat** (no immediate forfeit); grace timer may `act(PASS|DRAW)` or after 2 expiries call `applyActiveMatchForfeit` (`disconnectGrace.ts:114–136`). `preserveSeat` prevents `leaveTrackedRoom` from stripping seat during grace.

**Interaction with `game:action`:** Both use `withRoomGameplayLock` — serialized per room.

### 4.15 `tryStartMatchIfReady` idempotency

From `matchStartReady.ts`:

```typescript
if (room.state) {
  return { started: false };
}
// ...
room.matchStartReady.clear();
```

**Purpose:** Start is idempotent once `room.state` exists; concurrent ready/start paths converge.

---

## 5. Cross-references to known quirks

### 5.1 `socketsByUserId` shared-reference requirement

**Finding:** `registerRoomSessionHandlers.ts` does **not** import or reference `socketsByUserId`.

Grep `socketsByUserId` under `server/src/multiplayer/` → **no matches**.

Presence coupling is in `index.ts`:

```typescript
function notifyRoomPlayersInGame(roomCode: string): void {
  // ...
  emitPresenceUpdateToFriends({ io, socketsByUserId }, playerId, 'in_game');
}
```

Passed into handlers only as `handlerDeps.notifyRoomPlayersInGame` after match start (tournament attach, `player:ready`, `game:start`). **Extraction must preserve the existing `initRoomSession` deps object** — no need to pass `socketsByUserId` into room session handlers directly.

### 5.2 `finalizeTournamentMatchHook` last-connection-wins

**Finding:** Hook variable lives in `index.ts`, not this file.

```typescript
let finalizeTournamentMatchHook: ((room: any) => void) | null = null;

initRoomSession(io, {
  finalizeTournamentMatch: (room) => finalizeTournamentMatchHook?.(room),
  maybeFinalizeTournamentMatch: (room) => finalizeTournamentMatchHook?.(room),
  // ...
});

// Per connection when ENABLE_LEGACY_TOURNAMENTS === '1':
finalizeTournamentMatchHook = registerLegacyTournamentHandlers(socket, { io, ... });
```

**This file’s touch points:**

| Location | Call |
|----------|------|
| `game:action` L1266 | `setImmediate(() => handlerDeps.maybeFinalizeTournamentMatch?.(room))` |
| `hand:ready` L1303 | `setImmediate(() => handlerDeps.maybeFinalizeTournamentMatch?.(result.room))` |

**Additional path (not in this file):** `roomSession.ts:900–902` calls `deps.finalizeTournamentMatch?.(finRoom)` on `gameOver` inside `broadcastStateUpdate`.

**Extraction implication:** Do **not** relocate `finalizeTournamentMatchHook`; keep `maybeFinalizeTournamentMatch` / `finalizeTournamentMatch` as injected deps. Splitting `game:action` / `hand:ready` must retain `setImmediate` deferral behavior.

### 5.3 `disconnectGrace` → `applyActiveMatchForfeit` dynamic require

```typescript
const { applyActiveMatchForfeit } = require('./registerRoomSessionHandlers');
```

**Implication:** `applyActiveMatchForfeit` is a **public export** consumed outside the registration function. Any decomposition should **keep this export stable** (or move to a dedicated `roomForfeit.ts` with updated import in `disconnectGrace.ts` in a later pass).

### 5.4 `socket.__leaveTrackedRoom` ad-hoc property

```typescript
(socket as any).__leaveTrackedRoom = leaveTrackedRoom;
// handleRoomPlayerDisconnect:
void leaveTrackedRoom?.(roomCode, { preserveSeat: wasActiveRoomPlayer });
```

**Implication:** Disconnect handler depends on closure installed at connection time. Extraction must either keep single registration order or pass `leaveTrackedRoom` through an explicit per-socket context (preferred over ref bridge).

---

## 6. Call sites / registration point

### 6.1 Production registration (`index.ts`)

Imports:

```typescript
import {
  handleRoomPlayerDisconnect,
  registerRoomSessionHandlers,
} from './multiplayer/registerRoomSessionHandlers';
```

`initRoomSession` (module load, before connections):

```typescript
initRoomSession(io, {
  persistRoomMatchLog,
  onGameOver: createGameOverPersistScheduler(io),
  finalizeTournamentMatch: (room) => finalizeTournamentMatchHook?.(room),
  resolveSocketIdentity,
  normalizeUsername,
  normalizeUserId,
  tryHydrateMatchmakingRoomShell,
  waitUntilMatchmakingRoomSocketsReady,
  onAfterMatchStarted,
  notifyRoomPlayersInGame,
  maybeFinalizeTournamentMatch: (room) => finalizeTournamentMatchHook?.(room),
});
```

Per-connection (inside `io.on('connection', ...)`):

```typescript
installSocketRateLimit(socket);

registerMatchmakingHandlers(io, socket, (code) => broadcastStateUpdate(code));
initScheduledTournaments(io, app, socket);

registerRoomSessionHandlers(io, socket);

const { handlePresenceDisconnect } = registerPresenceHandlers(socket, {
  io,
  socketsByUserId,
  resolveSocketIdentity,
  normalizeUserId,
  isUuidLike,
});
// ... friend invite, chat/emote, legacy tournament hook, disconnect
```

**Arguments to `registerRoomSessionHandlers`:** `(io: Server, socket: Socket)` only — **no explicit state refs**. Shared state accessed via module singletons (`rooms`, `roomSession` maps) and `requireRoomSessionHandlerDeps()`.

Disconnect:

```typescript
socket.on('disconnect', () => {
  handlePresenceDisconnect();
  const { wasActiveRoomPlayer, roomCode } = handleRoomPlayerDisconnect(io, socket);
  // ... Fritz forfeit side path
});
```

### 6.2 Test registration sites

| File | Usage |
|------|-------|
| `registerRoomSessionHandlers.private.test.ts` | 2× per host/guest socket |
| `registerRoomSessionHandlers.privateRoomConfig.test.ts` | 2× per host/guest |
| `registerRoomSessionHandlers.abandon.test.ts` | 1× per socket |
| `registerRoomSessionHandlers.tournament.test.ts` | 1× per socket |
| `handReadyGameplayLock.test.ts` | host + guest |
| `scheduledTournament/tournamentHumanBotFlow.test.ts` | 1× per socket |

Tests call `initRoomSession` with stub deps before `registerRoomSessionHandlers(io, socket)`.

### 6.3 Other production import

`disconnectGrace.ts` dynamically requires `applyActiveMatchForfeit` from this module (see §5.3).

---

## 7. Proposed decomposition plan (proposal only — not executed)

### 7.1 Design principles

1. **Thin orchestrator** — `registerRoomSessionHandlers.ts` becomes a ~50–80 LOC wiring function.
2. **Explicit context object** — no ref bridges; pass `RoomSessionSocketContext` into sub-registrars:

```typescript
type RoomSessionSocketContext = {
  io: Server;
  socket: Socket;
  deps: RoomSessionHandlerDeps;
  leaveTrackedRoom: (roomCode: string | undefined, options?: { preserveSeat?: boolean }) => Promise<void>;
  leaveExistingSocketRooms: () => void;
  attachSocketToTrackedRoom: (params: AttachParams) => Promise<AttachResult>;
};
```

3. **Extract shared logic before event handlers** — `applyActiveMatchForfeit` and attach/leave closures are prerequisites for clean handler splits.
4. **Preserve exports** — `applyActiveMatchForfeit`, `handleRoomPlayerDisconnect`, `registerRoomSessionHandlers` signatures unchanged for `index.ts` / tests / `disconnectGrace`.
5. **Do not move** `finalizeTournamentMatchHook`, `socketsByUserId`, or `initRoomSession` wiring.

### 7.2 Proposed target modules

| Module | Contents | Shared state / deps access | Riskiest extraction aspect |
|--------|----------|---------------------------|----------------------------|
| **`roomForfeit.ts`** | `applyActiveMatchForfeit` (+ `ForfeitLeavingPlayer` type) | `getRoom`, roster, `clearReconnectSeatsForRoom`, tournament `applyMatchResult`, MM `recordMatchEnd`, `handlerDeps.persistRoomMatchLog`, `io.to().emit` | Tournament + MM side effects ordering; `disconnectGrace` import path |
| **`roomSocketAttach.ts`** | `createRoomSocketSession(ctx)` factory returning `{ leaveTrackedRoom, leaveExistingSocketRooms, attachSocketToTrackedRoom }` | All roster/reconnect stores, `ensureRoomHydrated`, MM hydrate deps, `tryStartMatchIfReady`, supersession, tournament meta fetch | Largest closure; MM auto-start + reconnect races |
| **`registerRoomLifecycleHandlers.ts`** | `room:create`, `room:leave`, `handleRoomPlayerDisconnect` (or separate `roomDisconnect.ts`) | ctx attach helpers, `createRoom`, `evaluateRoomLifecycle`, `reserveReconnectSeat` | `__leaveTrackedRoom` / disconnect `preserveSeat` contract |
| **`registerRoomJoinSpectateHandlers.ts`** | `room:join`, `room:spectate` | ctx.attach (join), read-only spectate path | Join delegates entirely to attach factory |
| **`registerTournamentAttachHandlers.ts`** | `tournament:attach_assigned_match` | ctx.attach, Supabase match fetch, `dispatchTournamentMatch`, `promoteScheduledMatchToInProgress`, ack-once | Repair dispatch + auto-start + ack finally |
| **`registerRoomAbandonHandlers.ts`** | `room:abandon_match` | `roomForfeit.applyActiveMatchForfeit`, ctx.leaveTrackedRoom | Double terminal check + leave ordering |
| **`registerMatchStartHandlers.ts`** | `player:ready`, `game:start` | `markMatchStartReady`, `tryStartMatchIfReady`, `buildMatchStartDeps`, private vs MM branch | Overlap with attach auto-start on `matchStartReady` |
| **`registerGameplayHandlers.ts`** | `game:action`, `hand:ready` | `act`, `broadcastStateUpdate`, `readyForNextHand`, `maybeFinalizeTournamentMatch` | Gameplay lock + deferred tournament finalize |
| **`registerRematchPregameHandlers.ts`** | `game:rematch`, `game:pregame_draw_pick` | `withRoomGameplayLock`, timers on `room.preGameDrawTimer`, `waitForActiveGameOverPersist`, emit ordering | Timer-nested FSM + rematch sequence watermark |
| **`registerRoomUtilityHandlers.ts`** | `mp:ping`, `player:dragging` | Minimal `getRoom` / `resolveActorSeatId` | Low risk |
| **`registerRoomSessionHandlers.ts`** (orchestrator) | Builds ctx, calls all `register*` functions | `requireRoomSessionHandlerDeps()` once per connection | Registration order if any handler depended on side effects (currently none) |

### 7.3 Suggested extraction sequence (maps to §8 risk ranking)

Execute **smallest blast-radius first**:

1. `registerRoomUtilityHandlers.ts` (`mp:ping`, `player:dragging`)
2. `registerRoomJoinSpectateHandlers.ts` — **only** `room:spectate` first (no attach dep); then `room:join` after attach factory exists
3. `roomForfeit.ts` — move `applyActiveMatchForfeit`; update `disconnectGrace` import in same PR
4. `registerRoomAbandonHandlers.ts`
5. `registerRoomLifecycleHandlers.ts` — `room:create`, `room:leave`; keep disconnect with attach factory
6. `registerGameplayHandlers.ts` — `game:action`
7. `registerGameplayHandlers.ts` — add `hand:ready`
8. `registerMatchStartHandlers.ts`
9. `registerRematchPregameHandlers.ts`
10. `roomSocketAttach.ts` + `registerRoomJoinSpectateHandlers` (`room:join`) + `registerTournamentAttachHandlers.ts` + disconnect integration (**last**)

### 7.4 What stays unchanged (explicit)

| Asset | Reason |
|-------|--------|
| `rooms.ts` in-memory map | Core engine authority |
| `roomSession.ts` roster/broadcast stores | Already extracted Phase P2 |
| `matchStartReady.ts`, `roomGameplayLock.ts`, `disconnectGrace.ts` | Focused modules; only import path tweak for forfeit |
| `initRoomSession` / `RoomSessionHandlerDeps` | DI contract |
| `index.ts` connection order | Matchmaking → scheduled tournament → room session → presence |
| Rate limits in `index.ts` `SOCKET_EVENT_LIMITS` | Already per-event |

### 7.5 Testing strategy per extraction PR

- Run existing suites: `registerRoomSessionHandlers.private`, `.abandon`, `.tournament`, `.privateRoomConfig`, `handReadyGameplayLock`, `tournamentHumanBotFlow`
- `npm run build --prefix server`
- No new behavior assertions required for pure moves; add focused test if attach factory gets its own unit tests

---

## 8. Explicit risk ranking (lowest → highest blast radius)

| Rank | Module / scope | LOC (approx) | Blast radius rationale |
|------|----------------|--------------|------------------------|
| **1 (lowest)** | `mp:ping` + `player:dragging` | ~20 | No room mutation; no deps; no ordering invariants |
| **2** | `room:spectate` | ~65 | Read-mostly; no attach pipeline; separate spectate path |
| **3** | `applyActiveMatchForfeit` → `roomForfeit.ts` | ~100 | Isolated export, but tournament/MM persistence + `disconnectGrace` consumer |
| **4** | `room:create` | ~50 | Creates room; no active gameplay; uses leave helpers |
| **5** | `room:leave` handler | ~15 | Thin wrapper; depends on `leaveTrackedRoom` |
| **6** | `room:abandon_match` | ~95 | Terminal state + forfeit + leave chain |
| **7** | `game:action` | ~65 | Core gameplay; `act` lock; broadcast ordering; tournament finalize deferral |
| **8** | `hand:ready` | ~25 | Coalescing with `nextHandStartsByRoom`; stale hand guard |
| **9** | `player:ready` + `game:start` | ~135 | `matchStartReady` shared with attach auto-start; host/quorum rules |
| **10** | `game:rematch` + `game:pregame_draw_pick` | ~205 | Timers, gameplay lock nesting, rematch emit order, `waitForActiveGameOverPersist` |
| **11 (highest)** | `attachSocketToTrackedRoom` + `room:join` + `tournament:attach_assigned_match` + disconnect/`leaveTrackedRoom` | ~500+ | Reconnect supersession, MM hydrate/wait, MM/tournament auto-start, roster/DB hydrate, `preserveSeat` disconnect race |

---

## Appendix A — File structure map (current)

```
L1–69    imports
L71–79   ForfeitLeavingPlayer type + applyActiveMatchForfeit doc
L81–179  applyActiveMatchForfeit (exported)
L181–183 registerRoomSessionHandlers entry + deps
L184–275 leaveTrackedRoom
L277     __leaveTrackedRoom stash
L279–285 leaveExistingSocketRooms
L287–570 attachSocketToTrackedRoom
L572–621 room:create
L624–689 room:spectate
L691–742 room:join
L744–973 tournament:attach_assigned_match
L975–989 room:leave
L991–1085 room:abandon_match
L1087–1157 player:ready
L1159–1221 game:start
L1223–1225 mp:ping
L1227–1290 game:action
L1292–1317 hand:ready
L1319–1403 game:rematch
L1405–1522 game:pregame_draw_pick
L1524–1538 player:dragging
L1540     close registerRoomSessionHandlers
L1542–1580 handleRoomPlayerDisconnect (exported)
```

---

## Appendix B — Verification commands (investigation pass)

```bash
wc -l server/src/multiplayer/registerRoomSessionHandlers.ts
# → 1580

rg 'socket\.on\(' server/src/multiplayer/registerRoomSessionHandlers.ts
# → 14 handlers (see §2)

rg 'socketsByUserId' server/src/multiplayer/
# → no matches

rg 'finalizeTournamentMatchHook' server/src/multiplayer/
# → no matches (hook in index.ts only)

rg 'registerRoomSessionHandlers' server/src/
# → index.ts:615 + test files
```

---

## Files changed (this pass)

| File | Action |
|------|--------|
| `docs/phase-roomsessionhandlers-investigation-report.md` | **Created** — this report |

**Code changes:** None (investigation-only).

**Build/test:** Not run (no code touched).

**Remaining risks / gaps for future extraction:**

- `socket.__leaveTrackedRoom` should be replaced with explicit context before splitting disconnect from registration.
- MM auto-start in attach vs `player:ready` needs integration test coverage when attach moves to its own module.
- `finalizeTournamentMatchHook` last-connection-wins remains a latent production quirk; decomposition does not fix it.
- `disconnectGrace` circular `require` of `applyActiveMatchForfeit` should be broken when `roomForfeit.ts` is introduced.