# Racehorse Dominoes — Multiplayer Hardening Map

**Audit date:** 2026-04-30  
**Codebase snapshot:** server/src/index.ts (4731 lines), server/src/rooms.ts (790 lines), server/src/game/engine.ts (639 lines), client/src/multiplayer/ (3 hooks, ~1400 lines total), client/scripts/socketSmoke.mjs (1891 lines)  
**Scope:** Online multiplayer only. Play vs Fritz, Daily Fritz, Learn mode excluded except where imported into multiplayer paths.

---

## A. Top 10 Highest-Risk Multiplayer Bugs

1. **P0 — `broadcastStateUpdate` emits `state:update` BEFORE `game:rematch:started`**: after rematch, the first new-hand state is dropped by both clients because `maxSequenceRef` has not yet been reset.
2. **P0 — `broadcastStateUpdate` is called from `room:join` reconnect path while match logging async IIFE may already be in flight for the same `gameOver`**: no idempotency guard on the `ranked_games` INSERT; duplicate rows can be silently written.
3. **P0 — `_matchLogged` flag lives as `(room as any)._matchLogged`, not on the `Room` type**: TypeScript cannot enforce it; it is invisible to every function that touches `Room`, and there is no recovery path when the async IIFE fails.
4. **P0 — Reconnect blocked indefinitely by TCP half-open socket**: `room:join` returns `already_connected` and makes no call to `oldSocket.disconnect(true)`; a player whose previous TCP connection is in a half-open state cannot rejoin for up to 30 seconds.
5. **P0 — No tile-count invariant check after any authoritative mutation**: a bug anywhere in draw/move/pass/forced-draw can silently duplicate or lose a tile; neither server nor smoke tests will detect it until visible gameplay symptoms appear.
6. **P1 — `broadcastStateUpdate` is called with `room.state.gameOver = true` on `room:join` reconnect path**: if the match-log async IIFE already ran (for the original game-over broadcast) and failed, `_matchLogged` is still `true` so no retry ever fires.
7. **P1 — Forced draw animation emitted BEFORE `state:update`; manual draw emitted AFTER**: the ordering is opposite for the two draw types. Clients consuming both must handle both orderings or risk animating against the wrong state.
8. **P1 — `clearTransientRoomUi` does not clear `handReveal`**: if a player disconnects and reconnects mid-hand-reveal, the stale `handReveal` modal persists into the new session.
9. **P1 — `hand:next` socket handler is registered but permanently broken**: it always responds `{ ok: false, error: 'Use hand:ready to advance hands.' }` and never advances anything. Any client still referencing this event silently fails.
10. **P1 — Failed match persistence (Supabase down) is swallowed silently**: the async IIFE inside `broadcastStateUpdate` catches all errors with `console.warn` and sets `_matchLogged = true` regardless; the match, ratings, and ghost-move logs are lost permanently with no retry and no user notification.

---

## B. Evidence for Each Bug

### Bug 1 — `state:update` arrives before `game:rematch:started` → first new-hand state dropped

**Files:** `server/src/index.ts` lines 4651–4656; `client/src/multiplayer/useMultiplayerConnection.ts` line 506; `client/src/multiplayer/useRoomSocketSync.ts` lines 108–116.

**Server emission order (index.ts line 4651):**
```typescript
await startGame(room.code, io, { allowRestart: true });
broadcastStateUpdate(room.code);                         // ← emits state:update (sequence ≈ 1)
io.to(room.code).emit('game:rematch:started', { roomCode: room.code }); // ← arrives second
```

**Client `maxSequenceRef` reset (useMultiplayerConnection.ts line 506):**
```typescript
// fires on 'game:rematch:started'
current.maxSequenceRef.current = -1;
```

**Client stale-state guard (useRoomSocketSync.ts line 108):**
```typescript
if (nextState && nextState.sequence < params.maxSequenceRef.current) {
  console.warn('[mp-state-apply] rejected stale state:update', {...});
  return;  // ← the new game's first state:update is dropped here
}
```

**Why it happens:** Socket.IO on a single TCP socket guarantees ordering within that socket. `state:update` is emitted first (inside `broadcastStateUpdate`), so both clients receive `state:update` (sequence ≈ 1) before `game:rematch:started`. At that moment `maxSequenceRef.current` is still the final sequence of the previous game (e.g., 47). Since 1 < 47, the guard rejects the update. The client then receives `game:rematch:started`, resets `maxSequenceRef` to −1, but no further `state:update` arrives. Both clients are stuck displaying the previous game's final state until they disconnect and rejoin.

---

### Bug 2 — Double `ranked_games` INSERT on reconnect-triggered `broadcastStateUpdate`

**Files:** `server/src/index.ts` lines 3320, 3382–3497.

**Guard check (line 3320):**
```typescript
if (room.state.gameOver && !isTournamentRoom && !(room as any)._matchLogged) {
```

**Guard set (line 3497):**
```typescript
(room as any)._matchLogged = true;  // ← set synchronously, AFTER launching the async IIFE
```

**Room:join also calls broadcastStateUpdate (line 4449):**
```typescript
if (room.state) {
  try {
    broadcastStateUpdate(room.code);  // ← called synchronously on reconnect
  } catch { /* non-fatal */ }
}
```

