# Phase 1 Pass 3 — `useTournamentMatchSession` extraction verification

**Date:** 2026-05-31  
**Scope:** Read-only audit of Pass 3 (`client/src/match/session/useTournamentMatchSession.ts` extracted from `App.tsx`)  
**Verdict:** **Safe to proceed to Phase 1 Pass 4** (`LiveMatchScreen` shell), with documented manual tournament QA and a pre-existing client `npm run build` blocker unrelated to this pass.

---

## Summary

| Check | Result |
|-------|--------|
| Tournament attach (pending/recovery → emit → multiplayer) | **Pass (code + server tests)** — manual E2E not run |
| Join handshake metadata (`applyTournamentMetadataFromJoin`) | **Pass (code)** |
| Game-over bridge (bracket/result/hub, terminal marks, recovery clear) | **Pass (code + server completion/exit tests)** |
| Recovery paths (refresh/reconnect) | **Pass (code + recovery unit tests)** — browser refresh not run |
| Event listeners (duplicates / stale refs) | **Pass with known dual-listener pattern** (unchanged from pre-Pass 3 split) |
| Server build | **Pass** |
| Client `npm run build` | **Pass** (after excluding CLI-only `src/bot/benchmark.ts` from `tsconfig.app.json`) |
| Server tournament test filter | **Pass** — 19 files, 100 tests |
| Manual `TOURNAMENT_SMOKE_TEST.md` | **Not run** (steps documented below) |

**Line counts:** `App.tsx` **4,242** (−748 from post–Pass 2); `useTournamentMatchSession.ts` **1,042**.

**Code changes during verification:** None (no extraction regression found).

---

## What was moved

Into `client/src/match/session/useTournamentMatchSession.ts`:

- **State:** `tournamentMatch`, `tournamentSubView`, `activeTournamentId`, attach phase/error, result fetch state, `completedTournamentId` staging for `tournament:completed`
- **Refs:** `pendingTournamentAttachMatchIdRef`, `attachedTournamentMatchIdRef`, `consumedTournamentGameOverMatchIdsRef`, `failedTournamentAttachByMatchIdRef`, `dismissedTournamentIdsRef`
- **Attach:** `attemptTournamentAttach` → `emitTournamentAttachAssignedMatch` (`roomTransport`) → `applyJoinedRoomResponseRef.current(resp)` → `setAppMode('multiplayer')` on live match
- **Join metadata:** `applyTournamentMetadataFromJoin` (round/opponent HUD context, terminal join short-circuit)
- **Session lifecycle:** `finalizeTournamentMatchSession`, `exitToTournamentHub`, `navigateAfterTournamentMatch`, `attachAssignedTournamentMatch`, `clearTournamentAttachRefs`
- **Socket effects:** `tournament:completed`, `tournament:match_completed`, `room:match_abandoned`
- **Orchestration effects:** bracket lobby routing, bracket terminal auto-kick, recovery/pending attach drains, result-screen bracket prefetch, game-over rejoin guards (`preventAutoRejoin`, `markTerminalTournamentMatch`, `clearLastRoomCode`)
- **Exports:** `TournamentMatchContext`, `getTournamentStageLabel`

`App.tsx` wires the hook with the same ref-forwarding pattern as Pass 2 (`applyJoinedRoomResponseRef`, `clearRecoverableRoomStateRef`, `resetMultiplayerRoomStateRef`).

---

## What stayed in `App.tsx`

- **Routing / `appMode`** and screen selection (home, multiplayer hub, tournament hub/bracket/result shells)
- **Full join orchestration:** `applyJoinedRoomResponse` (room identity, `applyJoinResponseGameState`, recovery idle, seating/ready) — calls `applyTournamentMetadataFromJoin` and returns early on `'terminal_handled'`
- **Connection:** `useMultiplayerConnection`, `useRoomSocketSync`, `useLiveMatchSession`
- **Presentational tournament UI:** `TournamentGameOverOverlay`, `TournamentMatchHud` usage, bracket/result JSX, game-over overlay callbacks → `navigateAfterTournamentMatch`
- **Private multiplayer** abandon/game-over navigation (non-tournament)
- **`useTournament`** hook instance (API/recovery/pending match signals consumed by tournament session hook)

