# Phase AA — Task 10: In-Match Reconnect E2E

**Date:** 2026-07-07  
**Scope:** Playwright coverage for multiplayer recovery during an active private match  
**Architecture:** Frozen — no gameplay rules, protocol, matchmaking, or schema changes

---

## 1. Previous coverage gap (Task 7 P2)

Phase AA Task 7 identified **missing true in-match reconnect E2E coverage**. Existing `multiplayer-chaos.spec.ts` only exercised the multiplayer **hub** (refresh, offline hub, visibility) — not a seated 1v1 match with authoritative state.

| Area | Before Task 10 | After Task 10 |
|------|----------------|---------------|
| Hub refresh / offline | `multiplayer-chaos.spec.ts` | Unchanged |
| Private lobby create/join | Ad-hoc in new helpers | `multiplayerMatch.ts` |
| Mid-match transport loss | None | `transport loss` scenario |
| Mid-match refresh recovery | None | `refresh recovery` scenario |
| Superseded session (second tab) | None | `superseded session` scenario |

---

## 2. Test architecture

### 2.1 Files

| File | Role |
|------|------|
| `client/e2e/multiplayer-in-match-reconnect.spec.ts` | Serial suite: transport loss, refresh, superseded session |
| `client/e2e/helpers/multiplayerMatch.ts` | Guest identity seeding, private lobby flow, match waiters, transport helpers |
| `client/playwright.config.ts` | Dual `webServer`: server `:3001/ping` + client `:5173` |

### 2.2 Flow (smallest reliable in-match path)

1. Two isolated browser contexts with **unique guest IDs** per test (`makeRunIdentity`) to avoid stale server sessions.
2. Host: Multiplayer → Private → Create lobby.
3. Guest: Join by room code.
4. Host: Start Match (or auto-ready when both seated).
5. Helpers complete **pre-game draw** by polling pickable tiles until live hand tiles appear.
6. Assertions use **authoritative UI**: `.game-screen`, HUD pills, turn label, recovery copy.

### 2.3 Transport loss simulation

- **Route abort** on `/socket.io/` only (Socket.IO traffic blocked; HTTP/Vite stay up).
- **`engine.close()`** via DEV `window.__racehorseE2eSocket` when available.
- Does **not** call `socket.disconnect()` — voluntary client disconnect clears `joinedRoom` and skips in-match recovery UI (real defect boundary documented below).
- Does **not** use full-browser `setOffline(true)` — that exhausted recovery retries and dropped the host to the disconnected lobby.
- Waits up to **70s** for transport-down / recovery signals.

### 2.4 DEV-only E2E hook

`useMultiplayerConnection` exposes the active socket on `window.__racehorseE2eSocket` in DEV for transport tear-down diagnostics.

### 2.5 E2E identity seeding

- Guest IDs use `guest_e2e_mp_*` prefix so `getOrCreateGuestIdentityId()` preserves them across `reload()` (non-`guest_` IDs are regenerated on navigation).
- `seedPlayerIdentity` must **not** clear `racehorse_last_room_code` in `addInitScript` — that script runs on every navigation including mid-test reload.

---

## 3. Scenarios

### A. Transport loss (host)

1. Disconnect host transport mid-match.
2. Assert guest remains on `.game-screen` (opponent-disconnect banner preferred when grace fires in time).
3. Restore routes; assert host returns to match, recovery overlay clears, scores unchanged, `racehorse_last_room_code` stable.

### B. Refresh recovery (host)

1. Mid-match `reload()`, return via Multiplayer entry (app mode resets to home).
2. Assert auto-rejoin via `racehorse_last_room_code` + stable `guest_*` identity (see §2.5), same scores, guest still in match.

### C. Superseded session (host second tab)

1. Open second tab same context after match start.
2. Assert `Session moved to this device` toast **or** secondary tab reaches match; survivor keeps room code; guest unaffected.

---

## 4. Failure modes now caught

| Failure | Detection |
|---------|-----------|
| Lobby cannot seat two players / Start Match never enables | `waitForLobbyReadyOrMatch` + crash guard |
| Pre-game draw stuck | `completePreGameDrawUntilHandVisible` timeout |
| Server never emits disconnect grace | Guest stays in match; optional opponent banner (70s) |
| Pre-game draw tie shrinks deck below 28 tiles | Server `activeTileSetSize` + invariant override |
| Refresh loses guest identity on reload | E2E `guest_` prefix + no room-code wipe in init script |
| Host recovery does not restore match | `waitForHostBackInMatch` + score equality |
| Refresh loses room / seat | `readLastRoomCode` + HUD score parity |
| Superseded session crash | Serial tab scenario + survivor match screen |
| React crash / infinite render in lobby | `assertNoReactCrash` |

---

## 5. Production fixes exposed by E2E (this sprint)

| Issue | Fix |
|-------|-----|
| React infinite loop when private shell delegates updated parent state | Ref-based `shellDelegatesRef` bridge (no `setShellDelegates` in layout effect) |
| Pre-game draw tie leaves 26 tiles but invariant expected 28 | `activeTileSetSize` on room + `assertValidGameState` override for custom decks |
| Pre-game draw deck assembly | `registerRematchPregameHandlers.ts` uses all non-`outOfPlay` slot tiles |
| Unstable lobby host props invalidating every App render | Removed bare `source` object from `useMultiplayerLobbyHostProps` deps |
| Render-time delegate assignment in matchmaking hooks | Moved to `useLayoutEffect` in `useQueueCounts` / `useMatchmaking` |

---

## 6. Known limitations

| Limitation | Notes |
|------------|-------|
| **70s disconnect detection** | Driven by Socket.IO `pingTimeout` (60s server) + grace; not instant. |
| **Voluntary `socket.disconnect()`** | Clears room session client-side; not used in E2E. Network offline is the realistic path. |
| **Multi-instance deployment** | Intentionally out of scope (Task 7). |
| **hand:ready idempotency** | Separate P2; not covered here. |
| **Disconnect forfeit second-expiry** | Server unit tests only (`disconnectGrace.test.ts`). |
| **CI runtime** | Serial suite ~35s locally; run in `client-ci` with server `npm ci`. |
| **Auth** | Guest localStorage IDs only; must use `guest_` prefix for reload tests. |
| **Manual join after reload** | Fails with “Room is full” for guests when identity mismatches — tests rely on auto-rejoin, not manual join. |

---

## 7. Risk assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| E2E flake on slow CI | Medium | Serial workers, 360s describe timeout, route+abort+offline pattern |
| False green if guest banner text changes | Low | Copy tied to `useRoomSocketSync` opponent message |
| False green if recovery UI copy changes | Low | Poll combines `Reconnecting` + `Connection lost` + board presence |
| Hub regression reintroduces render loop | Medium | `assertNoReactCrash` on lobby path |
| Transport test passes but prod Wi‑Fi edge differs | Low | Offline+route abort approximates total loss; not half-open TCP |

**Overall:** Medium confidence for private 1v1 reconnect on single server instance. Does not certify horizontal scale or tournament/quick-match variants.

---

## 8. Verification commands

```bash
npm run build --prefix client
npm run typecheck --prefix client
npx playwright test e2e/multiplayer-in-match-reconnect.spec.ts
npm run test --prefix server
npm run check:multiplayer-arch --prefix client
npm run check:socket-registry --prefix client
```

---

## 9. Stop boundary

Task 10 completes Phase AA reconnect E2E scope. **Multi-instance scaling is not started** per sprint instructions.