**Why it happens:** If player B reconnects to a room where `gameOver = true` after game-over processing occurred but before `_matchLogged` was set (window is one JavaScript tick — the IIFE is launched with `void`, so `_matchLogged = true` is set synchronously immediately after), this is actually safe in the normal path. However: if the initial `broadcastStateUpdate` call failed before reaching line 3497 (e.g., `getRoom(roomCode)` threw), `_matchLogged` was never set, and the reconnect-triggered call will double-fire the entire INSERT + Glicko path. Additionally, there is no `ON CONFLICT DO NOTHING` on the `ranked_games` INSERT:
```typescript
await supabaseFetch<any[]>('/rest/v1/ranked_games', {
  method: 'POST',
  headers: { Prefer: 'return=representation' },
  body: JSON.stringify({ player_id: p.me.userId, ... })
});  // ← no idempotency key, no upsert
```
Any double-call inserts a duplicate row, which then feeds the Glicko update with a phantom game result.

---

### Bug 3 — `_matchLogged` is untyped, not resilient to errors

**Files:** `server/src/rooms.ts` (Room type, lines 25–46); `server/src/index.ts` lines 3320, 3497, 4631.

**Room type (rooms.ts lines 25–46):**
```typescript
export type Room = {
  code: string;
  players: string[];
  state: GameState | null;
  // ... 12 more typed fields ...
  // _matchLogged: NOT HERE
};
```

**Usage (index.ts):**
```typescript
!(room as any)._matchLogged   // read
(room as any)._matchLogged = true;   // write
(room as any)._matchLogged = false;  // reset on rematch
```

Three separate `as any` casts mean TypeScript provides zero protection. If any future patch refactors `Room` or the reset logic, `_matchLogged` can silently fail to reset, permanently preventing match logging for that room's lifetime. The same applies to `_leadTracker`.

---

### Bug 4 — Reconnect blocked by hung TCP socket with no forced disconnect

**Files:** `server/src/index.ts` lines 4322–4328.

```typescript
const oldSocket = io.sockets.sockets.get(existingPlayer.id);
if (oldSocket && oldSocket.id !== socket.id && oldSocket.connected) {
  console.log(`[room:join] REJECTED: user ${userId} already connected via ${oldSocket.id}`);
  return cb?.({ ok: false, error: 'already_connected' });
  // ← oldSocket.disconnect(true) is NEVER called
}
```

**Why it happens:** Mobile clients and cellular networks frequently produce TCP half-open connections where `socket.connected` reads `true` on the server but the client has already lost the connection. The socket only transitions to disconnected after Socket.IO's ping timeout (~25–30s by default). During that entire window the user cannot rejoin their active game, sees the `already_connected` error, and their opponent's game is frozen waiting for them. On mobile this is the most common reconnect scenario.

---

### Bug 5 — No tile-count invariant check

**Files:** `server/src/game/engine.ts` (no `assertTileCountInvariant` function exists); `server/src/rooms.ts` `act()` function.

After every call to `applyMove`, `drawOne`, `resolveManualDrawAtomically`, or `resolveForcedDrawAtomically`, the server sets `room.state` to the new state and broadcasts it. There is no assertion of the form:

```typescript
// This function does NOT exist anywhere in the codebase:
function assertTileCountInvariant(state: GameState): void {
  const total = totalTilesInSet(state.config.maxPips);
  const handTiles = state.playerIds.flatMap(id => state.players[id].hand).length;
  const boardTiles = countBoardTiles(state.board);
  const boneyardTiles = state.boneyard.length;
  // deadTiles are a subset of boneyard, not additive
  const actual = handTiles + boardTiles + boneyardTiles;
  if (actual !== total) throw new Error(`Tile invariant violated: ${actual} !== ${total}`);
}
```

Any bug in tile removal, the forced-draw loop, or the pass/blockade resolution that duplicates or loses a tile will silently corrupt the game. The smoke tests verify board tile counts before and after individual moves but do not verify the global sum across all locations.

---

### Bug 6 — Failed persistence silently sets `_matchLogged = true`

**Files:** `server/src/index.ts` lines 3319–3499.

```typescript
void (async () => {
  try {
    await appendMatch({ ... });
    for (const p of rankingParticipants) {
      if (p.me.userId) {
        await supabaseFetch('/rest/v1/ranked_games', { method: 'POST', ... });
        await completeGhostGame({ ... });
      }
    }
    await processRealtimeMultiplayerGame({ ... });
    // ... league fixture updates ...
  } catch (err) {
    console.warn('Ranking/Match logging failed', err);   // ← silently swallowed
  }
})();
(room as any)._matchLogged = true;   // ← set regardless of IIFE outcome
```

`_matchLogged = true` is set in the synchronous scope, not inside the async IIFE. If Supabase is down, the IIFE throws, the catch logs a warning, and `_matchLogged` remains `true`. No retry is scheduled. The match, both players' ratings, the ghost-move logs, and any league fixture result are permanently lost.

---

### Bug 7 — Asymmetric draw animation / state ordering

**Files:** `server/src/index.ts` lines 4524–4535.

```typescript
// game:action handler:
const result = await act(roomCode, socket.id, action, io, (code) => broadcastStateUpdate(code));
const room = result.room;
if (result.forcedDrawAnimation) {
  emitForcedDrawAnimationPayload(room.code, result.forcedDrawAnimation);  // animation FIRST
}
broadcastStateUpdate(room.code);                                           // state:update SECOND
if (result.manualDrawAnimation) {
  emitManualDrawAnimationPayload(room.code, result.manualDrawAnimation);   // animation SECOND (reversed)
}
```

**Forced draw path:** client receives `game:draw_animation` then `state:update`. The animation runs against the pre-draw state; the board is visually consistent during animation but `boneyardDisplayCount` is not yet updated from the server-authoritative state.

