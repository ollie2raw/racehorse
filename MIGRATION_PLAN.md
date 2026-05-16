# Migration plan: stable `playerSeatId` vs ephemeral `socket.id`

**Scope:** Priority 1 only — introduce a stable seat identifier for multiplayer rooms and game state; reconnect updates socket mapping only (no rewriting `GameState` keys).

**Explicitly out of scope for this plan:** tournament lobby objects keyed by `socketId`, matchmaking queue identity (`matchmaking/index.ts`), Fritz/bot synthetic ids (`bot:fritz:*`), puzzle generators, league types — unless they consume multiplayer room roster shapes.

---

## 1. Current architecture (problem summary)

| Layer | Today | Failure mode on reconnect |
| --- | --- | --- |
| `Room.players` | `string[]` of **socket ids** (seat order) | Must align with `GameState`; rewritten on migrate |
| `GameState.playerIds` / `players` | keyed by **socket id** | `migrateRoomSeat` rewrites ids + maps (`ghostMoveLogs`, scores, Sets…) |
| `RoomPlayer.id` (roster) | socket id | Roster row rewritten on reconnect |
| Socket.IO routing | `socket.id` doubles as engine player id | `broadcastStateUpdate` treats adapter-room socket ids as player ids via `playerIds.includes(socketId)` |

Any missed structure during migration causes desync.

---

## 2. Target architecture

1. **`playerSeatId`**: stable UUID, assigned on **first seat assignment** (create/join as player), never changes for that seat for the match lifecycle.
2. **`socketId`**: current Socket.IO connection id; updated on reconnect only.
3. **`GameState.playerIds`** and **`GameState.players`** keys: **`playerSeatId`** only (bots keep existing synthetic ids such as `bot:fritz:*`).
4. **`Room.players`**: ordered **`playerSeatId[]`** aligned with engine seat order (matches `GameState.playerIds`).
5. **Roster (`RoomPlayer`)**: `id` = **`playerSeatId`** (stable client “seat” key); add **`socketId`** for routing/debug.
6. **`migrateRoomSeat`**: update roster `socketId` (and `socket.data` mapping); **do not** mutate `GameState` keys.
7. **Authoritative helpers** (`assertCurrentPlayer` / `getLegalMoves` / `canDraw` / `applyMove`): already keyed by arbitrary string ids via `engine.ts`; callers must pass **`playerSeatId`** (resolve socket → seat at handler boundary).
8. **`broadcastStateUpdate`**: resolve each connected socket → **`playerSeatId`** for masking, `legalMoves`, `canDraw`; emit per-recipient **`you: playerSeatId`** (see §6).
9. **Client `youRef`**: **`playerSeatId`** from **`room:create` / `room:join` ack** (`resp.you`), **not** `socket.id` after join (initial connect may still briefly use socket id until ack — plan eliminates reliance on that).

---

## 3. Parallel grep inventory (files & constructs)

### 3.1 `socket.id` — multiplayer‑critical paths

| File | Usage notes |
| --- | --- |
| `server/src/index.ts` | **Dominant:** room lifecycle, `migrateRoomSeat`, `broadcastStateUpdate`, join/create acks, `game:action` → `act(...)`, disconnect/reconnect, `io.to(...)`, tournament bridges, lead tracker / persistence helpers reading roster by id |
| `server/src/rooms.ts` | `createRoom(hostSocketId)`, `joinRoom(socketId)`, `readyForNextHand(socketId)`, `act(socketId, ...)`, ghost append, events — parameter names imply socket today |
| `server/src/multiplayer/disconnectGrace.ts` | `playerId` stored === socket id; compares `currentId` from state (today both socket); **`io.sockets.sockets.get(disconnectedPlayerId)` breaks once `playerId` is seat id** |
| `server/src/multiplayer/matchStartReady.ts` | `matchStartReady` Set membership vs `room.players` entries |
| `client/src/multiplayer/useMultiplayerConnection.ts` | **`youRef.current = s.id`** on connect; **`hand:ended`** uses `s.id` / `myId`; **`player:dragging`** compares `payload.playerId === s.id`; **`tournament:match:assigned`** compares `data?.a === s.id` |
| `client/src/App.tsx` | `applyJoinedRoomResponse` fallback `socket?.id`; seating checks `roster.some(p => p.id === resolvedYou)` |
| `client/src/screens/TournamentScreen.tsx` | host comparison uses `socket.id` vs `hostSocketId` — tournament scope |
| `client/scripts/socketSmoke.mjs` | Heavy assertions: `state.players?.[client.socket.id]`, `rejoinResp.you === reconnect.socket.id`, `playerIds.includes(alpha.socket.id)`, etc. |

