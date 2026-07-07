# Phase AA — Task 7: Multiplayer Production Resilience Audit

**Date:** 2026-07-06  
**Scope:** Production-grade multiplayer durability audit — no gameplay, UI, protocol, feature, DB, or matchmaking changes  
**Architecture:** Frozen (audit + low-risk hardening assessment only)  
**Prior context:** Phase Z (`PRODUCTION_READINESS_CERTIFICATION.md`), `MULTIPLAYER_HARDENING_MAP.md` (April 2026 — partially superseded by modular handler refactor)

---

## Executive summary

Racehorse multiplayer is **well-engineered for a single-node deployment** with a formal client recovery stack and strong server-side turn authority. The system can tolerate **browser refresh, WiFi drops, sleep/wake, and multi-tab takeover** for most live matches when `room_live_sessions` is available and a recent snapshot was flushed.

**Primary production risk** remains **process-local authoritative state**: deploy/restart drops in-memory grace timers, reconnect-seat reservations, gameplay locks, and any room not yet persisted. Hydration from Supabase can recover non-terminal matches **if** the 75ms debounced flush completed before shutdown — there is no graceful drain on `SIGTERM`.

**Client-side resilience is ahead of server-side durability.** The recovery FSM, socket event bus (dedup, episode gates, sequence watermarks), and join-ack coordinator provide Chess.com-style reconnect UX **when the room still exists server-side**. Gaps are concentrated in **server idempotency**, **disconnect-grace test coverage**, **in-match E2E chaos**, and **scale limits of in-memory Maps**.

**Certification for this task:** Audit complete. **No code changes implemented** — findings ranked below for a follow-up hardening sprint.

---

## 1. Current architecture

### 1.1 Socket ownership

| Layer | Owner | Notes |
|-------|-------|-------|
| **Transport** | `socket.io` / `socket.io-client` | Server: `server/src/index.ts`; Client: `useMultiplayerConnection.ts` creates one socket per app session |
| **Handler registration** | Modular registrars under `server/src/multiplayer/` | `registerRoomSessionHandlers` composes join, lifecycle, gameplay, rematch, spectate, utility handlers |
| **Client ingress** | `socketEventBus.ts` | Normalized routes for `ROOM_JOIN_OK`, `STATE_UPDATE`, `RESYNC_NEEDED`, `TRANSPORT_FAIL`, `ROOM_JOIN_TERMINAL`; raw handlers via registry |
| **Registry enforcement** | `client/scripts/validateSocketEventRegistry.ts` | 34 raw events, 5 normalized routes, 0 grandfathered direct `socket.on` sites |
| **Identity** | `socket.data.userId` / `socket.data.roomId` | Auth resolved in `roomSession.resolveSocketIdentity`; seat mapping via `roomSocketAttach` |

On connect, the client attaches handlers through `registerMultiplayerConnectionSocketHandlers` and `registerMultiplayerConnectionGameplaySocketHandlers`. Lifecycle events (`connect`, `disconnect`, `connect_error`, `reconnect_failed`, `server:shutdown`) feed the recovery machine.

### 1.2 Room ownership

| Concern | Authority | Location |
|---------|-----------|----------|
| **Room object** | Server process | `server/src/rooms.ts` — `Map<RoomCode, Room>` |
| **Roster (socket ↔ seat)** | Server in-memory | `roomSession.ts` — `roomRosterByCode`, `reconnectSeatsByCode` |
| **Join / attach** | `roomSocketAttach.attachSocketToTrackedRoom` | Hydrates from DB, migrates seat by `userId`, emits `room:session:superseded` on multi-tab |
| **Gameplay mutations** | `act()` wrapped in `withRoomGameplayLock` | Serializes concurrent `game:action`, disconnect grace auto-pass, rematch |
| **Terminal archive** | `room_match_logs` (Supabase) | `roomMatchLogPersistence.ts` on game-over / abandon cleanup |
| **Abandon / forfeit** | `registerRoomAbandonHandlers`, `roomForfeit.ts`, `disconnectGrace.ts` | Intentional leave vs 30s turn grace |

Clients **never** own authoritative game state. They project `state:update` payloads through sequence watermarks (`maxSequenceRef`) and episode projection gates.

### 1.3 State storage