**Manual draw path:** client receives `state:update` then `game:draw_animation`. React renders the final state (tiles already in hand, boneyard count already updated) before the flying-tile animation begins. The animation is purely cosmetic after the fact, which is the intended behavior — but the two paths are inverted without documentation, making the code fragile for any future change to either emit order.

---

### Bug 8 — `clearTransientRoomUi` does not clear `handReveal`

**Files:** `client/src/App.tsx` lines 1250–1267.

```typescript
const clearTransientRoomUi = useCallback(() => {
  setSelectedTile(null);
  setPendingUiAction(null);
  setActionError('');
  setOptimisticPlayedTile(null);
  setOpponentDragging(false);
  draggingStateRef.current = false;
  pendingActionRef.current = false;
  // draw state cleared...
  setFlyingTiles([]);
  // handReveal NOT cleared ← BUG
  // rematchRequested NOT cleared ← (but cleared in resetMultiplayerRoomState)
  // rematchReadyIds NOT cleared ← (but cleared in resetMultiplayerRoomState)
}, [setDrawSequenceActiveBoth]);
```

`clearTransientRoomUi` is called on reconnect (useMultiplayerConnection.ts line 372) and on seat join (line 505). `resetMultiplayerRoomState` (which does clear `handReveal`) is only called on intentional leave or room teardown. A player who disconnects mid-hand-reveal and reconnects (triggering `clearTransientRoomUi`, not `resetMultiplayerRoomState`) will see the stale hand-reveal modal from the previous disconnected session floating over the live game.

---

### Bug 9 — `hand:next` is a permanently broken dead handler

**Files:** `server/src/index.ts` lines 4548–4566.

```typescript
socket.on('hand:next', async (code, cb) => {
  const roomCode = String(code).trim().toUpperCase();
  console.log(`[hand:next] socket=${socket.id}, code=${roomCode}`);
  try {
    const room = getRoom(roomCode);
    if (!room.players.includes(socket.id)) {
      if (typeof cb === 'function') cb({ ok: false, error: 'Only room players can advance hands.' });
      return;
    }
    if (typeof cb === 'function') {
      cb({ ok: false, error: 'Use hand:ready to advance hands.' });  // ← always fails
    }
  } catch (err: unknown) {
    ...
  }
});
```

This handler is registered on every socket connection, consumes memory, logs every call, and always returns an error. It is dead code that should be removed. Any client still sending `hand:next` (old client version, cached bundle) silently cannot advance hands.

---

### Bug 10 — Failed persistence has no retry and no user notification

This is the same root cause as Bug 6, but the consequence is broader: `ghostMoveLogs`, league fixture finalization, and `appendMatch` all live inside the same single try/catch. A Supabase timeout midway through can partially succeed (e.g., match row inserted but Glicko not updated), leaving ratings in a corrupted state. Neither player is informed. There is no dead-letter queue, no idempotency-key retry, and no admin alert.

---

## C. P0 Issues — Corrupt State / Wrong Winner / Frozen Game / Security

### C1 — Frozen game after rematch (Bug 1)
**Severity:** P0 — game is unplayable  
**Root cause:** `broadcastStateUpdate` emitted before `game:rematch:started`; client drops the new game's first state update.  
**Observable symptom:** After both players click Rematch, the board resets visually but no tiles appear and it is nobody's turn. Refreshing the page recovers the state (the player rejoins via `room:join` which re-sends the state in the ACK).

### C2 — Wrong Glicko ratings / phantom ranked game (Bug 2)
**Severity:** P0 — corrupted persistent data  
**Root cause:** No idempotency on `ranked_games` INSERT; reconnect-triggered `broadcastStateUpdate` on a `gameOver` room can double-fire the full logging pipeline.  
**Observable symptom:** A player's rating jumps by the amount of one extra match result, or drops unexpectedly. Detectable only by inspecting the `ranked_games` table directly.

### C3 — Indefinite reconnect lockout (Bug 4)
**Severity:** P0 — game frozen, player locked out  
**Root cause:** `already_connected` without `oldSocket.disconnect(true)`.  
**Observable symptom:** Player on a mobile network loses signal, switches to WiFi, attempts to rejoin within 30 seconds. Sees "already connected" error. Opponent's game is paused waiting for them. After ~30 seconds, Socket.IO ping timeout fires, old socket disconnects, reconnect succeeds. This is the most common multiplayer complaint on mobile.

### C4 — Silent tile-count corruption (Bug 5)
**Severity:** P0 — corrupt game state, wrong winner possible  
**Root cause:** No post-mutation invariant check on total tile count.  
**Observable symptom:** A player goes out with tiles remaining, or the boneyard displays a negative count, or the game ends with the wrong winner because a player's hand had phantom extra tiles.

---

## D. P1 Issues — Stale UI / Rematch Glitch / Rating Mismatch / Lag

### D1 — Failed persistence silently loses match (Bug 6 / Bug 10)
Rating mismatch between what players see and what is stored. No retry. Match log missing from history.

### D2 — Stale hand-reveal modal after reconnect (Bug 8)
Player reconnects, sees a hand-reveal overlay from the previous hand. UI is blocked until they dismiss it or the auto-timeout fires (several seconds).

### D3 — Asymmetric draw animation ordering (Bug 7)
Forced draw renders tiles flying into the hand before the hand is shown as updated (correct but fragile). Manual draw renders tiles flying after the hand is already updated (the animation is decorative but may confuse users who see the tile count change before the animation). Any future change to either path that adjusts the ordering will break one case.

