# Phase AA — Task 8: Graceful Shutdown Persistence Hardening

**Date:** 2026-07-06  
**Scope:** Server shutdown path only — no gameplay, protocol, client, or matchmaking changes  
**Architecture:** Frozen (in-memory room ownership + Supabase `room_live_sessions` unchanged)

---

## 1. Problem

Live multiplayer rooms are persisted to Supabase `room_live_sessions` through a **75ms debounced** write path (`schedulePersistLiveRoomSession`). On deploy or `SIGTERM`, the Node process could exit while:

- Debounce timers had not fired
- Pending rows remained in `pendingPersistByRoomCode`
- In-flight upserts had not completed

Players reconnecting after restart could hydrate **stale** game state (Phase AA Task 7 P0 finding).

---

## 2. Root cause

`server/src/index.ts` previously handled `SIGTERM` / `SIGINT` by emitting `server:shutdown` to clients only. There was **no**:

- HTTP listener drain
- Flush of debounced live-session writes
- Socket server close before exit
- Timeout guard against hung Supabase calls

`flushScheduledLiveRoomPersistence()` existed in `roomLivePersistence.ts` but was **never wired** to process signals.

---

## 3. Implementation

### 3.1 Centralized flush — `flushAllPendingLiveSessions()`

**File:** `server/src/multiplayer/roomLivePersistence.ts`

| Behavior | Detail |
|----------|--------|
| Drain debounced pending | Cancels timers, upserts all `pendingPersistByRoomCode` entries |
| Await in-flight upserts | Per-room promise coalescing avoids duplicate concurrent writes |
| Shutdown mode | Sets `persistenceShuttingDown` — new schedules update pending but skip debounce timers |
| Timeout | Default **10s** (`DEFAULT_SHUTDOWN_FLUSH_TIMEOUT_MS`); logs warning and continues on timeout |
| Concurrency | Concurrent flush callers share one in-flight promise |

Existing `flushScheduledLiveRoomPersistence()` now returns `{ flushedRoomCodes }` for observability.

### 3.2 Graceful shutdown orchestrator

**File:** `server/src/platform/gracefulShutdown.ts`

Registered from `server/src/index.ts` via `registerGracefulShutdownHandlers({ server, io })`.

### 3.3 Ingress hardening

| Change | File |
|--------|------|
| Reject new socket connections during shutdown | `io.use()` middleware in `index.ts` |
| `/ready` returns **503** while shutting down | `registerHealthRoutes.ts` adds `shuttingDown` flag |

---

## 4. Shutdown lifecycle

```
SIGTERM / SIGINT
    ↓
gracefulShutdownInProgress = true
persistenceShuttingDown = true
    ↓
io.emit('server:shutdown', { reason: 'server_restart', signal })
    ↓
server.close() — stop accepting new HTTP connections
    ↓
flushAllPendingLiveSessions({ timeoutMs: 10_000 })
    ↓
io.close() — close socket server
    ↓
process.exit(0)
```

**Unchanged:** Client `server:shutdown` handler (toast + recovery policy `disabled`). No new socket events.

---

## 5. Tests added

| File | Coverage |
|------|----------|
| `server/src/multiplayer/roomLivePersistence.flush.test.ts` | Queued debounce flush; dirty pending flush; timeout continues; in-flight dedup |
| `server/src/platform/gracefulShutdown.test.ts` | SIGTERM order (HTTP close → flush → socket close → exit); flush before exit; timeout path |

---

## 6. Verification

| Command | Result |
|---------|--------|
| `npm run test --prefix server` | Pass (full suite including new tests) |
| `npm run build --prefix server` | Pass |
| `npm run check:multiplayer-arch --prefix client` | Pass |
| `npm run check:socket-registry --prefix client` | Pass |

**Confirmed unchanged:**

- Gameplay rules and `act()` locking
- Socket event names and payloads (`server:shutdown` shape identical)
- Client recovery architecture
- Supabase schema / persistence model

---

## 7. Remaining risks

| Risk | Severity | Notes |
|------|----------|-------|
| Moves in tiny window after `server:shutdown` emit but before flush | Low | Existing sockets may still process until `io.close()`; window is milliseconds |
| Flush timeout with hung Supabase | Medium | Shutdown continues after 10s; last writes may be lost — monitor `[room-live-sessions] shutdown flush timed out` logs |
| Disconnect handlers after `io.close()` | Low | No second flush pass; disconnect paths rarely commit new game state |
| Multi-instance deploy | High (known) | Out of scope — still requires single-instance or sticky routing |
| `npm run test:recovery-machine` ts-node ESM | Info | Unrelated; behavior tests pass via `tsx` |

---

## 8. Files changed

| File | Change |
|------|--------|
| `server/src/multiplayer/roomLivePersistence.ts` | `flushAllPendingLiveSessions`, in-flight dedup, shutdown flag |
| `server/src/platform/gracefulShutdown.ts` | New orchestrator |
| `server/src/index.ts` | Register handlers, socket middleware |
| `server/src/platform/health/registerHealthRoutes.ts` | `/ready` 503 during shutdown |
| `server/src/multiplayer/roomLivePersistence.flush.test.ts` | New tests |
| `server/src/platform/gracefulShutdown.test.ts` | New tests |
| `docs/production/phase-aa-task-8-graceful-shutdown.md` | This document |

**Task 8 status:** Complete.