Non‑blocking for core Priority 1 (keep in backlog): `server/src/matchmaking/index.ts`, `docs/**`, `MULTIPLAYER_HARDENING_MAP.md`.

### 3.2 `playerIds` / `players[playerKey]`

| File | Role |
| --- | --- |
| `server/src/game/engine.ts` | Turn/scoring loops — **no change** if ids are opaque strings |
| `server/src/game/invariants.ts` | Validates structural consistency |
| `server/src/game/types.ts` | `GameState` shape unchanged semantically |
| `server/src/rooms.ts` | `startGame` / `nextHand` initialize `ghostMoveLogs`, `lastBroadcastScores` from `room.players` / `playerIds` |
| `server/src/index.ts` | `maskStateForRecipient`, `getHandCounts`, persistence (`appendMatch`), `buildHandEndedPayload`, lead tracker |
| `client/src/App.tsx` | Turn UI, opponent resolution, spectating checks vs `you` |
| `client/src/types.ts` | Client `GameState` typing |
| `client/src/multiplayer/useRoomSocketSync.ts` | Guards using `youRef` vs `playerIds` |
| `client/src/multiplayer/handIdentity.ts` | Hand integrity vs `youRef` |
| `client/src/multiplayer/boardSnapshotGuards.ts` | Structural guards |

### 3.3 `ghostMoveLogs`

| Location | Today |
| --- | --- |
| `server/src/rooms.ts` | `Record<string, GhostMoveLogEntry[]>`, reset keyed by `room.players` |
| `server/src/index.ts` | `migrateRoomSeat` rewrites keys; ranking path `room.ghostMoveLogs[p.me.id]` |

**After migration:** keys are **`playerSeatId`** only; **no migrate rewrite**.

### 3.4 `nextHandReady`

| Location | Today |
| --- | --- |
| `server/src/rooms.ts` | `Set<string>` compared to `room.players` |
| `server/src/index.ts` | `migrateRoomSeat` transfers membership by socket swap |

**After migration:** Set stores **`playerSeatId`**; reconnect **does not touch** Set.

### 3.5 `lastBroadcastScores`

| Location | Today |
| --- | --- |
| `server/src/rooms.ts` | Initialized from `playerIds` |
| `server/src/index.ts` | `migrateRoomSeat` rewrote keys |

**After migration:** keyed by **`playerSeatId`** only.

### 3.6 `matchStartReady`

| Location | Today |
| --- | --- |
| `server/src/rooms.ts` | Cleared on `startGame` |
| `server/src/multiplayer/matchStartReady.ts` | `requiredStartPlayers()` returns `room.players`; Set holds socket ids |

**After migration:** **`playerSeatId`** throughout.

### 3.7 `disconnectGrace`

| Location | Today |
| --- | --- |
| `server/src/multiplayer/disconnectGrace.ts` | Timer `playerId`, emits `player:disconnected`, compares turn id, **`io.sockets.sockets.get(disconnectedPlayerId)`** |
| `server/src/index.ts` | Imports; passes `socket.id` into `onActivePlayerSocketDisconnect`; **`onPlayerSocketRejoined(..., socket.id)`** |

**After migration:** grace **`playerId` = `playerSeatId`** for engine calls; **connection checks** must resolve **seat → socket** (or “any socket for seat”).

### 3.8 `migrateRoomSeat`

| Location | Today |
| --- | --- |
| `server/src/index.ts` | Rewrites `room.players[idx]`, full `GameState` player map & `playerIds`, `lastBroadcastScores`, `ghostMoveLogs`, `nextHandReady`, `rematchReady`, roster `id` |

**After migration:** **roster `socketId` + optional socket.data.bookkeeping only** (see §6).

### 3.9 Additional socket‑as‑player coupling (must be addressed with seat→socket map)