### D4 — `hand:next` dead handler wastes resources (Bug 9)
Every connected socket registers a `hand:next` listener that always fails. This is benign in isolation but adds noise to logs and handler count.

### D5 — `_matchLogged` untyped, invisible to TypeScript (Bug 3)
Maintenance hazard. Future patches that modify `Room` will not see this field and can accidentally break the match-logging guard.

### D6 — `boneyardRef.current` unchecked before `getBoundingClientRect()`
**File:** `client/src/multiplayer/useRoomSocketSync.ts` draw animation handler, step timer callback  
**Risk:** If the boneyard element unmounts between when the draw-animation event is received and when the first step timer fires (e.g., a fast navigation away from the game), `boneyardRef.current.getBoundingClientRect()` throws a null-dereference. The error is uncaught in the timer callback and silently kills the animation goroutine; flying tiles never appear, but gameplay is unaffected.

### D7 — Ghost-move log accumulates across hands with no size cap
**File:** `server/src/rooms.ts` `appendGhostMove()`, rooms.ts lines ~134–137  
Room memory grows proportionally to the number of moves played. A very long game (e.g., many hands near the score cap, frequent draws) can accumulate hundreds of entries. There is no `MAX_GHOST_MOVES` cap and no eviction. For a long-running server this is a memory leak per room.

### D8 — `nextHandStartsByRoom` not cleared on rematch
**File:** `server/src/rooms.ts` lines 506–546; `server/src/index.ts` rematch handler  
If a rematch is requested while `nextHandStartsByRoom` still has a pending promise for the previous game (race: both players mark hand:ready then immediately request rematch before the sleep delay expires), the lingering async promise resolves after the rematch has already started a new game, and calls `nextHand(code, io)` again on the already-new game state. The guard `if (!fresh.state || fresh.state.gameOver || !fresh.state.handOver ...)` should catch this (the rematch-started state has `handOver = false`), but the guard relies on the new state being fully settled before the old promise fires — which depends on the exact timing of the 2500ms `MIN_HAND_OVER_MS` sleep.

---

## E. Dead Code / Stale Compatibility Code

| Location | What it is | Safe to remove |
|---|---|---|
| `server/src/index.ts` line 4548 | `socket.on('hand:next', ...)` handler — always returns error | Yes. Remove the entire handler registration. |
| `server/src/index.ts` line 1114 | Comment: "Non-UUID ids are kept for local smoke tests and legacy guest-style flows" — the code supporting this is still active | No, keep for now; smoke tests depend on non-UUID identities |
| `server/src/index.ts` line 2059 | Comment: "Keep storage-compatible legacy `game_type`" — `fritz` vs `multiplayer` distinction in `ranked_games.game_type` | Review whether both values are still used in queries |
| `server/src/rooms.ts` `joinRoom()` export | Function body is a thin wrapper around `getRoom` + array push; its reconnect/migration logic was superseded by the `room:join` handler's inline migration code | Consolidate into one place |
| `client/src/multiplayer/useMultiplayerConnection.ts` line 557–558 | `gameOver: p.stateRef.current?.gameOver ?? null, handOver: p.stateRef.current?.handOver ?? null` computed inside a callback but the return value appears unused | Verify usage |
| `(room as any)._matchLogged`, `(room as any)._leadTracker` | Untyped shadow fields — should be on the `Room` type | Migrate to typed fields |

---

## F. Duplicated Logic That Should Be Unified

### F1 — Hand masking in three separate places
The logic to mask opponent hands appears independently in:
1. `room:join` ACK construction (index.ts line 4407–4425)
2. `broadcastStateUpdate` per-player loop (index.ts line 3530–3557)
3. `room:spectate` handler (index.ts line 4206–4260)

Each copy independently implements: "show full hand if handOver, gameOver, or pid === recipient; otherwise hand = []". A bug fix in one copy does not propagate to the others. Extract to a single function:

```typescript
function maskStateForRecipient(state: GameState, recipientPlayerId: string | null): GameState {
  const canRevealAll = state.handOver || state.gameOver;
  return {
    ...state,
    players: Object.fromEntries(
      state.playerIds.map((pid) => {
        const ps = state.players[pid];
        const reveal = canRevealAll || pid === recipientPlayerId;
        return [pid, { ...ps, hand: reveal ? ps.hand : [] }];
      }),
    ),
    handCounts: Object.fromEntries(
      state.playerIds.map((pid) => [pid, state.players[pid]?.hand.length ?? 0]),
    ),
  };
}
```

### F2 — `broadcastStateUpdate` called in both `game:action` handler and `onStateReady` callback
`act()` accepts an `onStateReady` callback that is called inside `resolveForcedDrawAtomically`/`resolveManualDrawAtomically` for the intermediate state, AND the `game:action` handler calls `broadcastStateUpdate` directly after `act()` returns. This means `broadcastStateUpdate` is called twice for every forced-draw MOVE: once via `onStateReady` inside `act()` and once by the handler. Review whether the intermediate broadcast is intentional.

**File:** `server/src/rooms.ts` line 563; `server/src/index.ts` line 4525.

Actually, looking more carefully: the `onStateReady` callback passed to `act()` is only stored/invoked via the `readyForNextHand` path, not inside `act()` itself. The `act()` function takes `onStateReady` but does not call it. Only `readyForNextHand` uses it. This is confusing API design — `act()` accepts a callback it never uses.

### F3 — Reconnect seat migration duplicated across two code paths
Seat migration occurs in two independent code paths inside `room:join`:
1. Lines 4329–4342: Migration via `userId` match in active roster (`migrateRoomSeat + roomPlayersByCode.set`)
2. Lines 4347–4371: Migration via `pruneReconnectSeats` (stale-socket fallback)

