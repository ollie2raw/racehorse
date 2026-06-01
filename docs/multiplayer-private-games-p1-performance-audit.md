# Multiplayer / Private Games — P1 Performance & Lag Audit

**Audit date:** 2026-05-31  
**Scope:** In-game private 1v1 multiplayer after create/join/start is working (P0 stabilization complete; live socket smoke **16/16**).  
**Mode:** Read-only — no code changes, no instrumentation added in this pass.  
**Baseline:** P0 correctness audit in `docs/multiplayer-private-games-source-of-truth-audit.md`; stabilization report in `docs/multiplayer-private-games-p0-stabilization-report.md`.

---

## Executive summary

Multiplayer feels laggy because **every tile action is server-authoritative with no optimistic board update**, the UI **stays in a “pending action” lock until the socket ack returns even after `state:update` arrives**, and **each move triggers a full `GameState` JSON round-trip plus a monolithic `App.tsx` re-render** that recomputes board layout multiple times.

The stack is structurally sound after P0 (serialized `act()`, hand masking, sequence watermarks). Performance pain is mostly **latency stacking** (network + ack gating + render/projection cost), not correctness bugs.

**Safest first wins:** release UI pending state when authoritative `state:update` matches the ack sequence; stabilize `Board` callback refs; eliminate duplicate board projection; measure payload + render time before larger architecture splits.

---

## 1. Runtime path — one MOVE

### User click → server

```
HandView tile tap
  → App.handleTileTap (select tile)
  → Board placement zone click
  → App.play(position)
       setPendingUiAction('play')
       pendingActionRef.current = true
       setSelectedTile(null)
       emitWithAck(socket, 'game:action', roomCode, { type: 'MOVE', move: { tile, position } })
         [8s timeout; mp_debug logs sent/ack elapsedMs]

Server registerRoomSessionHandlers 'game:action'
  → resolveActorSeatId, validate seated player
  → act(roomCode, playerSeatId, action, io, broadcastCallback)
       withRoomGameplayLock (P0 — serializes concurrent actions)
       actUnlocked MOVE branch:
         applyMove → optional resolveForcedDrawAtomically (atomic multi-draw)
         commitResolvedGameState (increments sequence)
  → broadcastStateUpdate(room.code)          // synchronous, all room sockets
  → emitForcedDrawAnimationPayload (if forced draw after play)
  → cb({ ok: true, sequence, forcedDraw? })  // ack AFTER broadcast
```

**Important:** `act()` does **not** call its `onStateReady`/`broadcast` callback internally. There is exactly **one** `broadcastStateUpdate` per action in the handler (not mid-chain).

### Server → client render

```
socket 'state:update' (useRoomSocketSync.onStateUpdate)
  → [if resyncInFlight: buffer in resyncBufferedUpdateRef]
  → applyAuthoritativeStateUpdate(payload)
       projectMultiplayerGameState(rawState)     // projectRenderableBoard + hydrateBoardForOpenEnds
       applySequenceToWatermark (stale/regression → fetchGameState)
       setState(nextState)
       setLegalMoves(payload.legalMoves)
       setCanDraw(payload.canDraw)
       setOptimisticPlayedTile(null)             // optimistic path exists but is never set on play
       setBoneyardDisplayCount(...)
       setRoomRecoveryState('idle') + message clear
       clearDrawPreview / forced-draw meta handling

App re-render (entire component — ~5.7k lines, ~35 useState, ~70 useEffect)
  → boardForDisplay = useMemo → projectRenderableBoard(state.board)  // 2nd projection
  → boardLegalMoves gated by pendingUiAction === 'play' → EMPTY until ack finally{}
  → MatchLiveLayout → Board (memo'd, but play callback identity often changes)
       computeLayout ×2–3 (layout, placementZones, optional glowLayout)
       camera auto-fit useEffect
       tile DOM for all placed tiles

emitWithAck finally:
  setPendingUiAction(null)
  pendingActionRef.current = false
  appendMultiplayerMove (move log + setMultiplayerMoveLog)
```

### Perceived lag timeline (actor)

| Phase | What the player sees |
|-------|----------------------|
| Click | Tile deselected immediately; board may still show old position |
| RTT | No tile on board; legal zones empty (`pendingUiAction === 'play'`) |
| `state:update` | Board **could** update, but legal zones still empty until ack |
| Ack `finally` | Legal zones / next-turn UI unlock; second render pass |