```
┌─────────────────────────────────────────────────────────────────┐
│                     SERVER (single process)                      │
├─────────────────────────────────────────────────────────────────┤
│  rooms Map          ← authoritative GameState + shell metadata   │
│  roomRosterByCode   ← seatId ↔ socketId (ephemeral)              │
│  reconnectSeatsByCode ← 5 min seat reservation on disconnect     │
│  graceTimersByRoom  ← 30s turn grace (disconnectGrace.ts)        │
│  gameplayLock chains ← per-room promise chain                    │
│  live persist debounce ← 75ms → room_live_sessions (Supabase)   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  room_live_sessions  — full unmasked GameState + shell + events │
│  room_match_logs     — terminal archive after cleanup            │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     CLIENT (per tab)                             │
├─────────────────────────────────────────────────────────────────┤
│  React match state (gameState, players, you)                     │
│  recoveryMachine snapshot (idle/connecting/joining/resyncing/…)  │
│  sessionStateMachine (joined room, match started, intentional DC)│
│  localStorage last room code (rejoin hint on refresh)            │
│  socketEventBus dedup / transport replay / episode cursor      │
└─────────────────────────────────────────────────────────────────┘
```

**`room_live_sessions`** stores the **full** `GameState` (all hands, boneyard, dead tiles). Client broadcasts use `maskStateForRecipient`. Debounce is 75ms (`LIVE_PERSIST_DEBOUNCE_MS`).

**Not persisted across restart:** disconnect grace timers, reconnect seat map entries (unless re-derived on join), in-flight gameplay lock queue state, socket↔seat wiring.

### 1.4 Event flow (happy path)

1. **Room creation** — Private lobby or matchmaking creates room in `rooms` Map; optional matchmaking shell hydration.
2. **Join** — Client emits `room:join` → `attachSocketToTrackedRoom` → ack with masked state, `eventMeta`, legal moves.
3. **Match start** — `match:start` / pregame draw → `startGame` → `state:update` broadcast.
4. **Move** — Client `game:action` → `registerGameplayActionHandlers` → `act()` under lock → `broadcastStateUpdate` → optional forced-draw animation payload.
5. **Hand advance** — `hand:ready` with stale/duplicate guard (`stale_or_duplicate_hand_ready`).
6. **Game over** — `broadcastStateUpdate` triggers async persist (ranked stats, match log) when `!room.matchLogged`.

Server appends structured events to `room.events` / `eventSequence`; clients receive `eventMeta` on join and in `state:update`.

### 1.5 Recovery flow (client)

```
SOCKET_LOST / TRANSPORT_FAIL
    → recoveryMachine: connecting → joining (room:join via executeRecoveryRoomJoin)
    → joinAckCoordinator.processJoinAck on ROOM_JOIN_OK
    → RESYNC_NEEDED if projection gap
    → max 5 attempts per episode (MAX_RECOVERY_ATTEMPTS)
    → failed → manual retry / USER_LEAVE
```

**Authority contract** (`recoveryMachine.ts`): recovery state is driven only by recovery machine snapshot + `episodeSequence` gate + socket event bus projection gate.

**Triggers:** socket disconnect, `reconnect_failed`, visibility resume (`multiplayerLifecycleRecovery.ts`), stale sequence regression, `server:shutdown` (sets policy `disabled` + toast).

### 1.6 Reconnect flow (server + client)

**Server on disconnect** (`handleRoomPlayerDisconnect`):

1. `reserveReconnectSeat` — 5-minute seat hold (`RECONNECT_GRACE_MS = 300_000`).
2. `onActivePlayerSocketDisconnect` — 30s turn grace; auto pass/draw if still disconnected on their turn.
3. `leaveTrackedRoom(..., { preserveSeat: true })` — socket leaves room channel but seat preserved.

**Server on rejoin** (`room:join` / attach):

1. `ensureRoomHydrated` — memory hit or DB `room_live_sessions` load.
2. If same `userId` already seated: **force-disconnect old socket**, emit `room:session:superseded`, migrate seat (fixes April hardening-map Bug 4 for current code).
3. `onPlayerSocketRejoined` — clears disconnect grace, emits `player:reconnected`.

**Client on refresh:**