| Construct | File(s) | Issue |
| --- | --- | --- |
| `broadcastStateUpdate` loop | `server/src/index.ts` | `playerIds.includes(socketId)` for `isPlayer` / `recipientPlayerId`; `getRoomLegalMoves(roomCode, socketId)` |
| Self‑heal join | `server/src/index.ts` | `io.sockets.sockets.get(pid)` where `pid` is player id |
| `emitForcedDrawAnimationPayload` | `server/src/index.ts` | `io.to(payload.playerId)` — Socket.IO room name must be **socket id** or use **`socket.to(room)` + targeted emit** |
| `pendingForcedDrawBroadcast.playerId` / `pendingAutoPassNotice` | `server/src/rooms.ts`, `server/src/index.ts` | Values flow to clients — should be **`playerSeatId`** consistently |
| `scheduleRoomCleanup` / `evaluateRoomLifecycle` | `server/src/index.ts` | `io.sockets.sockets.has(pid)` on `room.players` |
| `clearSocketRematchReady` | `server/src/index.ts` | keyed by socket today |
| `game:rematch:status` `readyPlayerIds` | `server/src/index.ts` | derived from `room.players` ∩ `rematchReady` |
| `appendRoomEvent` `actorSocketId` | `server/src/rooms.ts`, `server/src/index.ts` | audit field — can remain literal socket id **or** add parallel `actorSeatId` (optional) |
| `reserveReconnectSeat` | `server/src/index.ts` | stores `oldSocketId`; matching logic must locate **seat** (by roster / seat id) |
| `player:dragging` | `server/src/index.ts`, `client/.../useMultiplayerConnection.ts` | payload `playerId` today socket — **should be seat id** for client comparison vs `youRef` |

---

## 4. Files expected to change (Priority 1)

| File | Risk | Why |
| --- | --- | --- |
| `server/src/index.ts` | **High** | `migrateRoomSeat`, `broadcastStateUpdate`, join/create/rematch/disconnect paths, persistence roster lookups (`byId.get(aId)` must use seat ids), Socket.IO routing fixes |
| `server/src/rooms.ts` | **High** | `Room` comment + `createRoom`/`joinRoom`/`startGame`/`readyForNextHand`/`act` parameter semantics; initialization of Sets/Records; **`createRoom` first argument becomes seat‑creation responsibility** |
| `server/src/multiplayer/disconnectGrace.ts` | **High** | Seat‑aware grace + **socket lookup fix** |
| `server/src/multiplayer/matchStartReady.ts` | **Medium** | `requiredStartPlayers` / Set membership vs seat ids |
| `client/src/multiplayer/useMultiplayerConnection.ts` | **High** | Stop binding `youRef` to `socket.id`; fix **`hand:ended`**, **`player:dragging`**, any **`s.id`** used as multiplayer seat |
| `client/src/App.tsx` | **Medium** | Fallbacks / deps using `socket?.id` where seat should win |
| `client/scripts/socketSmoke.mjs` | **Medium** | Update assertions to **`resp.you`** / roster `id` / state keys (**no longer** `socket.id`) |
| `MIGRATION_PLAN.md` | Low | This document |

**Lower risk / verify-only:**

| File | Risk | Notes |
| --- | --- | --- |
| `client/src/multiplayer/useRoomSocketSync.ts` | Low–medium | Mostly `youRef` driven — verify `forcedDrawActorId` / `playerId` comparisons |
| `client/src/screens/TournamentScreen.tsx` | Low | Tournament host detection — likely unchanged if tournament stays socket‑based |

**Likely unchanged (opaque player ids already):**

- `server/src/game/engine.ts`
- `server/src/game/invariants.ts`
- `server/src/game/__tests__/*.test.ts`

---

## 5. Recommended implementation order (avoid broken intermediate states)

1. **Define roster shape + helpers (server)**  
   - Extend `RoomPlayer` with `socketId`.  
   - Add **`seatId`** naming in code comments if needed for clarity (`id` remains seat for wire compatibility).  
   - Central helpers: **`getSeatIdForSocket(roomCode, socketId)`**, **`getSocketForSeat(roomCode, seatId)`** (iterate roster), **`ensureSocketDataSeat(socket, seatId)`**.

2. **Change seat allocation on `room:create` / first seat**  
   - Generate `playerSeatId` (`crypto.randomUUID()`).  
   - `Room.players = [seatId]`; roster `[{ id: seatId, socketId, username, userId }]`.  
   - `socket.data.playerId = seatId` (or introduce `socket.data.playerSeatId` consistently — pick **one** field and document).

3. **`room:join` (fresh seat)**  
   - Allocate new `playerSeatId`; push to `room.players`; roster append; **do not** use `socket.id` as id.

4. **`migrateRoomSeat` collapse**  
   - Replace body with: find roster row by **`playerSeatId`** (or old socket → resolve seat once), set **`socketId`**, update `socket.data`, optional indexes; **remove** `GameState` mutation block entirely.