---

## Verification by area

### 1. Tournament attach

| Step | Evidence |
|------|----------|
| Pending/recovery match surfaces | `useTournament` sets `pendingMatch` / `recoveryMatch`; hook effects at recovery (~911) and pending drain (~942) call `attemptTournamentAttach` |
| Emits `tournament:attach_assigned_match` | `emitTournamentAttachAssignedMatch` in `roomTransport.ts` unchanged |
| Success → multiplayer | On ack success (non-terminal): `applyJoinedRoomResponseRef.current(resp)` then `setAppMode('multiplayer')` (~522–572) |
| Context preserved | `applyTournamentMetadataFromJoin` runs inside `applyJoinedRoomResponse`; sets `tournamentMatch` when `resp.tournamentMatch.round` is a number |
| Guards | `evaluateTournamentAttachGuard` + terminal match IDs unchanged; server: `registerRoomSessionHandlers.tournament.test.ts` (8 tests) |

### 2. Join handshake metadata

- `applyJoinedRoomResponse` (`App.tsx` ~1647) still invokes `applyTournamentMetadataFromJoin(resp, nextState)` before seating/ready logic.
- Missing/invalid metadata: `else` branch sets `setTournamentMatch(null)` — HUD gated on `tournamentMatch` truthy (`App.tsx` ~3926); no throw path identified.
- Terminal completed match on join: returns `'terminal_handled'` → early return from `applyJoinedRoomResponse` (~1680–1683).

### 3. Game-over bridge

- **Live game-over:** effect marks terminal + `consumedTournamentGameOverMatchIdsRef` + clears `lastRoomCode` (~784–803).
- **Socket:** `tournament:match_completed` → `finalizeTournamentMatchSession` (clears room, routes `tournamentSubView` via `tournamentSubViewAfterMatchComplete`, clears pending/recovery).
- **Tournament complete:** `tournament:completed` → `setCompletedTournamentId` → follow-up effect routes to `result` subview (~698–710).
- **Overlay:** `TournamentGameOverOverlay` in App calls `navigateAfterTournamentMatch('bracket'|'result'|'hub')` from hook API.
- **Reattach prevention:** `isTerminalTournamentMatch`, `markTerminalTournamentMatch`, attach guard `match-completed`, join terminal path.

### 4. Recovery paths (code-level)

| Scenario | Mechanism |
|----------|-----------|
| Refresh before attach | `useTournament` + `bindTournamentRecoverySignals` → `recover()` → `recoveryMatch` effect |
| Refresh during assigned (not in room) | Pending/recovery attach effects; socket reconnect via `connectRef` on `socket-disconnected` guard |
| Refresh during live tournament match | Standard MP recovery + `applyJoinedRoomResponse`; tournament metadata re-applied on join ack |
| Socket disconnect | Connection layer rejoin; attach guard backoff; tournament attach reconnects socket when not manual |
| Opponent abandon / forfeit | `room:match_abandoned` in hook only — tournament branch routes bracket + toast via `onTournamentMatchAbandoned` |

Server: `scheduledTournament/recovery.test.ts`, `clientRecoverySignals.test.ts`, attach guard tests included in filter run.

### 5. Event listeners

| Event | Locations | Duplicate? |
|-------|-----------|------------|
| `tournament:match_completed` | `useTournamentMatchSession` (finalize session) + `useTournament` (clear pending/recovery, refresh bracket) | **Two handlers, different responsibilities** — same as pre-Pass 3 (App had routing; `useTournament` had data). Both use `socket.on` / `socket.off` with stable handler refs per effect. |
| `tournament:completed` | Hook (route to result via `completedTournamentId`) + `useTournament` (refresh/clear) | Same dual pattern |
| `room:match_abandoned` | **Hook only** | No App duplicate (grep: single registration) |

**Stale-ref risk:** `attemptTournamentAttach` and `finalizeTournamentMatchSession` use `applyJoinedRoomResponseRef`, `clearRecoverableRoomStateRef`, `resetMultiplayerRoomStateRef` at invoke time — same Pass 2 pattern. `applyJoinedRoomResponseRef.current` assigned synchronously after hook definition (~1828).