Both paths call `migrateRoomSeat` and update the roster, but with slightly different logic for what gets updated. Any bug fix or audit of the seat-migration security (preventing cross-user seat theft) must be applied to both paths.

### F4 — Sequence number reuse across rematch
`GameState.sequence` continues incrementing across hands within a match (correct). On rematch, `startNewHand` sets `sequence: state.sequence + 1` — it does NOT reset to 0. This is fine for the server. But the client `maxSequenceRef` is reset to −1 on `game:rematch:started`. This means after rematch, the new sequence (e.g., 48) is greater than −1, so stale-state rejection works. But if the new game somehow re-uses a sequence number that the old game used (not currently possible, but would be after a server restart with in-memory state), the guard would fail. Document this assumption explicitly.

---

## G. Missing Server Invariant Checks

After every authoritative state mutation (`applyMove`, `drawOne`, `resolveManualDrawAtomically`, `resolveForcedDrawAtomically`, `startNewHand`), the server should assert:

| Invariant | Currently checked? | Where to add |
|---|---|---|
| Total tile count = sum(hands) + board tiles + boneyard.length | **NO** | `act()` in rooms.ts, after each mutation |
| No tile appears in more than one location | **NO** | `act()` after each mutation |
| `currentPlayerIndex` is in bounds [0, playerIds.length) | **NO** | `broadcastStateUpdate` |
| `consecutivePasses` <= playerIds.length | **NO** | `applyMove` in engine.ts |
| `handOver = true` implies winner or all-pass condition | **NO** | `startNewHand` entry guard |
| `gameOver = true` implies `winnerId !== null` | **NO** | `broadcastStateUpdate` |
| `winnerId` is a member of `playerIds` | **NO** | `broadcastStateUpdate` |
| No action accepted when `gameOver = true` | **Partial** — `getLegalMoves` returns [] on gameOver, but `act()` does not explicitly check `state.gameOver` before processing | Add explicit guard at top of `act()` |
| No action from non-current-player socket | **YES** — via `assertCurrentPlayer` in engine.ts | OK |
| No action from socket not in `room.players` | **YES** — checked in `game:action` handler line 4518 | OK |
| `sequence` strictly increases per mutation | **YES** — incremented in engine functions | OK, but not asserted |
| Scores never decrease except on new match reset | **NO** | `broadcastStateUpdate` or after `startNewHand` |

---

## H. Missing Smoke Tests

The current suite (13 scenarios) covers: reconnect, room-switch, seat migration, mid-hand action reliability, draw guards, forced-draw atomicity, post-move stability, start guards, guest reconnect, tokenless UUID rejection, hand-ended replay, identity freeze, same-user active seat takeover.

**Missing scenarios:**

| Scenario | Risk if missing |
|---|---|
| **Full game to completion** (gameOver = true reached, `state:update` with `gameOver` received by both clients) | Does not validate that game-over state is consistent, that `winnerId` is correct, or that both clients agree |
| **Rematch sequence continuity** (play through gameOver, both rematch, verify new game starts cleanly with new hand) | Does not cover Bug 1 (the primary rematch freeze bug) |
| **Reconnect at gameOver** (disconnect at `gameOver = true`, reconnect, verify state is recovered) | Does not test that `hand:ended` replay still works at gameOver boundary |
| **Disconnect during rematch wait** (one player requests rematch, other disconnects before confirming) | Does not test that `rematchReady` set is cleaned up, preventing a zombie rematch |
| **Rapid simultaneous `hand:ready`** (both clients emit `hand:ready` in same tick, verify single `nextHand` called) | `nextHandStartsByRoom` coalescing is tested indirectly but not explicitly |
| **Hand masking verification** (after MOVE, assert opponent's hand is [] in the receiving client's state:update) | Security critical — confirmed absent from all 13 scenarios |
| **Invalid action during `handOver`** (emit MOVE after hand ends, before hand:ready) | Covered partially by `start-and-hand-ready-guards` but not for mid-hand-over MOVE |
| **Invalid action during `gameOver`** (emit MOVE after game ends) | Not covered |
| **Stress loop** (100 rapid MOVE/DRAW/PASS cycles, assert tile counts invariant after each) | Not covered — would have caught tile-count bugs |
| **`broadcastStateUpdate` called on `gameOver` twice** (verify `_matchLogged` prevents double INSERT) | Not covered |
| **Stale socket action after seat migration** (old socket emits game:action after reconnect migrated its seat to new socket) | Covered by `seat-migration-and-spectator-rejection` but only for spectate rejection, not game:action |
| **Manual draw exhausts boneyard** (draw until boneyard locked, verify auto-pass triggers) | Not explicitly covered |

---

## I. Phased Hardening Roadmap

### Phase 1 — Zero-Risk Cleanup (no behavior change, no test required beyond existing suite)

1. Remove dead `hand:next` handler (index.ts line 4548–4566)
2. Add `_matchLogged: boolean` and `_leadTracker: LeadTracker | null` to the `Room` type in rooms.ts, remove all `as any` casts
3. Extract `maskStateForRecipient()` utility; replace the three hand-masking code copies
4. Add `null` check for `boneyardRef.current` before `getBoundingClientRect()` in useRoomSocketSync draw animation handler
5. Add JSDoc to `act()` clarifying that `onStateReady` is passed through to `readyForNextHand` only — the function itself does not call it
6. Add `MAX_GHOST_MOVES_PER_PLAYER = 500` cap in `appendGhostMove()` with a warn log on overflow