**Root UX issue:** authoritative state arrives **before** ack, but UI treats ack as the gate for clearing pending state.

---

## 2. Runtime path — DRAW / PASS

### Manual or auto DRAW

```
App.draw() OR auto-turn useEffect (lines ~3482–3551)
  → guards: isMyTurn, !hasPlayMoves, canDrawNow, !pendingActionRef, recovery idle
  → setPendingUiAction('draw'); pendingActionRef = true
  → emitWithAck('game:action', { type: 'DRAW', requestId })

Server actUnlocked DRAW:
  → resolveDrawUntilPlayableAtomically (multi-draw + optional auto-pass in one commit)
  → commitResolvedGameState
  → returns forcedDrawAnimation { steps[], stoppedReason }

Handler:
  → broadcastStateUpdate (final hand/boneyard already correct)
  → emitForcedDrawAnimationPayload (game:draw_animation to drawer + room)
  → ack { ok, sequence, forcedDraw: { drewCount, stoppedReason } }
  → mpAutoDrawSuppressUntilSequenceRef = resp.sequence (blocks auto-draw effect until state catches up)

Client state:update:
  → applyAuthoritativeStateUpdate (hand already includes drawn tiles)
  → forcedDrawCount / forcedDrawActorId in payload for self-draw skip animation path

Client game:draw_animation (if not self-skipped):
  → FORCED_DRAW_STAGGER_MS = 72 per step
  → FORCED_DRAW_FLY_MS = 520 per flying tile
  → FORCED_DRAW_CHAIN_CAP_MS = 640 total
  → per step: playDrawSound, setBoneyardDisplayCount, setFlyingTiles (+ removal timer)
  → chain end: clear draw step state, setBoneyardDisplayCount(null)
```

**Forced draw after MOVE** follows the same animation path; server resolves the entire draw chain **before** broadcast (atomic), then animates cosmetically.

### PASS

Same ack pattern as DRAW without animation payload. Auto-pass can be bundled server-side (`recentAutoPasses` in `state:update` → toast “No moves available — passing…”).

### Auto-turn effect cost

The auto draw/pass `useEffect` depends on **`state` (whole object)**, `myHand.length`, `boneyardCount`, recovery flags, and fires after every `state:update`. When it triggers `draw()` or `pass()`, that starts **another** full action round-trip.

---

## 3. Top lag causes (ranked by impact)

### A. Server / network latency

| Rank | Cause | Impact | Evidence |
|------|-------|--------|----------|
| A1 | **Full RTT before UI unlocks** | High | No optimistic placement; `pendingUiAction` cleared in ack `finally`, not on `state:update` |
| A2 | **Full `state:update` JSON every move** | High | `broadcastStateUpdate` sends masked `GameState` + `legalMoves` + `canDraw` per socket |
| A3 | **Per-recipient server work on broadcast** | Medium | `getRoomLegalMoves` + `getRoomCanDraw` + `maskStateForRecipient` for each connected socket |
| A4 | **Socket.IO transport order** | Low–Medium | `transports: ['polling', 'websocket']` — first connect may use polling before upgrade |
| A5 | **`emitWithAck` 8s timeout path** | Low (unless degraded) | User waits on ack promise; failure modes feel like hangs |

### B. Client render / re-render cost

| Rank | Cause | Impact | Evidence |
|------|-------|--------|----------|
| B1 | **Monolithic `App.tsx` re-render** | High | ~35 `useState`; each `state:update` triggers multiple setters; ~70 `useEffect`s registered regardless of visible screen |
| B2 | **`play` / `draw` / `pass` callback churn** | Medium–High | `useCallback` deps include `state`, `legalMoves` → new function every move → `Board` memo bypass (`onPositionClick` in `areBoardPropsEqual`) |
| B3 | **Opponent-move analysis effect** | Medium | On every `state` change when opponent acted: `cloneBoardState`, `snapshotBoardState`, `appendMultiplayerMove` |
| B4 | **Auto draw/pass effect on full `state`** | Medium | Runs after every update; can chain another action |
| B5 | **`appendMultiplayerMove` on own actions** | Low–Medium | Extra `setMultiplayerMoveLog` after ack |

