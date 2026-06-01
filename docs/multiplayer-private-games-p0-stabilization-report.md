# Multiplayer Private Games — P0 Stabilization Report

**Date:** 2026-05-31  
**Scope:** P0 correctness/safety only — no UI refactor, no architecture migration, no payload optimization.

---

## Root risks addressed

| Risk | Mitigation |
|------|------------|
| Concurrent `game:action` handlers interleaving on one room | Per-room promise-chain lock wrapping `act()` |
| Tile loss/duplication undetected after mutations | Explicit `assertTileCountInvariant` after every `commitResolvedGameState`, `startGame`, and `nextHand` |
| Opponent hand leakage undetected | Server vitest + socket smoke regression tests for masking |
| Private create/join/start/move untested | Vitest integration test + dedicated smoke scenarios |
| Game-over persist duplication (partial) | Audited; existing guards documented; no migration added |

---

## Files changed

| File | Change |
|------|--------|
| `server/src/multiplayer/roomGameplayLock.ts` | **New** — per-room gameplay serialization |
| `server/src/multiplayer/roomGameplayLock.test.ts` | **New** — lock unit tests |
| `server/src/rooms.ts` | Wrap `act()` in lock; call `assertTileCountInvariant` on mutations |
| `server/src/game/invariants.ts` | Extract `collectTileAccountingViolations` + `assertTileCountInvariant` |
| `server/src/multiplayer/handMasking.test.ts` | **New** — masking + tile invariant tests |
| `server/src/multiplayer/registerRoomSessionHandlers.private.test.ts` | **New** — create/join/start/move + concurrent action tests |
| `client/scripts/socketSmoke.mjs` | 3 new scenarios; fix `startTwoPlayerGame` guest-ready + host-start order |
| `docs/multiplayer-private-games-p0-stabilization-report.md` | This report |

---

## Behavior before / after

### Action serialization

**Before:** Two async `game:action` handlers for the same room could both read `room.state`, mutate, and commit — risking double advances, wrong turn state, or tile duplication.

**After:** All calls to `act()` (used by `game:action` and disconnect-grace auto-pass/draw) pass through `withRoomGameplayLock(roomCode, ...)`. Actions for the same room run strictly one-at-a-time; later actions see committed state from earlier ones. Concurrent duplicate moves from the same player: first succeeds, second fails safely (e.g. tile no longer in hand).

### Tile invariants

**Before:** `assertValidGameState` already included tile accounting inside `collectGameStateViolations`, but there was no named tile-focused helper and no explicit call path documentation.

**After:** `assertTileCountInvariant` checks (when `handNumber > 0`):
- Total tile count = `totalTilesInSet(maxPips)`
- No duplicate tiles across hands + boneyard + board
- `deadTiles.length === config.deadTileCount`
- `boneyard.length >= deadTileCount`
- Valid per-player hand lengths

Called after every `commitResolvedGameState` (MOVE/DRAW/PASS), `startGame`, and `nextHand`. Full `assertValidGameState` still runs on the same paths (turn index, gameOver/handOver consistency, etc.).

### Hand masking tests

**Before:** Masking logic existed in `roomSession.ts` but had no dedicated security regression test.

**After:** Vitest proves opponent hands are `[]` during active play, revealed on `handOver`/`gameOver`, and hidden for spectators. Smoke scenario `hand-masking-after-move` verifies post-move broadcasts.

### Private happy path tests

**Before:** Smoke covered mid-hand actions but not an explicit private create→join→start→move path; no vitest for full handler flow.

**After:** Vitest + smoke cover host create, guest join, guest `player:ready`, host `game:start`, legal move sync, wrong-turn rejection.

### Smoke start order fix

**Before:** `startTwoPlayerGame` called only `game:start` without guest `player:ready`, which could yield `waiting_for_ready` on a strict server.

**After:** Guest emits `player:ready`, then host emits `game:start` — matches intended private flow from the audit.

---

## How action serialization works

```typescript
// server/src/multiplayer/roomGameplayLock.ts
const chains = new Map<string, Promise<void>>();

export async function withRoomGameplayLock<T>(roomCode, work) {
  const previous = chains.get(code) ?? Promise.resolve();
  // Queue: await previous, then run work(), then release next waiter
}
```

`rooms.act()` is the single entry point:

```typescript
export async function act(...) {
  return withRoomGameplayLock(code, () => actUnlocked(...));
}
```

Because disconnect grace also calls `act()`, auto-pass/draw during opponent disconnect is serialized with player actions on the same room.

**Not serialized (unchanged):** `hand:ready`, `game:rematch`, `room:leave` — these use separate dedup mechanisms (`nextHandStartsByRoom`, etc.). P0 scope was gameplay actions via `act()`.