### Phase 2 — Invariant Checks (requires new unit tests in engine.test.ts)

7. Add `assertTileCountInvariant(state: GameState): void` in engine.ts and call it at the end of `applyMove`, `drawOne`, `resolveManualDrawAtomically`, `resolveForcedDrawAtomically`
8. Add explicit `state.gameOver` guard at the top of `act()` in rooms.ts:
   ```typescript
   if (state.gameOver) throw new Error('Game is over. No actions accepted.');
   ```
9. Add `winnerId` / `playerIds` membership assertion in `broadcastStateUpdate` before broadcasting
10. Add `consecutivePasses <= playerIds.length` assertion in `applyMove` pass branch

### Phase 3 — Reconnect / Rematch Hardening (requires new smoke tests)

11. **Fix Bug 1 (rematch ordering):** Swap emission order in rematch handler:
    ```typescript
    io.to(room.code).emit('game:rematch:started', { roomCode: room.code }); // FIRST
    broadcastStateUpdate(room.code);                                          // SECOND
    ```
12. **Fix Bug 4 (hung socket):** Add forced disconnect in `room:join`:
    ```typescript
    if (oldSocket && oldSocket.id !== socket.id && oldSocket.connected) {
      oldSocket.disconnect(true);
      await new Promise(resolve => setTimeout(resolve, 50)); // brief settle
    }
    // then proceed with migration
    ```
13. **Fix Bug 8 (stale handReveal):** Add `setHandReveal(null)` inside `clearTransientRoomUi`
14. Add smoke test: `scenarioRematchSequenceContinuity` — play to game-over, both rematch, assert new sequence starts, both clients receive new hand state
15. Add smoke test: `scenarioDisconnectDuringRematchWait` — one player requests rematch, other disconnects, assert `rematchReady` is cleaned on disconnect

### Phase 4 — Action Idempotency / Duplicate-Action Protection

16. **Fix Bug 2 / Bug 6 (double INSERT + silent loss):** Add idempotency key to `ranked_games`:
    - Add column `match_id` (unique) to `ranked_games` table
    - Include `room.matchId` in INSERT body
    - Use PostgREST `Prefer: resolution=ignore-duplicates` header
    - Move `_matchLogged = true` INSIDE the async IIFE's `try` block after all writes succeed
    - Add retry with exponential backoff (max 3 attempts) before marking as failed
    - On permanent failure, emit a server-side alert (log to a `failed_match_logs` table or an error monitoring service)
17. Add per-room action sequence tracking: include optional `clientSeq: number` in action payload; server echoes it back in ACK; client uses this to detect duplicate ACKs without re-applying state
18. Add smoke test: `scenarioMatchLoggingIdempotency` — trigger two `broadcastStateUpdate` calls on a gameOver room, assert only one `ranked_games` row exists

### Phase 5 — Performance / Lag Cleanup

19. **Fix `broadcastStateUpdate` blocking in real-time path:** The entire Supabase async pipeline (`appendMatch`, `supabaseFetch x4`, `processRealtimeMultiplayerGame`, league fixture updates) runs in a fire-and-forget IIFE. This is structurally correct (it does not block the action response). No change needed here — it is already non-blocking. However, add a timeout on each individual `supabaseFetch` call (currently there is none) to prevent indefinite hanging:
    ```typescript
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const result = await supabaseFetch(url, { ..., signal: controller.signal });
    clearTimeout(timeout);
    ```
20. **Reduce redundant `broadcastStateUpdate` calls in `room:join`:** The `room:join` handler calls `broadcastStateUpdate` (line 4449) AND sends the full state in the ACK (line 4433). The reconnecting socket receives the state twice. Remove the `broadcastStateUpdate` call in `room:join` for the reconnecting player; keep it only to update the non-reconnecting player's roster view.
21. **Fix React render amplification in draw animation:** `setFlyingTiles(prev => [...prev, newTile])` inside each step timer creates a new array per step. For a 10-tile draw, this is 10 separate React re-renders of the entire game board. Batch with a ref and flush once:
    ```typescript
    const pendingTilesRef = useRef<FlyingTile[]>([]);
    // inside timer: pendingTilesRef.current.push(tile)
    // after all steps scheduled: setFlyingTiles(prev => [...prev, ...pendingTilesRef.current])
    ```
22. Add smoke test: `scenarioStressLoop` — 100 action cycles, assert tile count invariant after each, assert no sequence regression, assert both clients converge on identical final sequence

---

## J. Fix Specifications

### Fix J1 — Swap rematch broadcast order (Bug 1)
**File:** `server/src/index.ts`  
**Function:** `game:rematch` handler, lines 4651–4656  
**Exact change:**
```typescript
// BEFORE:
await startGame(room.code, io, { allowRestart: true });
broadcastStateUpdate(room.code);
io.to(room.code).emit('game:rematch:started', { roomCode: room.code });

// AFTER:
await startGame(room.code, io, { allowRestart: true });
io.to(room.code).emit('game:rematch:started', { roomCode: room.code });
broadcastStateUpdate(room.code);  // state:update arrives AFTER client reset maxSequenceRef
```
**Risk level:** Low — only the relative ordering of two synchronous emit calls changes. Functionally the client already handles receiving `game:rematch:started` before `state:update` (the `maxSequenceRef` reset is ready and waiting).  
**Validation:** `node client/scripts/socketSmoke.mjs` must pass all 13 existing scenarios.  
**Smoke test to prove:** Add `scenarioRematchSequenceContinuity`: play to gameOver, both clients send `game:rematch`, assert `game:rematch:started` arrives before `state:update` (by recording event order in listeners), assert both clients' `maxSequenceRef` would accept the new state:update.