### C. Board layout / projection cost

| Rank | Cause | Impact | Evidence |
|------|-------|--------|----------|
| C1 | **Double (sometimes triple) board projection** | High | `projectMultiplayerGameState` in socket sync + `boardForDisplay` useMemo + frozen-hand effect |
| C2 | **`computeLayout` called 2–3× per Board render** | Medium–High | `layout`, `placementZones`, `glowLayout` each call full `computeLayout` |
| C3 | **Camera auto-fit `useEffect`** | Medium | Runs on `[layout, unitToPixels]` changes |
| C4 | **`getLegalMoves` size drives zone computation** | Medium | More legal moves → more placement zones to layout |

### D. Animation / timer cost

| Rank | Cause | Impact | Evidence |
|------|-------|--------|----------|
| D1 | **Forced-draw stagger timers** | Medium | Up to ~640ms chain; multiple `setFlyingTiles` / `setBoneyardDisplayCount` per step |
| D2 | **Draw sound per step** | Low | `playDrawSound` each stagger tick |
| D3 | **Score toast / pulse effects** | Low | Opponent tile count pulse, score hit animations |

### E. Unnecessary duplicate socket / state work

| Rank | Cause | Impact | Evidence |
|------|-------|--------|----------|
| E1 | **Ack does NOT duplicate state** | — | Ack returns `{ ok, sequence, forcedDraw? }` only; no second full state in ack |
| E2 | **Join ack vs broadcast** | Low | `attachSocketToTrackedRoom` returns state in ack; does **not** call `broadcastStateUpdate` on join |
| E3 | **Resync buffer** | Low–Medium | During `fetchGameState`, `state:update` buffered then flushed — can feel like a burst after reconnect |
| E4 | **`state:update` + `game:draw_animation`** | Intentional | Not duplicate state; animation is cosmetic overlay after authoritative state |
| E5 | **`useRoomSocketSync` effect deps `[params]`** | Low–Medium | Rebinds all socket listeners when `roomSocketSyncParams` identity changes (e.g. `fetchGameState` recreation) |

---

## 4. `App.tsx` re-render blast radius

### What changes on every `state:update`

From `applyAuthoritativeStateUpdate` (`useRoomSocketSync.ts`):

- `setState(nextState)` — **primary driver**
- `setLegalMoves(...)`
- `setCanDraw(...)`
- `setOptimisticPlayedTile(null)`
- `setBoneyardDisplayCount(...)`
- `setRoomRecoveryState('idle')` + `setRoomRecoveryMessage('')`
- `setOpponentDisconnected(false)` + `setOpponentDisconnectMessage('')`
- Draw-preview clears may call several draw-related setters

React 18 batches these into **one** render, but it is still a **full `App` render**.

### Multiplayer state held in `App.tsx` (non-exhaustive)

`state`, `legalMoves`, `canDraw`, `you`, `players`, `joinedRoom`, `pendingUiAction`, `selectedTile`, `drawStep*`, `flyingTiles`, `boneyardDisplayCount`, `drawPulseIndex`, `opponentDisconnected`, `handReveal`, `multiplayerMoveLog`, `scoreToast`, `hudScorePulse`, tournament/rating overlays, recovery flags, etc.

### Effects that run when `state` changes (in-game impact)

| Effect | Trigger | Work |
|--------|---------|------|
| Auto draw/pass | `[state, …]` | May emit another `game:action` |
| Opponent move log | `[state, you, …]` | Board clones + move log append |
| Frozen hand-over board | `[state]` | `projectRenderableBoard` |
| `boardForDisplay` useMemo | `[state]` | `projectRenderableBoard` |
| Score / rating refresh | `state.gameOver`, hand transitions | Profile fetch loops |
| Hand pulse / opponent count | derived from state | Extra setState |

### Conditional render vs hook cost

Game UI (`joinedRoom && state`) is conditionally **rendered**, but **hooks are not gated** — daily/home/tournament effects still run unless individually guarded (most are not `appMode`-gated).

### `MatchLiveLayout`

Thin layout shell (`InGameBoardShell` → HUD + frame). **No memo.** Re-renders whenever `App` passes new inline JSX for `hudLeft`, `boardInner`, `handDock` (new element trees every `App` render).

