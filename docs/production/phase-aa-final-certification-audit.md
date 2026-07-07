# Phase AA Production Certification Audit

## 1. Executive Summary

This report concludes the Phase AA Production Hardening Sprint for the Racehorse Dominoes multiplayer system. Over the course of Phase AA (Tasks 8 through 11), the platform has undergone rigorous edge-case testing, E2E validation, process failure hardening, and concurrency serialization audits. 

The architecture is currently frozen. The platform satisfies all target requirements for Phase AA single-instance deployments under high concurrency. We certify the multiplayer system as **CERTIFIED WITH KNOWN LIMITATIONS** due to minor pre-existing client-side rendering edge-case flakes (e.g. React update depth flakes under rapid E2E page transitions) and the documented single-instance memory assumption.

---

## 2. Hardening Sprint Accomplishments

The following key tasks were successfully completed during the Phase AA Sprint:

1. **Task 8: Graceful Shutdown Persistence**
   - Implemented process signal interception (SIGINT/SIGTERM).
   - Created a shutdown manager that halts incoming connections, drains the debounced database persist queue, and blocks the exit process until all active in-flight matches are saved to `room_live_sessions`.
   - Prevented state loss during server updates, crashes, or rolling deployments.

2. **Task 9: Action Idempotency (`game:action`)**
   - Added bounded, room-scoped `requestId` cache inside a thread-safe transaction wrapper.
   - Guaranteed that duplicate client transmissions (due to network retries, lag, or double-clicks) return the cached success response rather than executing state mutations twice.

3. **Task 10: In-Match Reconnect E2E**
   - Implemented and validated mid-match transport recovery, full page refresh re-hydration, and session takeovers for superseded tabs.
   - Ensured a seamless user experience when switching network states or tabs.

4. **Task 11: `hand:ready` Hardening & Disconnect Lifecycle**
   - Added duplicate ready protection check: `if (room.nextHandReady.has(playerSeatId))` to block duplicate hand start signals and event log pollution.
   - Fully covered and tested the disconnect grace timer flow: 30s auto-action (pass/draw) on first turn-based disconnect, and a secondary expiry path that forfeit-abandons the match if the player remains disconnected.
   - Verified that disconnect timers are cancelled and cleared on reconnect or room destruction.

---

## 3. Multiplayer Authority & Concurrency Audit

| Audit Area | Findings & Guardrails | Status |
| :--- | :--- | :--- |
| **Authoritative State Mutations** | All actions go through `act()` and are validated and applied under a serialized in-memory lock (`withRoomGameplayLock`). | **Secured** |
| **Broadcast vs. Commitment** | `commitResolvedGameState` is resolved and local storage is saved before the `state:update` message is broadcasted. Sockets never receive un-committed state. | **Secured** |
| **Sequence Advancement** | Increments sequentially during transactional ticks. Stale socket actions with out-of-order sequence values are rejected. | **Secured** |
| **Ownership Integrity** | Resuming reconnect seats requires verifying the client's cryptographically sound Supabase user ID or reconnect token. Supersession terminates old sockets. | **Secured** |

---

## 4. Recovery Matrix