1. Reads `lastRoomStorageKey` from `localStorage`.
2. Opens socket → recovery machine → `room:join` with stored identity.
3. Applies join ack snapshot; resets sequence watermark from server sequence.

---

## 2. Failure matrix

| # | Failure scenario | Current behavior | Risk | Recommendation |
|---|------------------|------------------|------|----------------|
| 1 | **Room creation** | In-memory room + optional DB row on first persist hook | Low | Document single-instance assumption in runbook |
| 2 | **Player join** | `room:join` hydrates DB if missing; rejects `match_abandoned` / `match_completed` | Low | Add integration test for DB hydration + join ack |
| 3 | **Match start** | `matchStartReady` gate + gameplay lock on rematch/pregame | Low | Keep existing `registerMatchStartHandlers.test.ts` in CI |
| 4 | **Move submission** | `act()` validates turn via engine; `withRoomGameplayLock` serializes | Medium | **P1:** server-side `requestId` dedup (logged but not enforced) |
| 5 | **Socket disconnect** | 30s turn grace + 5min seat reserve + `player:disconnected` event | Medium | **P1:** add `disconnectGrace.ts` unit tests |
| 6 | **Socket reconnect** | Auto Socket.IO reconnect → recovery FSM → `room:join` | Low–Med | **P2:** in-match E2E reconnect spec |
| 7 | **Browser refresh** | `localStorage` room hint + join ack full snapshot | Medium | **P1:** verify persist flush completed before deploy |
| 8 | **Duplicate events** | Client: 250ms fingerprint dedup + `transportId` replay set; Server: turn engine rejects illegal replay | Medium | **P1:** server move idempotency by `requestId` + sequence |
| 9 | **Stale clients** | Client drops `state:update` when `sequence < maxSequenceRef` | Low | **P2:** explicit resync RPC on repeated regression |
| 10 | **Server restart/deploy** | `server:shutdown` toast; `SIGTERM` does not drain rooms; hydration on next join if DB row exists | **High** | **P0:** pre-deploy flush + readiness gate; **P1:** graceful shutdown window |
| 11 | **Abandoned rooms** | `scheduleRoomCleanup` after `ROOM_CLEANUP_GRACE_MS` (default 5min); archive to `room_match_logs` | Low | Monitor `/ready` room counts vs DB orphans |
| 12 | **Multiple tabs** | New tab wins: `room:session:superseded` + old socket `disconnect(true)` | Medium | **P2:** client BroadcastChannel tab leader (optional) |

---

## 3. Audit questions

### 3.1 Can two clients ever disagree about game state?

**Under normal operation: no** — single authoritative `room.state` on the server; all clients receive masked `state:update` from the same source.

**Transient divergence is possible when:**

- A client rejects a valid `state:update` due to sequence watermark lag (e.g., rematch ordering — **mitigated** by emitting `game:rematch:started` before `broadcastStateUpdate` in `registerRematchPregameHandlers.ts`).
- A client misses updates during disconnect and applies an older join ack before resync completes.
- Server restart: one client hydrates from DB while another still holds pre-crash local state until rejoin.

**Permanent divergence** requires a server bug (tile invariant violation) or applying a move without lock — **mitigated** by `withRoomGameplayLock` and `assertValidGameState` on commits.

### 3.2 Can a player reconnect after…?

| Condition | Supported? | Mechanism |
|-----------|------------|-----------|
| **Browser refresh** | **Yes** | `localStorage` last room + `room:join` ack snapshot |
| **WiFi drop** | **Yes** | Socket.IO reconnect + recovery FSM + seat migration by `userId` |
| **Sleep/wake** | **Mostly** | `multiplayerLifecycleRecovery` visibility resume → resync; may hit `reconnect_failed` → manual retry |
| **Server reconnect** | **Conditional** | Only if `room_live_sessions` row exists and is non-terminal; 75ms debounce may lose last moves on hard kill |

**Not supported:** abandoned room, completed match, reconnect after 5min seat expiry with empty room cleanup, or join when DB hydration misses (room evicted from memory and no DB row).

### 3.3 What happens if…?