### `Board`

Wrapped in `memo(..., areBoardPropsEqual)`, but **`onPositionClick={play}` often changes identity** because `play` depends on `state` and `legalMoves`. When memo fails, full board layout pipeline runs.

---

## 5. Full-state payload audit (`state:update`)

### Payload shape (per seated player)

```typescript
{
  state: GameState,      // masked — opponent hand: []
  legalMoves: Move[],    // recomputed for recipient if it's their turn
  canDraw: boolean,
  you?: string,
  eventMeta?: { matchId, lastEventSequence, eventCount },
  matchStarted: true,
  forcedDrawCount?: number,
  forcedDrawActorId?: string,
  recentAutoPasses?: string[],
}
```

### `GameState` fields (always sent)

| Field | Changes every move? | Trim/memo potential |
|-------|---------------------|---------------------|
| `config` | No | Send once per match / hand |
| `playerIds` | Rarely | Static for 1v1 |
| `players[id].hand` | Yes (actor only unmasked) | Already masked for opponent |
| `players[id].score` | On score | Could delta-encode |
| `handCounts` | Yes | Redundant with masked hands (useful for opponent count) |
| `board` | Yes | Largest piece; grows to ~28 placed tiles + hub graph |
| `boneyard[]` | On draw | Client mostly needs **length**; full tile array unused in UI |
| `deadTiles[]` | Rarely | Could send count only |
| `currentPlayerIndex` | Yes | Small |
| `handNumber`, flags, `sequence` | Sometimes | Small |
| `legalMoves[]` | Yes | Can be large (hand × open ends); separate channel candidate |
| `canDraw` | Yes | 1 bit |

### Rough size estimate (JSON over wire)

| Phase | Approx. payload | Notes |
|-------|-----------------|-------|
| Opening hand | 8–15 KB | Full hands + empty board + boneyard/dead piles |
| Mid-game | 15–35 KB | Board graph dominates |
| Late board + many legal moves | 30–50+ KB | `legalMoves` adds multi-KB when many placements |

**Per move:** entire object re-sent; **no delta/diff**. Socket.IO JSON parse + `projectMultiplayerGameState` on main thread.

### Server CPU per broadcast

For each socket in room:

1. `getRoomLegalMoves(roomCode, recipientPlayerId)` → `getLegalMoves` simulates placements
2. `maskStateForRecipient`
3. `JSON.stringify` + emit

Two-player room ≈ 2× legal move computation per move.

---

## 6. Socket / update duplication audit

| Scenario | Duplicate full state? | Notes |
|----------|----------------------|-------|
| `game:action` ack + broadcast | **No** | Ack is metadata only; broadcast is single `state:update` |
| Join / rejoin ack + broadcast | **Usually no** | Join ack applies state; attach does not broadcast unless another event fires |
| Reconnect `fetchGameState` | **Possible burst** | Join ack applies state; buffered `state:update` flushed after resync |
| `game:start` | **One broadcast** | Via `tryStartMatchIfReady` → `broadcastStateUpdate` |
| Forced draw | **State + animation** | `state:update` (final) then `game:draw_animation` (cosmetic); not duplicate state |
| Spectators | **Separate event** | Players get `state:update`; spectators get `state:spectate` without legal moves |
| Sequence stale rejection | **Resync** | `fetchGameState` → full join ack again (intentional recovery, feels like lag spike) |

### Action ordering (confirmed)

```typescript
// registerRoomSessionHandlers.ts ~1088–1110
broadcastStateUpdate(room.code);
if (result.forcedDrawAnimation) emitForcedDrawAnimationPayload(...);
cb({ ok: true, sequence, forcedDraw });
```

Actor receives **`state:update` before ack resolves** — opportunity to clear pending UI earlier.

---

## 7. Board render audit

### On each move (when Board memo fails)

1. **`openEndPositions`** — `useMemo` from board hub scan  
2. **`validPositions`** — filter `legalMoves` by selected tile  
3. **`cameraFitPositions`** — derived from selection / glow  
4. **`computeLayout(board, cameraFitPositions)`** — main layout (hub branches, bounds)  
5. **`computeLayout(board, validPositions)`** — placement zones (**second full layout pass**)  
6. **`computeLayout(board, openEndPositions)`** — glow layout if enabled (**third pass**)  
7. Camera scale `useEffect` — DOM measurement + transform update  
8. Map `layout.tiles` → `DominoTile` components  