**Listener churn:** Socket effects depend on `[socket]` or `[socket, finalizeTournamentMatchSession]`; re-subscribe on socket identity change only (expected).

---

## Runtime / timing risks

1. **Dual `tournament:match_completed` handlers** — `finalizeTournamentMatchSession` may run in the same tick as `useTournament` refresh; order is socket-delivery order. Pre-existing; watch for double navigation if server emits duplicate events (mitigated by `isTerminalTournamentMatch` early return in hook handler).
2. **`completedTournamentId` two-step** — `tournament:completed` sets state; separate effect applies navigation when `activeTournamentId` / registrations match. Brief frame possible before route to result.
3. **Attach vs bracket lobby** — pending/recovery attach skipped when `tournamentPhase === 'bracket_lobby'`; manual `attachAssignedTournamentMatch` still available from bracket UI.
4. **Effect dependency on `tournament.registrations`** — completed-tournament routing effect re-runs on registration list changes (could re-evaluate `ours` check).
5. **CLI benchmark** — `src/bot/benchmark.ts` excluded from `tsconfig.app.json` (dev-only via `npm run benchmark:tier`); not part of Vite bundle.

---

## Tests run

```bash
npm run build --prefix server          # PASS
npm test --prefix server -- registerRoomSessionHandlers.tournament scheduledTournament tournamentAttachGuard tournamentCompletion tournamentExit
# PASS — 19 files, 100 tests

npm run build --prefix client          # PASS (benchmark.ts excluded from app tsconfig)
```

**Not re-run for this pass:** `npm run test:smoke:sockets --prefix client` (Pass 2 baseline was 16/16 on fresh server).

**Spot check:** `registerRoomSessionHandlers.tournament.test.ts` alone — 8/8 pass.

---

## Manual QA checklist

Source: `TOURNAMENT_SMOKE_TEST.md` (~10 min with DB + 2–4 browsers).

| # | Scenario | Verified this pass |
|---|----------|-------------------|
| 1 | Hub loads, registration window | **No** |
| 2 | Bracket generates (4+ players recommended) | **No** |
| 3 | Join Match → attach → amber tournament banner (name + rating) | **No** |
| 4 | Play to 30; loser eliminated; next round slot updates | **No** |
| 5 | Final → auto-route to Result on `tournament:completed` | **No** |
| 6 | Refresh before attach (recovery banner / auto-attach) | **No** |
| 7 | Refresh mid-live tournament match (rejoin + HUD metadata) | **No** |
| 8 | Disconnect/reconnect during live match | **No** |
| 9 | Opponent abandon → bracket + forfeit toast | **No** |
| 10 | Completed match does not re-attach after game-over | **No** |

**Recommended minimal Pass 3 manual path (if not running full smoke):**

1. Start server + client (`npm run dev` in each).
2. Two users register for a tournament in `registration_open` → wait for bracket / `match_ready`.
3. Browser A: Join Match — confirm console `[tournament:attach-client] start` / `ack/success` / `switching-to-multiplayer`.
4. Confirm amber `TournamentMatchHud` (round label, not null opponent).
5. Play one hand to game-over — confirm bracket or result navigation, no immediate re-attach loop.
6. Hard-refresh during step 4 — confirm rejoin or recovery attach without crash.
7. (Optional) Opponent closes tab — confirm `room:match_abandoned` forfeit path.

---

## Proceed to Pass 4?

**Yes — proceed to Phase 1 Pass 4** (`LiveMatchScreen` presentational extraction per migration plan).

Pass 3 is structurally sound: wiring mirrors Pass 2 ref patterns, server tournament suite is green, and no client-side extraction regression was found in static/trace review. Residual risk is **manual tournament E2E** and the **unrelated client build failure** on `benchmark.ts`; neither blocks starting Pass 4 if you accept code-review + server-test confidence for tournament orchestration.

**Stabilize Pass 3 first only if:** manual smoke finds attach/HUD/game-over bugs before Pass 4 UI shell work.

---

## Related docs

- `docs/phase-1-pass-2-live-match-session-extraction-report.md`
- `docs/core-gameplay-architecture-migration-plan.md`
- `TOURNAMENT_SMOKE_TEST.md`
