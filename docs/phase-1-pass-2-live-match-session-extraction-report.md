# Phase 1 Pass 2 — `useLiveMatchSession` extraction verification

**Date:** 2026-06-01  
**Scope:** Read-only audit of Pass 2 (`client/src/match/session/useLiveMatchSession.ts` extracted from `App.tsx`)  
**Verdict:** **Behavior-neutral enough to proceed to Phase 1 Pass 3** (`useTournamentMatchSession`), with documented manual QA and one low-risk listener-churn watch item.

---

## Summary

| Check | Result |
|-------|--------|
| Ref-forwarding (`applyRoomEventMeta`, `fetchGameState`, `resetClientGameSession`) | **Pass** — invoke-time `.current` reads; synchronous ref assignment before effects |
| Hook ownership boundaries | **Pass** — live match session vs App orchestration split is intentional |
| Socket event names / payloads / emit paths | **Pass** — unchanged; still `roomTransport` + `useRoomSocketSync` + `useMultiplayerConnection` |
| Risk spots (hand reveal, auto turn, rematch, etc.) | **Pass (code review)** — manual QA still recommended |
| Automated baselines | **Pass** (see Tests) |

**Line counts:** `App.tsx` **4,990** (−756 from post–Pass 1); `useLiveMatchSession.ts` **1,287**.

---

## 1. Ref-forwarding correctness

### Pattern

`useLiveMatchSession` is invoked **before** the real `fetchGameState`, `applyRoomEventMeta`, and `resetClientGameSession` callbacks exist. App passes stable **wrappers** that delegate to refs:

```ts
fetchGameState: (reason) => fetchGameStateRef.current(reason),
applyRoomEventMeta: (meta) => applyRoomEventMetaRef.current(meta),
resetClientGameSession: () => resetClientGameSessionRef.current(),
```

Refs are assigned **synchronously later in the same render** (`fetchGameStateRef`, `applyRoomEventMetaRef`, `schedulePlayerReadyRef` ~2045–2049; `resetClientGameSessionRef` ~1506). Socket/effect callbacks run after paint, so `.current` is always the latest implementation.

### Direct vs ref call sites

| Callback | Via ref wrapper | Direct call |
|----------|-----------------|-------------|
| `applyRoomEventMeta` | `roomSocketSyncParams` → `useRoomSocketSync` | `applyJoinedRoomResponse` calls `applyRoomEventMeta(resp.eventMeta)` directly |
| `fetchGameState` | Hook + join resync fallbacks | `fetchGameStateRef.current(...)` inside `applyJoinedRoomResponse` when projection invalid |
| `resetClientGameSession` | `useRoomSocketSync` on rematch/reset paths | App defines body using `clearTransientRoomUi` from hook |
| `schedulePlayerReady` | `trySchedulePlayerReadyRef` into hook params | `schedulePlayerReadyRef.current` assigned with `emitWithAck(..., 'player:ready', ...)` |

This matches the pre-extract intent: join path uses the real callback immediately; socket sync uses forwarded refs to avoid hook/definition order cycles.

### Other forwarded refs into the hook

`trySchedulePlayerReadyRef`, `joinedRoomRef`, `maxSequenceRef`, `resync*Ref`, `isSeatedPlayerRef`, `matchStartedRef`, `playerReadyEmittedRef`, `appendMultiplayerMove` — all read at call time or passed as ref objects (stable identity). No circular definition: `resetClientGameSession` uses `clearTransientRoomUi` from hook return value defined after the hook call (valid — `resetClientGameSession` is only **invoked** after full render).

---

## 2. Hook ownership boundaries

### Owned by `useLiveMatchSession`

- In-game **authoritative slice**: `state`, `legalMoves`, `canDraw`, selection/optimistic/pending UI, `actionError`
- **Gameplay actions**: `play`, `draw`, `pass`, `startGame`, `requestRematch` (`emitGameStart` / `emitGameAction` / `emitGameRematch` / `emitHandReady` via `roomTransport`)
- **Hand-over UX**: `handReveal`, auto-progress timer, `continueAfterHandReveal`, `hand:ready` **recovery** effect after reconnect
- **Auto draw/pass** when legal and turn rules allow
- **Draw animation** client state + P1a pending UI clear on authoritative `state:update`
- **Opponent drag/disconnect UI state** (setters fed into `useRoomSocketSync`)
- **Board display memos** (`boardForDisplay`, `boardLegalMoves`, …)
- **`applyJoinResponseGameState`** (game projection only; no room identity)
- **`roomSocketSyncParams`** object (built in hook; **subscription stays in App**)

### Still owned by `App.tsx`

- **`appMode`** routing and screen selection
- **Room identity**: `joinedRoom`, `you`, `players`, `roomCode`, lobby UI
- **Connection lifecycle**: `useMultiplayerConnection` (connect, recovery, auto-rejoin, `hand:ended` primary path, `game:rematch:*`)
- **`useRoomSocketSync(liveMatch.roomSocketSyncParams)`** — avoids hook ↔ sync circular deps
- **Full join orchestration**: `applyJoinedRoomResponse` (tournament metadata, recovery idle, `setJoinedRoom`, `fetchGameState` resync triggers)
- **`fetchGameState`**, **`schedulePlayerReady`** / `player:ready`
- **Tournament attach** (`attemptTournamentAttach`, pending/recovery refs) — Pass 3 target
- **Abandon / post-game navigation**: `abandonCurrentMatch`, `navigateAfterMultiplayerGameOver`, tournament bracket/hub routing
- **Move analysis log**: `multiplayerMoveLog`, opponent `useEffect` on `state` (uses exported `findPlacedTile`, `getBoardTileCount`, `getBoardEnds`)
- **`showToast`** (defined **before** hook ~928 so hook deps are stable)