5. **Reconnect paths (`room:join` / `reconnectSeats`)**  
   - Match identity → seat via roster / reconnect tokens carrying **`seatId`** (extend `ReconnectSeat` with `seatId`).  
   - Call trivial `migrateRoomSeat` socket swap only.

6. **`startGame` / `nextHand` / ghost init**  
   - Confirm `createInitialState(room.players)` receives **seat ids**; **`ghostMoveLogs`** / **`lastBroadcastScores`** keyed by seat ids without migrate.

7. **Handlers: translate socket → seat at boundary**  
   - `game:action`, `hand:next` / ready, rematch: resolve **actor seat** once, call `act(code, seatId, …)` etc.  
   - Update `clearSocketRematchReady` to resolve seat from socket or accept seat id.

8. **`broadcastStateUpdate` (critical)**  
   - Replace `playerIds.includes(socketId)` with socket→seat resolution.  
   - `getRoomLegalMoves` / `getRoomCanDraw` — pass **seat id**.  
   - Self‑heal loop: iterate **roster** / seat ids and join using **current socket id**.  
   - `emitForcedDrawAnimationPayload`: resolve **seat → socket** for `io.to`.  
   - Add **`you`** field on **`state:update`** payload (**`playerSeatId` per recipient**).

9. **`disconnectGrace` + disconnect handler**  
   - Pass **seat id** into grace; fix `io.sockets.sockets.get` using **resolved socket from roster**.  
   - `onPlayerSocketRejoined`: emit **`playerId: seatId`** consistently (client already ignores self by `youRef`).

10. **Client: `youRef` source of truth**  
   - On `connect`, **do not** set `youRef` from `socket.id` if join will follow — or set temporary but **overwrite** immediately from ack (prefer: only set from ack + `applyJoinedRoomResponse`).  
   - Replace **`hand:ended`** / **`player:dragging`** `s.id` comparisons with **`youRef.current` / resolved seat**.

11. **`socketSmoke.mjs`**  
   - Align all “am I this player?” checks with **`resp.you`** and roster **`id`**, not **`client.socket.id`**.

12. **Full verification**  
   - Per user instruction after implementation:  
     `npm run build --prefix server && npm run build --prefix client` (iteratively), then `cd server && npm test` until **148 passed**.

---

## 6. Wire protocol / payload changes (client-visible)

| Payload | Change |
| --- | --- |
| `room:create` / `room:join` ack `you` | **`playerSeatId`** (stable) |
| `room:update` `players[]` | `id` = **`playerSeatId`**, include **`socketId`** (optional for UI; **do not** use as engine key client-side) |
| `state:update` | Add top-level **`you: playerSeatId`** (per socket); **`state.playerIds` / `state.players`** keys = seat ids |
| `player:disconnected` / `player:reconnect_timeout` | Prefer **`playerId` = playerSeatId** (client compares to `youRef`) |
| `player:dragging` | **`playerId` = playerSeatId** |
| `game:rematch:status` `readyPlayerIds` | seat ids |

---

## 7. Risk summary by file

| File | Risk | Top reasons |
| --- | --- | --- |
| `server/src/index.ts` | **High** | Largest surface; broadcast + persistence + draw animation routing; easy to miss one socket↔seat path |
| `server/src/rooms.ts` | **High** | All room Sets/Records must stay consistent with seat model |
| `server/src/multiplayer/disconnectGrace.ts` | **High** | Silent failure if connection check uses seat as socket map key |
| `client/src/multiplayer/useMultiplayerConnection.ts` | **High** | Wrong `youRef` poisons every downstream guard |
| `client/scripts/socketSmoke.mjs` | **Medium** | Test updates are numerous but mechanical |
| `client/src/App.tsx` | **Medium** | Edge fallbacks during reconnect racing |
| `server/src/multiplayer/matchStartReady.ts` | **Medium** | Wrong Set keys block match start |

---

## 8. Post‑implementation checklist

- [ ] Reconnect twice in a row: **no** change to `GameState.playerIds` ordering or keys (only roster `socketId` changes).  
- [ ] Active player disconnect: grace auto‑act still runs (`getLegalMoves` / `canDraw` use seat id).  
- [ ] Forced draw animation still targets correct **connection**.  
- [ ] Spectators still receive masked state (`recipientPlayerId === null`).  
- [ ] Bots (`bot:fritz:*`) unchanged in seat ordering.  
- [ ] `npm test` (server) → **148 passed**; client + server builds clean.

---

**Stop point:** No code changes until explicit **“proceed”** from the requester.