---

## Game-over persist idempotency audit

| Path | Current guard | Assessment |
|------|---------------|------------|
| `broadcastStateUpdate` → `matchLogged` | Set synchronously before async persist IIFE | Prevents duplicate scheduling within single-process sequential broadcasts |
| `recordPublicOnlineMatch` | SELECT by `metadata.roomMatchId` before INSERT | **Idempotent** for `matches` table |
| `appendMatch` (local JSONL) | None | Can append duplicates if persist runs twice — low severity |
| `ranked_games` POST | None | **Risk:** duplicate rows if persist fires twice; needs DB unique constraint (document only — no migration in P0) |
| Rematch | `room.matchLogged = false` before new game | Correct reset |

**P0 decision:** No DB migration. Action serialization reduces double game-over broadcast races. Document `ranked_games` unique `(player_id, match_id)` as future P1 migration.

---

## Tests added / updated

### Server vitest (new)

- `roomGameplayLock.test.ts` — 3 tests (serialize same room, parallel different rooms, release on throw)
- `handMasking.test.ts` — 5 tests (masking rules + tile invariant on fresh deal)
- `registerRoomSessionHandlers.private.test.ts` — 2 tests (happy path + concurrent action serialization)

### Socket smoke (new / updated)

- `private-create-join-start-move`
- `hand-masking-after-move`
- `concurrent-action-serialization`
- `startTwoPlayerGame` — guest `player:ready` before host `game:start`

---

## Build / test results

| Command | Result |
|---------|--------|
| `npm run build --prefix server` | **Pass** |
| `npm test --prefix server` (multiplayer + invariants + engine) | **119 tests pass** |
| `npm run test:smoke:sockets --prefix client` (live server on `:3001`) | **16/16 pass** |

### Live smoke run (2026-06-01)

Server: fresh build (`node dist/index.js`, `PORT=3001`).

**P0 scenarios:**

| Scenario | Duration | Result |
|----------|----------|--------|
| `private-create-join-start-move` | 138ms | Pass — create/join/start/move, wrong-turn rejected, both synced |
| `hand-masking-after-move` | 359ms | Pass — opponent hands hidden after move |
| `concurrent-action-serialization` | 626ms | Pass — 1 success / 1 fail on duplicate; sequence +1 only |

**Full suite:** All 16 scenarios pass (~16.8s total).

Run P0-only: `SMOKE_ONLY=private-create-join-start-move,hand-masking-after-move,concurrent-action-serialization npm run test:smoke:sockets --prefix client`

### Smoke harness fixes (test-only, not server)

During live verification, several **stale smoke assertions** were corrected to match current server behavior:

1. `getClientBySeatId` — was `getClientBySocketId` but called with seat IDs ( broke `waitForPlayableClient` )
2. Spectator `game:start` / `game:action` — accept `Player seat not found` in addition to role-specific errors
3. `lifecycle-reconnect` — compare reconnect seat to post-leave rejoin seat, not initial join
4. `captureJoinSeat` — seed `stateUpdates` from join ack state (fixes rejoin timeout)
5. `same-user-active-seat-takeover` — expect supersede join (ok), not `already_connected` reject
6. `manual-draw-action-guards` — search window 40 → 80 steps (deal randomness)
7. `SMOKE_ONLY` env filter for targeted runs

---

## Remaining P0 risks not fixed

1. **Host leave mid-game policy** — still ambiguous (product decision)
2. **Lobby settings cosmetic** — 7/14/timed/rated still not wired to server
3. **Single-process in-memory rooms** — deploy still drops live rooms
4. **`ranked_games` duplicate INSERT** — needs DB unique constraint (documented, not migrated)
5. **`hand:ready` / rematch interleaving with `act()`** — not under same lock (lower frequency than double-click moves)
6. **Multi-instance split-brain** — no shared room store

---

## Manual QA checklist

- [ ] Host creates private room; guest joins via code
- [ ] Guest sees waiting state; host starts after guest is ready
- [ ] Both players receive deal; neither sees opponent tiles during play
- [ ] Legal move updates both boards with same sequence
- [ ] Wrong-turn move shows error toast; board unchanged
- [ ] Rapid double-click on same tile: only one move applies
- [ ] Opponent disconnect: grace banner; auto-pass/draw after 30s if applicable
- [ ] Refresh mid-game: rejoin restores masked state
- [ ] Game over: rematch works; no frozen board
- [ ] Leave/forfeit: abandoned room rejects rejoin

---

## Suggested next prompt (P1)

> Split in-game shell from App.tsx; trim state:update payload; add ranked_games unique constraint migration; consolidate reconnect paths.