| Event | Expected Behavior | Implementation | Test Coverage | Remaining Risk |
| :--- | :--- | :--- | :--- | :--- |
| **Temporary Packet Loss** | Client transport auto-reconnects and gets synced with the latest board/hand. | Client Socket.IO reconnect triggers `room:join` and hydrates live room state. | Playwright E2E `transport loss` | Minor UI rendering flickers during connection state transitions. |
| **Socket Close** | Active turn-player triggers a 30s grace timer. | `onActivePlayerSocketDisconnect` manages grace setTimeout. | `disconnectGrace.test.ts` | Lag spikes close to 30s can trigger unintended passes. |
| **Browser Refresh** | Hydrates current state from local storage token and re-establishes socket. | Client checks storage for active `roomCode` and rejoins. | Playwright E2E `refresh recovery` | If server restarts *before* state is debounced (75ms), client might fetch last sync. |
| **Second Tab Takeover** | New tab disconnects old session and resumes match. | `resolveSocketIdentity` handles supersession and shuts old socket. | Playwright E2E `superseded session` | Rapid tab switching can cause race condition on socket registry. |
| **Server Restart** | Server flushes memory on shutdown; client re-fetches from DB. | SIGTERM intercept calls `flushAllPendingLiveSessions`. | `gracefulShutdown.test.ts` | DB connection failure during restart could cause data loss. |
| **Turn Disconnect** | Server auto-acts on behalf of the offline player. | `handleDisconnectGraceExpired` executes PASS/DRAW. | `disconnectGrace.test.ts` | Very rare edge case where no legal actions are available. |
| **Off-Turn Disconnect** | marked offline; grace timer only starts when turn shifts to them. | Checked on turn transition. | `disconnectGrace.test.ts` | Opponent sees offline status but cannot act immediately. |

---

## 5. Persistence & Cleanup Audit

### Memory Leak Verification
- **Timers**: All disconnect grace timers (`graceTimersByRoom`), next-hand advance timers (`nextHandStartsByRoom`), and room cleanup timers are cleared on execution or cancellation.
- **Orphan Metadata**: When a room is destroyed or cleaned up (via `clearRoomMetadata`), all associated rosters, reconnect seats, and game action caches are cleared. Disconnect grace timers are also explicitly cancelled.
- **Unbounded Queues**: `pendingPersistByRoomCode` and `inFlightPersistByRoomCode` are purged as soon as the respective database operations resolve or error out.

### Hydration Mechanics
- Sockets reconnecting to active matches request room join. If the room has been evicted from memory (e.g. after a restart), the server lazily loads the room from `room_live_sessions` via `ensureRoomHydrated()` and restores active game state, rosters, and event logs.

---

## 6. Test Inventory

The following test suites protect multiplayer correctness and resilience:

- **Unit Tests (Vitest)**:
  - `src/multiplayer/disconnectGrace.test.ts` (9 tests covering disconnect grace, reconnect, forfeit lifecycle, and timer cleanup).
  - `src/multiplayer/handReadyGameplayLock.test.ts` (5 tests covering race conditions, duplicate ready block, concurrent ready block, and different player advancement).
  - `src/multiplayer/gameActionIdempotency.test.ts` (5 tests covering `requestId` duplicates).
  - `src/platform/gracefulShutdown.test.ts` (3 tests covering SIGINT/SIGTERM flush and timeouts).
  - `src/multiplayer/roomForfeit.test.ts` (forfeit validations).
- **End-to-End Tests (Playwright)**:
  - `client/e2e/multiplayer-in-match-reconnect.spec.ts` (E2E scenarios for transport recovery, browser reload, and session supersession).
- **Architecture Validation**:
  - `depcruise` verifies that `src/multiplayer` follows locked architectural boundary rules.
  - `validateSocketEventRegistry.ts` verifies event registrations.

---

## 7. Recommended Next Phase (Phase AB)

To support multi-instance load balancing, we recommend the following enhancements in Phase AB:
1. **External State Store**: Replace the local in-memory rooms map with a fast external cache (Redis) or shared Postgres tables.
2. **Distributed Locks**: Transition from local `withRoomGameplayLock` to a distributed lock manager (e.g., Redlock via Redis) to synchronize concurrent actions across server instances.
3. **Socket.IO Scaling**: Configure the Redis Adapter for Socket.IO to enable cross-instance event broadcasting.

---

## 8. Deployment Assumptions & Limitations
- **Single Instance**: The current version must run on a single Node.js container instance. Horizontal scaling without Redis will break room synchronization.
- **Client Rendering Flakes**: Under rapid navigation transitions (such as guest lobby join in serial E2E tests), the React components occasionally hit a pre-existing "Maximum update depth exceeded" crash. This is client-side only and does not affect server-side multiplayer correctness.