---

### Fix J2 — Force disconnect hung socket on reconnect (Bug 4)
**File:** `server/src/index.ts`  
**Function:** `room:join` handler, lines 4322–4328  
**Exact change:**
```typescript
// BEFORE:
if (oldSocket && oldSocket.id !== socket.id && oldSocket.connected) {
  console.log(`[room:join] REJECTED: user ${userId} already connected via ${oldSocket.id}`);
  return cb?.({ ok: false, error: 'already_connected' });
}

// AFTER:
if (oldSocket && oldSocket.id !== socket.id && oldSocket.connected) {
  console.log(`[room:join] FORCE-DISCONNECT: old socket ${oldSocket.id} for userId=${userId}, new socket ${socket.id} taking over`);
  oldSocket.emit('room:session:superseded', { reason: 'new_session', newSocketId: socket.id });
  oldSocket.disconnect(true);
  // fall through — proceed with migration using the new socket
}
```
**Risk level:** Medium — forcibly disconnecting the old socket will trigger its `disconnect` handler and may emit a `room:update` with the old socket momentarily removed. The new socket's `room:join` proceeds immediately after and re-adds it. Test that the brief roster gap does not confuse the opponent's client.  
**Validation:** Run `scenarioSameUserActiveSeatTakeover` — it currently asserts that alpha2 is rejected while alpha is connected. After this fix, the test must be updated: alpha2 should succeed in joining (alpha is force-disconnected), and alpha should receive `room:session:superseded`.  
**Smoke test:** Update `scenarioSameUserActiveSeatTakeover` to assert successful takeover on first attempt, not rejection.

---

### Fix J3 — Add tile-count invariant (Bug 5)
**File:** `server/src/game/engine.ts`  
**Function:** New `assertTileCountInvariant`, called at end of `applyMove`, `drawOne`, `resolveManualDrawAtomically`, `resolveForcedDrawAtomically`  
**Exact change:**
```typescript
// Add to engine.ts after imports:
function countBoardTiles(board: BoardState | null): number {
  if (!board) return 0;
  return board.chains.reduce((sum, chain) => sum + chain.tiles.length, 0);
}

export function assertTileCountInvariant(state: GameState): void {
  const expected = totalTilesInSet(state.config.maxPips);
  const handTiles = state.playerIds.reduce((sum, id) => sum + (state.players[id]?.hand.length ?? 0), 0);
  const boardTiles = countBoardTiles(state.board);
  const boneyardTiles = state.boneyard.length;
  const actual = handTiles + boardTiles + boneyardTiles;
  if (actual !== expected) {
    throw new Error(
      `TILE INVARIANT VIOLATED: expected ${expected}, got ${actual} ` +
      `(hand=${handTiles}, board=${boardTiles}, boneyard=${boneyardTiles})`
    );
  }
}
```
Add call at the end of `applyMove` return path and inside `resolveManualDrawAtomically` after the while loop.  
**Risk level:** Low for the assertion itself — it throws only on a real bug. Medium for performance: `countBoardTiles` traverses the board structure on every action. Benchmark; gate behind `process.env.NODE_ENV !== 'production'` if needed.  
**Validation:** Add unit test in `server/src/game/__tests__/engine.test.ts`: simulate a tile removal bug, assert `assertTileCountInvariant` throws.  
**Smoke test:** Add `scenarioStressLoop` — 100 actions, assert no invariant exception thrown.

---

### Fix J4 — Add `_matchLogged` to Room type (Bug 3)
**File:** `server/src/rooms.ts`  
**Function:** `Room` type definition, lines 25–46  
**Exact change:**
```typescript
// Add to Room type:
export type Room = {
  // ... existing fields ...
  matchLogged: boolean;         // was: (room as any)._matchLogged
  leadTracker: LeadTracker | null;  // was: (room as any)._leadTracker
};

// Add type:
export type LeadTracker = {
  aId: string;
  bId: string;
  maxLeadA: number;
  maxLeadB: number;
};

// Update createRoom():
const room: Room = {
  // ...
  matchLogged: false,
  leadTracker: null,
};
```
Update all references in index.ts from `(room as any)._matchLogged` to `room.matchLogged` and from `(room as any)._leadTracker` to `room.leadTracker`. TypeScript will catch any missed sites.  
**Risk level:** Low — pure type-system change, no behavior change.  
**Validation:** `tsc --noEmit` must pass with zero errors.  
**Smoke test:** Existing suite; no new test needed.

---

### Fix J5 — Add `handReveal` clear to `clearTransientRoomUi` (Bug 8)
**File:** `client/src/App.tsx`  
**Function:** `clearTransientRoomUi`, line 1250  
**Exact change:**
```typescript
const clearTransientRoomUi = useCallback(() => {
  setSelectedTile(null);
  setPendingUiAction(null);
  setActionError('');
  setOptimisticPlayedTile(null);
  setOpponentDragging(false);
  draggingStateRef.current = false;
  pendingActionRef.current = false;
  setHandReveal(null);              // ← ADD THIS
  if (drawSequenceTimeoutRef.current) {
    clearTimeout(drawSequenceTimeoutRef.current);
    drawSequenceTimeoutRef.current = null;
  }
  setDrawSequenceActiveBoth(false);
  setDrawStepMyHand(null);
  setDrawStepActorId(null);
  setDrawStepOpponentHandCount(null);
  setFlyingTiles([]);
}, [setDrawSequenceActiveBoth]);
```
**Risk level:** Low. `setHandReveal(null)` is idempotent and is already called in `resetMultiplayerRoomState`. Calling it additionally in `clearTransientRoomUi` only affects the reconnect path, where the stale modal should not appear.  
**Validation:** Manual test: join a game, play until hand ends, disconnect during hand-reveal, reconnect. Verify hand-reveal modal does not appear in the new session.  
**Smoke test:** Add assertion to `scenarioLifecycleReconnect` that after reconnect, `handReveal` state is null.