### Legal moves / open ends

- Server sends `legalMoves`; client does not recompute engine legality in multiplayer.
- Board derives **placement zones** from legal moves + selection locally.
- When `pendingUiAction` is active, `boardLegalMoves = EMPTY_MOVES` — zones hidden during ack wait.

### Hand rendering

- `HandView` receives full `myHand` from authoritative state (already updated on `state:update`).
- `drawPulseIndex`, `drawStepMyHand` overlay draw animations.

### Projection

- `projectRenderableBoard` + `hydrateBoardForOpenEnds` normalize hub arms — **O(board tiles)** per call.
- Called in socket handler path and again in `App` `boardForDisplay`.

---

## 8. Quick wins vs risky optimizations

### P1a — Safest small wins (recommended first pass)

| # | Change | Expected gain | Risk |
|---|--------|---------------|------|
| 1 | **Clear `pendingUiAction` / `pendingActionRef` when `state:update.sequence >= ack sequence`** (or on matching `state:update` for actor) | High perceived responsiveness | Low — must preserve auto-draw suppress logic |
| 2 | **Stabilize `play` / `draw` / `pass` with refs** (`stateRef`, `legalMovesRef`) so `Board` memo hits | Medium render savings | Low |
| 3 | **Remove redundant `projectRenderableBoard` in `boardForDisplay`** when state already projected | Medium CPU | Low — verify hand-over frozen board path |
| 4 | **Instrumentation only:** payload bytes, ack RTT, render timing (see §9) | Enables evidence-based next steps | None |
| 5 | **`localStorage mp_debug=1`** already logs ack elapsed — document as baseline | Measurement | None |

### P1b — Medium changes

| # | Change | Expected gain | Risk |
|---|--------|---------------|------|
| 6 | **Optimistic tile on board** (set `optimisticPlayedTile` on play, clear on mismatch) | High UX | Medium — must respect sequence + forced draw |
| 7 | **Extract multiplayer game shell** to child component with isolated state | High — shrinks blast radius | Medium — large file touch |
| 8 | **Send `boneyardCount` instead of `boneyard[]`** in broadcasts | Medium bandwidth | Medium — server/client contract |
| 9 | **Split `legalMoves` channel** or cache until turn change | Medium server + wire | Medium |
| 10 | **Websocket-only** after first connect (`transports: ['websocket']`) | Low–medium latency | Low — test flaky networks |
| 11 | **Consolidate Board `computeLayout` calls** (single pass returns layout + zones) | Medium CPU | Low–medium |
| 12 | **Gate opponent analysis / move log effect** behind debug or post-game | Medium CPU | Low |

### P2 / P3 — Larger architecture (defer)

| # | Change | Notes |
|---|--------|-------|
| 13 | Delta/diff state updates | Protocol change; high correctness risk |
| 14 | Split `App.tsx` by mode with separate React roots / routers | High refactor |
| 15 | Move game state to Zustand/Redux with selectors | Broad retest |
| 16 | Server-side legal move caching per `(sequence, playerId)` | Needs invalidation discipline |
| 17 | Shorten or disable forced-draw fly animations in ranked/private | Product decision |
| 18 | Edge/stateless room storage | Infra — not perf-only |

---

## 9. Measurement plan

### Console timing (minimal instrumentation — next pass)

```javascript
// Proposed hooks (not yet in code):
// 1. App.play: t0 at click, t1 at state:update (match sequence), t2 at ack
// 2. applyAuthoritativeStateUpdate: performance.now() before/after projectMultiplayerGameState
// 3. Board: performance.now() around computeLayout (extend Daily Fritz metric pattern)
```

Enable existing debug:

```javascript
localStorage.setItem('mp_debug', '1'); // ack RTT logs: [mp-action-client] sent/ack
```

### Render counters

- React DevTools **Profiler**: record one move; inspect `App` vs `Board` commit duration.
- Temporary `useRef` render count in `App` + `Board` (DEV only).
- `Board` already supports `recordDailyFritzBoardMetric('computeLayout', ms)` when `profileDailyFritz` — mirror for multiplayer DEV flag.