| Event | Behavior |
|-------|----------|
| **Move event arrives twice** | Server: second `game:action` either rejected ("not your turn") or no-ops if same player repeats after turn advanced. `requestId` is audit-logged only — **no dedup**. Client: bus dedup may drop duplicate `state:update` fingerprints within 250ms. |
| **Move arrives out of order** | TCP per-socket ordering preserves server emit order. Client rejects lower `sequence` than watermark (`sequence_regression`). |
| **Player sends stale turn** | Engine throws `"It's not your turn."` → ack `{ ok: false, error }`. Disconnect grace may auto-pass for disconnected current player after 30s. |

### 3.4 What survives a server restart?

| Survives | Lost |
|----------|------|
| `room_live_sessions` row (if flushed, non-terminal) | In-memory `rooms` Map |
| `room_match_logs` for completed/abandoned matches | Disconnect grace timers |
| Ranked games / stats already persisted at game-over | `reconnectSeatsByCode` |
| | Socket↔seat mappings |
| | Gameplay lock chains |
| | Up to ~75ms of mutations not yet debounced |

Recovery path: next `room:join` → `ensureRoomHydrated` → `applyLiveSessionRow` → roster restored from persisted roster entries.

### 3.5 What breaks at 100 vs 1,000 concurrent games?

| Scale | Assessment |
|-------|------------|
| **~100 concurrent** | Likely fine on a single modest Node instance: O(rooms) Maps, per-room lock chains, debounced Supabase writes. `/ready` exposes socket/room counts. |
| **~1,000 concurrent** | **Stress points:** (1) single-process memory for full `GameState` × 1000, (2) Supabase write amplification (75ms debounce × rooms), (3) `broadcastStateUpdate` fan-out, (4) no horizontal room affinity — **second instance would split brain**, (5) OS file descriptor / socket limits. |

**Not a correctness break at 100** if DB and CPU keep up; **operational risk at 1,000** without sticky sessions, room sharding, or external state store.

---

## 4. Ranked recommendations

### P0 — Deploy / restart safety (high ROI, ops + small code)

| Item | ROI | Effort | Notes |
|------|-----|--------|-------|
| **Pre-deploy flush of `room_live_sessions`** | Prevents lost in-flight matches on rolling deploy | Small | Call `flushAllPendingLiveSessions()` (or equivalent) on `SIGTERM` before exit; block shutdown until in-flight persists complete or timeout |
| **Document single-instance contract** | Sets operator expectations | Trivial | Align with Phase Z certification; add to production runbook |
| **Readiness gate excludes active room drain** | Prevents routing to dying node | Small | `/ready` already probes Supabase; extend deploy playbook to wait for connection drain |

*No P0 gameplay or protocol changes required.*

### P1 — Idempotency & test gaps (medium ROI)

| Item | ROI | Effort | Notes |
|------|-----|--------|-------|
| **Server `requestId` dedup for `game:action`** | Prevents double-move on client retry / double-click | Medium | Short TTL cache per `(roomCode, seatId, requestId)` |
| **`disconnectGrace.ts` behavior tests** | Closes highest-risk untested server path | Small | Cover 30s auto-pass, grace clear on rejoin, non-current-player disconnect |
| **Integration test: SIGTERM → hydrate → rejoin** | Validates restart story | Medium | Extend `roomLiveHydration.test.ts` pattern |
| **Game-over persist failure retry** | Prevents silent rating loss | Medium | `room.matchLogged` set only after successful persist (verify current `roomSession` async path) |

### P2 — Hardening polish (lower urgency)

| Item | ROI | Effort | Notes |
|------|-----|--------|-------|
| **In-match Playwright chaos** | Catches regressions in recovery FSM under real socket | Large | Extend `e2e/multiplayer-chaos.spec.ts` beyond hub shell |
| **Explicit resync endpoint** | Faster recovery from sequence gap | Medium | Client already has `RESYNC_NEEDED` path — verify server trigger coverage |
| **Tab leader election (BroadcastChannel)** | Reduces spurious `superseded` | Small | UX polish only; server already handles takeover |
| **Horizontal scaling design** | Future 1k+ games | Large | Out of scope for frozen architecture — document as known limit |

---

## 5. Verification (this task)

