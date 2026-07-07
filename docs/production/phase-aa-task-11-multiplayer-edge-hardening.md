# Phase AA Task 11: Multiplayer Edge-Case Hardening

## Overview
This document reviews the multiplayer edge-case hardening audit and implementations completed under Phase AA Task 11. It covers the server-side idempotency safeguards added to the `hand:ready` handler, the disconnect/forfeit lifecycle, and documents the operational assumptions and remaining constraints of the current system.

---

## 1. `hand:ready` Idempotency Analysis

### Flow Audit
Previously, the `hand:ready` endpoint was not serializing mutations or deduplicating incoming events in the same way `game:action` did. If a player sent duplicate `hand:ready` emissions rapidly (either due to network retransmissions, double-clicks, or client bugs) before the second player marked themselves ready:
- The server did not reject the second call as a duplicate.
- A duplicate `hand_ready` event was appended to `room.events`.
- This triggered duplicate state broadcasts and redundant database writes.

### Implementation
We introduced a room-scoped duplicate guard in [rooms.ts](file:///Users/olivermorid/racehorse-dominoes/server/src/rooms.ts#L663-L670):
```typescript
if (room.nextHandReady.has(playerSeatId)) {
  return { kind: 'return', value: { started: false, room, ignored: true } };
}
```
If a player is already marked ready in `room.nextHandReady` (and the next hand transition has not yet occurred), any subsequent `hand:ready` request from that same player returns `ignored: true`. The socket handler maps this status directly to a `stale_or_duplicate_hand_ready` error response, matching the behavior of stale hand requests.

### Coverage Added
In [handReadyGameplayLock.test.ts](file:///Users/olivermorid/racehorse-dominoes/server/src/multiplayer/handReadyGameplayLock.test.ts), we added:
- **Duplicate ready from the same player**: Verifies duplicate ready requests are rejected with `stale_or_duplicate_hand_ready` and that no duplicate event is appended.
- **Concurrent duplicate ready calls**: Simulates rapid concurrent ready calls through `Promise.all` and verifies that the lock serialization permits exactly one success and rejects the other as ignored.
- **Different players**: Verifies that both players can successfully mark themselves ready to start the next hand.
- **Stale ready calls**: Verifies that stale ready calls (with incorrect hand numbers) continue to be rejected as expected.

---

## 2. Disconnect & Forfeit Lifecycle

### Lifecycle Flow
The multiplayer disconnect recovery lifecycle operates under the following rules:
1. **Turn-Based Disconnect Detection**: When a player on turn disconnects, the socket server triggers a grace timer of 30 seconds (`DISCONNECT_GRACE_MS`).
2. **First Expiry (Auto-Action)**: If the timer expires before the player reconnects, the server auto-acts on behalf of the player (either passing if a pass is legal, or drawing from the boneyard). The turn then advances.
3. **Turn Return / Remaining Disconnected**: If the turn advances back to the disconnected player, a second grace timer is scheduled.
4. **Second Expiry (Forfeit)**: If the second grace timer expires, the forfeit path executes. The match is marked abandoned, the active player is forfeited, and the online player is awarded the win.
5. **Reconnect / Grace Reset**: If the player reconnects before any timer expires, the grace timer is cancelled and the disconnect counter is reset.

### Cleanup Integration
To prevent stale grace timers from lingering when a room is destroyed, we modified [roomSession.ts](file:///Users/olivermorid/racehorse-dominoes/server/src/multiplayer/roomSession.ts#L246-L251) to clear disconnect grace timers during metadata cleanup:
```typescript
export function clearRoomMetadata(roomCode: string): void {
  deleteRoomRoster(roomCode);
  reconnectSeatsByCode.delete(roomCode);
  clearGameActionIdempotencyForRoom(roomCode);
  clearDisconnectGrace(roomCode);
}
```

### Coverage Added
In [disconnectGrace.test.ts](file:///Users/olivermorid/racehorse-dominoes/server/src/multiplayer/disconnectGrace.test.ts), we added:
- **Full disconnect/forfeit lifecycle on second expiry**: Verifies the double-expiry forfeit logic under fake timers, ensuring that `room.abandonedAt` is populated, and `'room:match_abandoned'` is emitted.
- **Reconnect after first expiry but before room cleanup**: Verifies that reconnecting resets the disconnect counters and cancels active grace timers.
- **Room cleanup clears timers**: Verifies that clearing room metadata cancels any active disconnect grace timers.

---

## 3. Production & Architectural Assumptions

### Single-Instance Deployment Assumption
The current system runs entirely in memory on a single server instance. All active rooms, state locks, and disconnect timers (`graceTimersByRoom`, `nextHandStartsByRoom`, etc.) are held in local variables.
- **Limitation**: The system does not support multi-instance horizontal scaling out of the box. Running behind a load balancer with multiple instances would result in split-brain behavior (e.g. rooms created on one instance would not be visible or joinable on another, and locks would not be synchronized).
- **Scale Requirements**: Moving to a multi-instance model would require externalizing room state to Redis or a shared database, using Redis adapters for Socket.IO, and employing a distributed locking mechanism (like Redlock) to replace local gameplay locks.
- **Boundary**: In alignment with current Phase AA limits, state externalization and multi-instance scaling remain out of scope. The platform is hardened for single-instance, high-fidelity daily play.
