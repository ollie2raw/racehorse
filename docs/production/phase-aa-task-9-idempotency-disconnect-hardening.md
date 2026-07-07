# Phase AA — Task 9: Idempotency & Disconnect Grace Hardening

**Date:** 2026-07-06  
**Scope:** Server-side `game:action` idempotency + `disconnectGrace.ts` behavior tests  
**Architecture:** Frozen — no gameplay rules, protocol, client, matchmaking, or schema changes

---

## 1. Root cause

### 1.1 `game:action` requestId gap (P1 from Task 7)

`requestId` was accepted on `ActionPayload` and logged in `drawAudit`, but **`registerGameplayActionHandlers` always called `act()`** on every submission. Client retries or double-acks after a successful mutation could:

- Apply the same move twice (if turn state still allowed it)
- Re-broadcast `state:update` unnecessarily
- Advance `sequence` more than once for one user intent

Client socket bus dedup does not protect **server authority**.

### 1.2 `disconnectGrace.ts` untested (P1 from Task 7)

30-second turn grace and auto-pass/draw on expiry are production-critical disconnect behavior with **zero dedicated tests**. Regressions would surface only in live play.

---

## 2. Implementation

### 2.1 Server `game:action` idempotency

**New file:** `server/src/multiplayer/gameActionIdempotency.ts`

| Mechanism | Detail |
|-----------|--------|
| Cache key | `(roomCode, playerSeatId, requestId)` |
| RequestId normalization | Non-empty trimmed string, max 128 chars; missing/invalid → pass-through (legacy clients) |
| Cached results | **Successful** acks only (`ok: true` + `sequence` + optional `forcedDraw`) |
| Failed actions | Not cached — retries can re-execute after turn/state changes |
| In-flight coalescing | Concurrent duplicate `requestId` shares one `act()` execution |
| TTL | 5 minutes per entry (`GAME_ACTION_IDEMPOTENCY_TTL_MS`) |
| Bound | Max 128 entries per room; oldest evicted |
| Room cleanup | `clearGameActionIdempotencyForRoom()` wired into `clearRoomMetadata()` |

**Integration:** `registerGameplayActionHandlers.ts` wraps the `act()` + broadcast path in `withGameActionIdempotency()`. Duplicate submissions return cached ack with `duplicate: true` and **do not** re-broadcast.

### 2.2 `disconnectGrace` test harness

**Exports added for tests (no protocol change):**

- `DISCONNECT_GRACE_MS`
- `hasActiveDisconnectGrace(roomCode)`
- `getActiveDisconnectGracePlayerId(roomCode)`
- `resetDisconnectGraceForTests()`

**Minor internal fix:** Room code keys normalized to uppercase in grace timer map (consistent lookup).

**New file:** `server/src/multiplayer/disconnectGrace.test.ts` — 6 behavior tests with fake timers.

---

## 3. Behavioral impact

| Scenario | Before | After |
|----------|--------|-------|
| Same `requestId` retry after success | Second `act()` + broadcast | Cached ack, `duplicate: true`, no mutation/broadcast |
| Same `requestId` after failure | Second `act()` | Second `act()` (unchanged) |
| No `requestId` | Normal | Normal (unchanged) |
| Different players, same `requestId` | Independent | Independent (unchanged) |
| Disconnect grace | Untested | Covered by unit tests |

**Not changed:** Game engine rules, turn validation inside `act()`, socket event names/payloads, client recovery.

---

## 4. Tests added

| File | Tests |
|------|------:|
| `gameActionIdempotency.test.ts` | 5 — duplicate replay, player isolation, distinct ids, failure retry, TTL/cleanup |
| `disconnectGrace.test.ts` | 6 — grace start, reconnect cancel, auto-pass, auto-draw, non-current player, multi-cycle |
| `registerGameplayActionHandlers.test.ts` | +1 — handler integration (single `act()`, single broadcast) |

---

## 5. Verification

| Command | Result |
|---------|--------|
| `npm run test --prefix server` | Pass (full suite) |
| `npm run build --prefix server` | Pass |
| `npm run check:multiplayer-arch --prefix client` | Pass |
| `npm run check:socket-registry --prefix client` | Pass |

---

## 6. Risk assessment

| Area | Risk | Mitigation |
|------|------|------------|
| Stale success replay | Low | TTL 5m; room cleanup clears cache; only success cached |
| Wrong-turn bypass | None | Idempotency runs after seat/turn prechecks; failures not cached |
| Memory growth | Low | Per-room cap 128 + TTL + room metadata cleanup |
| Duplicate broadcast | Fixed | Broadcast only inside first execution path |
| Grace timer regressions | Reduced | Dedicated fake-timer tests |

---

## 7. Remaining production gaps

| Gap | Priority | Notes |
|-----|----------|-------|
| In-match E2E reconnect | P2 | Hub chaos tests only (Task 7) |
| `hand:ready` idempotency | P2 | Separate from `game:action`; has `stale_or_duplicate_hand_ready` |
| Disconnect grace forfeit path (2nd expiry) | P2 | Not covered in unit tests (requires forfeit mock chain) |
| Multi-instance deploy | P0 ops | Out of scope — Task 8 addressed flush only |
| Actions without `requestId` | Info | Legacy path unchanged; clients should send `requestId` for retry safety |

---

## 8. Files changed

| File | Change |
|------|--------|
| `server/src/multiplayer/gameActionIdempotency.ts` | New idempotency module |
| `server/src/multiplayer/registerGameplayActionHandlers.ts` | Wire idempotency wrapper |
| `server/src/multiplayer/roomSession.ts` | Clear cache on `clearRoomMetadata` |
| `server/src/multiplayer/disconnectGrace.ts` | Test exports + room code normalization |
| `server/src/multiplayer/gameActionIdempotency.test.ts` | New |
| `server/src/multiplayer/disconnectGrace.test.ts` | New |
| `server/src/multiplayer/registerGameplayActionHandlers.test.ts` | Idempotency integration test |
| `docs/production/phase-aa-task-9-idempotency-disconnect-hardening.md` | This document |

**Task 9 status:** Complete.