---

### Fix J6 — Remove dead `hand:next` handler (Bug 9)
**File:** `server/src/index.ts`  
**Lines:** 4548–4566  
**Exact change:** Delete the entire block:
```typescript
socket.on('hand:next', async (code, cb) => {
  // ... 18 lines ...
});
```
**Risk level:** Zero. The handler only ever returns an error. Any client using `hand:next` is already broken.  
**Validation:** `grep -r "hand:next" client/src/` — confirm no client code emits this event. `node client/scripts/socketSmoke.mjs` must still pass.  
**Smoke test:** Existing suite; no new test needed.

---

### Fix J7 — Add idempotency to `ranked_games` INSERT (Bug 2)
**File:** `server/src/index.ts` lines 3381–3400 (the ranked_games INSERT body)  
**Exact change:**
```typescript
// BEFORE:
body: JSON.stringify({
  player_id: p.me.userId,
  opponent_id: opponentId,
  player_score: p.myScore,
  opponent_score: p.oppScore,
  game_type: ...,
  rating_before: profile.glicko_rating,
  rd_before: profile.glicko_rd,
  played_at: new Date().toISOString()
})

// AFTER:
body: JSON.stringify({
  match_id: `${room.matchId}:${p.me.userId}`,   // ← unique per player per match
  player_id: p.me.userId,
  opponent_id: opponentId,
  player_score: p.myScore,
  opponent_score: p.oppScore,
  game_type: ...,
  rating_before: profile.glicko_rating,
  rd_before: profile.glicko_rd,
  played_at: new Date().toISOString()
}),
// Also add to headers:
headers: {
  Prefer: 'return=representation,resolution=ignore-duplicates',
  ...
}
```
Requires a Supabase migration to add `UNIQUE(match_id)` constraint to `ranked_games`.  
**Risk level:** Medium — requires a database schema change and migration. Test on a branch before deploying.  
**Validation:** Write a test that calls the INSERT path twice with the same `match_id`. Assert only one row exists in `ranked_games`.  
**Smoke test:** Add `scenarioMatchLoggingIdempotency` — manually trigger `broadcastStateUpdate` twice on a gameOver room, query DB, assert single row.

---

### Fix J8 — Move `matchLogged = true` inside async IIFE success path (Bug 6)
**File:** `server/src/index.ts`  
**Current (line 3496–3498):**
```typescript
      })();
      (room as any)._matchLogged = true;   // ← outside async, always runs
    }
```
**After:**
```typescript
        // Inside async IIFE, after all awaits succeed:
        room.matchLogged = true;             // ← only set on success
      } catch (err) {
        console.error('[match-log] FAILED — will retry on next broadcastStateUpdate', err);
        // Do NOT set matchLogged = true; allow retry on next call
      }
    })();
    // Remove the synchronous matchLogged = true that was here
```
**Risk level:** Medium — removing the synchronous guard means a second `broadcastStateUpdate` call during the async window will attempt to launch a second IIFE. Combined with Fix J7 (idempotency key), this is safe. Without J7, this could cause a double INSERT. Implement J7 first.  
**Validation:** Run full smoke suite. Simulate Supabase failure (mock the fetch to reject). Assert that after the failure, a subsequent `broadcastStateUpdate` re-attempts logging.  
**Smoke test:** Add negative-path test for persistence failure recovery.

---

### Fix J9 — Add `null` guard for `boneyardRef` in draw animation
**File:** `client/src/multiplayer/useRoomSocketSync.ts`  
**Function:** `onDrawAnimation` step timer callback  
**Exact change:**
```typescript
// BEFORE:
const from = params.boneyardRef.current.getBoundingClientRect();

// AFTER:
if (!params.boneyardRef.current) {
  clearPendingDrawAnimationTimers();
  return;
}
const from = params.boneyardRef.current.getBoundingClientRect();
```
**Risk level:** Zero.  
**Validation:** `tsc --noEmit`. Manual: navigate away from game mid-draw, assert no console errors.  
**Smoke test:** Existing suite; this is a client-only defensive change.

---

### Fix J10 — Add explicit `gameOver` guard at top of `act()`
**File:** `server/src/rooms.ts`  
**Function:** `act()`, after `if (!room.state) throw new Error(...)` (line ~566)  
**Exact change:**
```typescript
let state = room.state;

// ADD:
if (state.handOver && !state.gameOver && type !== 'DRAW' && type !== 'PASS') {
  throw new Error('Hand is over. Waiting for next hand to start.');
}
if (state.gameOver) {
  throw new Error('Game is over. Only rematch or leave is accepted.');
}
```
**Risk level:** Low — these conditions should already cause downstream errors via `assertCurrentPlayer` or `getLegalMoves` returning [], but making them explicit gives clearer error messages and prevents future regressions.  
**Validation:** Add unit test: call `act()` with `gameOver = true`, assert it throws with the exact message.  
**Smoke test:** Add to `scenarioStartAndHandReadyGuards`: emit `game:action` after gameOver, assert `{ ok: false }`.

---

*End of Multiplayer Hardening Map.*