**Boundary is safe** because server authority and socket handler registration did not move — only state setters and gameplay handlers relocated. App still wires the same params into `useRoomSocketSync` and `useMultiplayerConnection`.

---

## 3. Behavior parity (socket / sequencing)

| Area | Location | Change |
|------|----------|--------|
| `state:update`, `room:update`, draw animation, disconnect | `useRoomSocketSync` | None — same handler file |
| `hand:ended`, `game:rematch:status`, `game:rematch:started`, `player:dragging` | `useMultiplayerConnection` | None |
| `game:action`, `game:start`, `hand:ready`, `game:rematch` emit | Hook via `roomTransport` | Same helpers as Pass 1 |
| `player:ready` | App `schedulePlayerReady` | Unchanged |
| `room:abandon` | App `abandonCurrentMatch` | Unchanged |

**Hand reveal dual path (pre-existing):**

1. Primary: `hand:ended` in `useMultiplayerConnection` → 1400ms → `setHandReveal` (sets `handRevealShownRef`).
2. Fallback: hook `useEffect` on `state.handOver` when reveal ref ≠ hand number (reconnect / missed event).

No new duplicate timer was introduced by the extract.

**Move log:** `play` / `draw` / `pass` in hook call `appendMultiplayerMove` with full payloads (restored after initial subagent omission). Opponent moves still logged only in App `useEffect` on `state` transitions.

---

## 4. Risk spots (code-review status)

| Risk | Assessment |
|------|------------|
| `hand:ready` recovery | Hook effect unchanged logic; uses `emitHandReady` + toast on failure |
| Hand reveal timers | Primary still in connection; fallback + auto-progress in hook; cleanup on unmount in hook |
| Auto draw/pass | Hook `useEffect` with same guards (`mpAutoDrawSuppressUntilSequenceRef`, `autoTurnActionKeyRef`) |
| Rematch | `requestRematch` in hook; socket status/started still in connection |
| Opponent move logging | App-only effect; imports board helpers from hook module |
| Reconnect/resync | `fetchGameState` + `resyncBufferedUpdateRef` / `onAuthoritativeGameplayStateApplied` unchanged |
| Abandon / game-over | App-only; uses `emitRoomAbandonMatch`, mode/tournament navigation |
| Toasts after `showToast` move | `showToast` is `useCallback` before hook; passed into hook and connection |

### Watch item (non-blocking)

App passes **new inline wrapper functions** each render into the hook. `roomSocketSyncParams` `useMemo` lists `applyRoomEventMeta`, `fetchGameState`, and `resetClientGameSession` in deps → object may change every render → `useRoomSocketSync` effect depends on `[params]` and may **re-register socket listeners** more often than when `applyRoomEventMeta` was a stable `useCallback` in `App`. Observed behavior should be equivalent; narrow teardown/setup races are theoretically possible. Consider stabilizing wrappers in a later pass if QA sees missed updates.

**No extraction regression fix applied** — not proven by tests or manual repro.

---

## 5. Tests (2026-06-01 verification run)

| Command | Result |
|---------|--------|
| `npm run build --prefix client` | **Pass** |
| `npm run build --prefix server` | **Pass** |
| `npm test --prefix server -- registerRoomSessionHandlers.private handMasking roomGameplayLock` | **10/10 pass** |
| `npm run test:smoke:sockets --prefix client` (server on `:3001`, fresh `node dist/index.js`) | **Pass** — full JSON report, all scenarios including `hand-ended-replay`, `identity-freeze`, etc. |

**Smoke note:** Immediate re-runs against a warm/busy server failed early on `concurrent-action-serialization` (likely environmental / ordering flake, unrelated to client extract). Use a **fresh server** for smoke baseline.

---

## 6. Recommended manual QA (before Pass 3 merge)

1. Private 2P: play → hand over → reveal → continue (`hand:ready`) → next hand.
2. Reconnect mid-hand and after `handOver` (recovery toast path).
3. Auto-draw when only draw legal; auto-pass when no moves.
4. Rematch request + start; cancel hand reveal timer on rematch.
5. Leave match (multiplayer + tournament) — toasts and bracket/hub routing.
6. Opponent move appears in move log / last-played flash.

---

## 7. Ready for Phase 1 Pass 3?

**Yes.** Pass 2 preserved transport, socket handler locations, and server contracts. The next extract (`useTournamentMatchSession`) can follow the same ref-forwarding pattern for `attemptTournamentAttach`, pending attach refs, and tournament game-over bridge without re-touching live gameplay handlers.

**Pass 3 should not move:** `useRoomSocketSync` subscription, `useMultiplayerConnection` `hand:ended` path, or `applyJoinedRoomResponse` room/tournament metadata unless explicitly scoped.

---

## Files touched in Pass 2 (reference)

| File | Role |
|------|------|
| `client/src/match/session/useLiveMatchSession.ts` | New hook |
| `client/src/App.tsx` | Wiring, refs, retained orchestration |
| `client/src/multiplayer/roomTransport.ts` | Pass 1 — emit helpers (unchanged in Pass 2) |
| `client/src/match/recovery/matchRecovery.ts` | Pass 1 — last-room persistence (unchanged in Pass 2) |