### Payload size logging

Server-side (next pass):

```typescript
// In broadcastStateUpdate before emit:
const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
if (process.env.MP_PERF === '1') console.log('[mp-payload]', { roomCode, bytes, sequence: room.state.sequence });
```

Client-side: measure `state:update` handler entry with `JSON.stringify(payload).length` (DEV only).

### Socket RTT

- Existing **`mp:ping`** every 5s with callback (DEV log when `mp_debug=1`).
- **`emitWithAck` elapsedMs** for `game:action` = action RTT (includes server processing + broadcast + ack).

### React Profiler scenario

1. Two browsers, private room, start game.  
2. Profiler on actor client.  
3. Perform 5 consecutive moves (mix straight plays + one forced-draw line).  
4. Export commit timings for `App`, `Board`, `HandView`.

### Smoke / perf scenario

Extend `client/scripts/socketSmoke.mjs`:

- `private-create-join-start-move` (existing) + log ack ms for 10 moves.  
- Optional: headless Playwright with Performance API marks.

### Manual QA checklist

- [ ] Tile appears on board within **one frame** of opponent seeing it (same move).  
- [ ] Own move: measure click → visible tile (**target < 150ms LAN, < 350ms internet**).  
- [ ] Forced draw: animation does not block next input after chain cap (640ms).  
- [ ] Reconnect mid-game: single state apply, no visible double-jump.  
- [ ] Pass/auto-pass: no duplicate toasts or double actions.  
- [ ] Long game (20+ moves): no progressive slowdown (move log / memory).  
- [ ] DevTools Performance: no >50ms long tasks on each `state:update`.

---

## 10. Recommended next implementation prompt

Use this as the **smallest first performance pass** after measurement baselines:

---

**Prompt: P1a multiplayer perceived-latency pass (no protocol changes)**

Goal: Reduce felt lag on private multiplayer moves without changing gameplay rules, socket protocol, or UI design.

1. Add DEV-only timing logs (click → `state:update` → ack; payload bytes; `computeLayout` ms) behind `MP_PERF=1` or `localStorage mp_debug`.
2. In `App.tsx`, clear `pendingUiAction` and `pendingActionRef` when an incoming `state:update` carries `state.sequence >=` the sequence returned by the pending ack (wire via ref set in `play`/`draw`/`pass` ack handler). Keep `mpAutoDrawSuppressUntilSequenceRef` behavior unchanged.
3. Stabilize `play`, `draw`, and `pass` callbacks using refs for `state`, `legalMoves`, and `joinedRoom` so `Board` memoization survives moves.
4. Remove duplicate `projectRenderableBoard` in `boardForDisplay` when `state.board` is already hydrated (guard with a cheap marker or trust socket-sync projection; preserve hand-over frozen board ref path).
5. Run client build + socket smoke 16/16 + manual two-client move test.

Out of scope: optimistic tile rendering, App split, payload trimming, animation changes.

---

## Files referenced

| Area | Files |
|------|-------|
| Orchestration | `client/src/App.tsx` |
| Socket state | `client/src/multiplayer/useRoomSocketSync.ts` |
| Connection | `client/src/multiplayer/useMultiplayerConnection.ts` |
| Room actions | `client/src/multiplayer/useMultiplayerRoomActions.ts` |
| Projection | `client/src/multiplayer/boardSnapshotGuards.ts` |
| Layout shell | `client/src/match/board/MatchLiveLayout.tsx` |
| Board | `client/src/components/Board.tsx` |
| Server broadcast | `server/src/multiplayer/roomSession.ts` |
| Server actions | `server/src/multiplayer/registerRoomSessionHandlers.ts`, `server/src/rooms.ts` |
| Legal moves | `server/src/game/engine.ts` |

---

## Definition of done (this audit)

You should now understand:

1. **Why it feels laggy** — ack-gated UI + full-state round trips + monolithic re-renders + multi-pass layout/projection.  
2. **What to optimize first** — pending-state release on authoritative update, callback stabilization, dedupe projection, then measure.  
3. **What to defer** — protocol diffs, App architecture split, optimistic play until P1a is measured.

**Next step:** Run measurement baselines (§9), then execute the §10 prompt in a focused PR.