| Command | Result |
|---------|--------|
| `npm run check:multiplayer-arch --prefix client` | ✅ Pass — 697 modules, 0 violations |
| `npm run check:multiplayer-cycles --prefix client` | ✅ Pass — 0 cycles |
| `npm run check:socket-registry --prefix client` | ✅ Pass — 34 raw events, 5 normalized routes, 0 grandfathered sites |
| `npx tsx src/multiplayer/*.behaviorTests.ts` (14 files) | ✅ All passed |
| `npx tsx src/multiplayer/session/sessionStateMachine.behaviorTests.ts` | ✅ Passed |
| `npm test --prefix server -- src/multiplayer src/matchmaking/roomShellHydration.test.ts` | ✅ 27 files, 93 tests passed |
| `npm run test:recovery-machine --prefix client` | ⚠️ Fail under `ts-node --esm` (module resolution); **same tests pass via `npx tsx`** |

**E2E note:** `client/e2e/multiplayer-chaos.spec.ts` covers hub-level refresh/offline/visibility only — **not** in-match reconnect.

---

## 6. Files inspected

### Server

- `server/src/index.ts` — socket bootstrap, `server:shutdown`, disconnect routing
- `server/src/rooms.ts` — `Room` type, `act()`, `withRoomGameplayLock`
- `server/src/multiplayer/registerRoomSessionHandlers.ts`
- `server/src/multiplayer/registerRoomJoinHandlers.ts`
- `server/src/multiplayer/registerGameplayActionHandlers.ts`
- `server/src/multiplayer/registerRematchPregameHandlers.ts`
- `server/src/multiplayer/roomSocketAttach.ts`
- `server/src/multiplayer/roomSession.ts`
- `server/src/multiplayer/disconnectGrace.ts`
- `server/src/multiplayer/roomLivePersistence.ts`
- `server/src/multiplayer/roomGameplayLock.ts`
- `server/src/multiplayer/roomLiveHydration.test.ts`
- `server/src/multiplayer/registerRoomSessionHandlers.private.test.ts`

### Client

- `client/src/multiplayer/recoveryMachine.ts`
- `client/src/multiplayer/useMultiplayerConnection.ts`
- `client/src/multiplayer/joinAckCoordinator.ts`
- `client/src/multiplayer/socketEventBus.ts`
- `client/src/multiplayer/useRoomSocketSync.ts`
- `client/src/multiplayer/registerMultiplayerConnectionSocketHandlers.ts`
- `client/src/multiplayer/multiplayerLifecycleRecovery.ts`
- `client/src/multiplayer/roomTransport.ts`
- `client/scripts/validateSocketEventRegistry.ts`
- `client/e2e/multiplayer-chaos.spec.ts`

### Reference docs

- `PRODUCTION_READINESS_CERTIFICATION.md`
- `MULTIPLAYER_HARDENING_MAP.md` (historical — several P0 items addressed in current modular server)

---

## 7. Production risks & next actions

### Top production risks

1. **Rolling deploy without flush** — last ≤75ms of moves may never reach `room_live_sessions`; players see "rejoin from lobby" toast after `server:shutdown`.
2. **Single-instance ceiling** — second server instance would not share `rooms` Map; load balancer without sticky sessions breaks matches.
3. **Server move dedup gap** — aggressive client retry could theoretically submit two actions if first ack is lost and turn has not advanced.
4. **Untested disconnect grace** — 30s auto-pass is production-critical but has **zero** dedicated server tests.
5. **Hub-only E2E chaos** — recovery FSM regression would not be caught by current Playwright suite.

### Recommended next actions (ordered)

1. Implement **P0 graceful persist flush** on `SIGTERM` / deploy hook (isolated, low-risk).
2. Add **`disconnectGrace.ts` behavior tests** (isolated, high confidence ROI).
3. Add **server `requestId` idempotency cache** for `game:action` (bounded TTL Map per room).
4. Extend **E2E** to two-browser in-match disconnect/rejoin (authenticated fixture).
5. Update **production runbook** with single-instance + deploy drain procedure.

---

## 8. Changes made in this task

| Category | Count |
|----------|------:|
| Code changes | 0 |
| Architecture changes | 0 |
| Documentation added | 1 (`docs/production/phase-aa-task-7-multiplayer-resilience-audit.md`) |

**Task 7 status:** Complete — audit report delivered; verification run; ranked follow-ups documented for a future hardening pass.