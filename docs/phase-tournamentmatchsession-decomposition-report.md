# Phase: useTournamentMatchSession Decomposition Report

**Date:** 2026-07-05  
**Task:** Decompose `client/src/match/session/useTournamentMatchSession.ts` (1,110 LOC god-hook) into single-responsibility hooks/modules under `match/session/tournament/`, preserving the full public `TournamentMatchSessionApi` return shape.

---

## 1. Step 0 — Scope Check

### 1.1 Call sites and consumed return fields (grep-verified)

**Direct hook invocation (1 site):**

```
client/src/App.tsx:467  const tournamentSession = useTournamentMatchSession({...});
client/src/App.tsx:483–506  destructuring from tournamentSession
```

**Type-only imports (no runtime call):**

| File | Import |
|------|--------|
| `client/src/appRouteTypes.ts` | `ReturnType<typeof useTournamentMatchSession>['tournamentSubView']` … (14 fields) |
| `client/src/multiplayer/MultiplayerModeController.tsx` | `TournamentMatchContext` type |
| `client/src/match/LiveMatchScreen.tsx` | `TournamentMatchContext` type |
| `client/src/multiplayer/multiplayerRuntime.ts` | comment reference only |

**`appRouteTypes.ts` fields tied to `ReturnType<typeof useTournamentMatchSession>` (frozen — must not change shape):**

- `tournamentSubView`
- `activeTournamentId`
- `tournamentAttachPhase`
- `tournamentAttachError`
- `tournamentResult`
- `tournamentResultLoading`
- `tournamentResultError`
- `setTournamentSubView`
- `setActiveTournamentId`
- `setTournamentResult`
- `setTournamentResultLoading`
- `setTournamentResultError`
- `exitToTournamentHub`
- `enterTournamentLobby`
- `attachAssignedTournamentMatch`

**`App.tsx` destructures 22 of 26 API fields** (lines 483–506):

```typescript
  const {
    tournamentSubView,
    setTournamentSubView,
    activeTournamentId,
    setActiveTournamentId,
    tournamentMatch,
    setTournamentMatch,
    currentTournamentContext,
    tournamentAttachPhase,
    tournamentAttachError,
    tournamentResult,
    setTournamentResult,
    tournamentResultLoading,
    setTournamentResultLoading,
    tournamentResultError,
    setTournamentResultError,
    consumedTournamentGameOverMatchIds,
    clearTournamentAttachRefs,
    applyTournamentMetadataFromJoin,
    attachAssignedTournamentMatch,
    exitToTournamentHub,
    enterTournamentLobby,
    navigateAfterTournamentMatch,
  } = tournamentSession;
```

**Returned but not destructured in `App.tsx` (still part of public API):**

- `pendingTournamentAttachMatchIdRef`
- `attachedTournamentMatchIdRef`
- `attemptTournamentAttach`
- `finalizeTournamentMatchSession`

**Downstream passthrough from `App.tsx` (no call-site signature change):**

| Field | Passed to |
|-------|-----------|
| `tournamentMatch`, `consumedTournamentGameOverMatchIds`, `navigateAfterTournamentMatch`, `currentTournamentContext` | `appRoutesHostSource` → multiplayer assembly → `MultiplayerModeController` / `LiveMatchScreen` |
| `applyTournamentMetadataFromJoin` | `useJoinAckCoordinator` join handler (`App.tsx:827`) |
| `clearTournamentAttachRefs` | shell delegate reset effect (`App.tsx:613`) |
| `attachAssignedTournamentMatch`, `exitToTournamentHub`, `enterTournamentLobby`, tournament UI state | `appRoutesHostSource.routeBundles.tournament` (frozen AppRoutes layer) |

**Blocking-boundary check:** No frozen file was modified. `App.tsx` call site and destructuring are unchanged. Public `TournamentMatchSessionApi` retains all 26 fields.

---

### 1.2 Socket event audit (direct subscriptions/emissions in hook)

Grep of `useTournamentMatchSession` and extracted modules:

```
socket.on / socket.off / socket.emit / activeSocket.emit
```

| Event | Direction | Setup location (after decomposition) | Teardown |
|-------|-----------|--------------------------------------|----------|
| `tournament:completed` | subscribe | `useTournamentSessionSockets.ts` L66–75 | `socket.off` in effect cleanup |
| `tournament:match_completed` | subscribe | `useTournamentSessionSockets.ts` L78–112 | `socket.off` in effect cleanup |
| `room:match_abandoned` | subscribe | `useTournamentSessionSockets.ts` L140–188 | `socket.off` in effect cleanup |
| `room:leave` | emit | `useTournamentSessionNavigation.ts` — `finalizeTournamentMatchSession` L82–84, `exitToTournamentHub` L149–151, `navigateAfterTournamentMatch` L223–225 | fire-and-forget |

**Not used:** `recoveryMachine.ts`, `socketEventBus.ts`, `useRoomSocketSync` projection gates. Tournament session owns its own direct `socket.on/off` for the three events above.

**Attach transport (not raw socket.on):** `emitTournamentAttachAssignedMatch` via `roomTransport.ts` in `useTournamentAttachFlow.ts` (ack/request pattern, unchanged).

---

### 1.3 Terminal bracket logic — what makes a run terminal/complete

Terminal determination uses **`../../tournament/bracketTerminal`** (read-only import), **not** frozen `recoveryMachine.ts` or `socketEventBus.ts`.

**Imports in bracket module consumer (`useTournamentBracketTerminal.ts`):**

```typescript
import {
  deriveBracketTerminalState,
  isTournamentBracketTerminal,
  msUntilBracketAutoKick,
} from '../../../tournament/bracketTerminal';
```

**Terminal kinds** (from `bracketTerminal.ts`): `final_complete`, `tournament_completed`, `tournament_cancelled`, `tournament_expired` — derived from bracket view + `tournamentPhase` + `assignedMatch` + user registration state.

**Two effects implement terminal bracket behavior:**

1. **Terminal guard** (`useTournamentBracketTerminal.ts` L37–91): When `appMode === 'tournament'` and `isTournamentBracketTerminal(terminal)`, if `tournamentSubView === 'bracket'` → `exitToTournamentHub('terminal_guard')`. Also routes hub→bracket when phase is `registered` / `bracket_lobby` / `match_ready` / `in_match`.

2. **Auto-kick timer** (`useTournamentBracketTerminal.ts` L93–149): When on bracket sub-view with terminal state, schedules `exitToTournamentHub('auto_kick')` after `msUntilBracketAutoKick(terminal.completedAtMs)` or immediately when `terminal.shouldAutoKickToHub`.

**Match-level terminal** (separate from bracket terminal) uses `../../tournament/terminalMatches`:

- `isTerminalTournamentMatch`, `markTerminalTournamentMatch`, `markTournamentTerminal`, `readTerminalTournamentMatchIds`, `tournamentSubViewAfterMatchComplete`

---

### 1.4 Idempotency / sequencing-sensitive state map

| Guard | Type | Purpose | Cleared/set by |
|-------|------|---------|----------------|
| `matchFinalizedRef` | `Ref<Set<string>>` | Prevents double `finalizeTournamentMatchSession` per matchId | Set in `finalizeTournamentMatchSession`; checked first line |
| `attachInFlightRef` | `Ref<string \| null>` | One attach at a time; blocks concurrent attach for same/different match | Set at attach start, cleared in `finally` |
| `pendingTournamentAttachMatchIdRef` | `Ref<string \| null>` | Tracks in-flight attach target for guard evaluation | Set before emit, cleared on ack/error/timeout/finalize/exit |
| `attachedTournamentMatchIdRef` | `Ref<string \| null>` | Records successfully attached match; used by `shouldDeferTournamentMatchFinalize` | Set on attach success; cleared on finalize/exit/clearRefs |
| `failedTournamentAttachByMatchIdRef` | `Ref<Record<string, number>>` | Backoff timestamps for failed attaches | Updated on failure; cleared on success |
| `consumedTournamentGameOverMatchIds` | `State<ReadonlySet<string>>` | UI dedup for game-over overlay (persisted seed from `readTerminalTournamentMatchIds`) | `markTournamentGameOverConsumed` on finalize/navigate/metadata |
| `dismissedTournamentIdsRef` | `Ref<Set<string>>` | Suppresses auto-routing for tournaments user explicitly exited | `exitToTournamentHub` adds; `enterTournamentLobby` removes |
| `isTerminalTournamentMatch(matchId)` | localStorage-backed | Cross-session terminal match persistence | `markTerminalTournamentMatch` in finalize, navigate, liveGameOver, attach error |
| `evaluateTournamentAttachGuard` | pure function | Attach skip reasons: no-match, socket-disconnected, already-pending, already-attached, backoff, match-completed | Called at start of `attemptTournamentAttach` |
| `shouldDeferTournamentMatchFinalize` | pure function | Defers socket `tournament:match_completed` while live multiplayer postgame | `useTournamentSessionSockets` handler |
| `preventAutoRejoinRef` | attach runtime ref | Blocks auto-rejoin after terminal join metadata / live game over | Set in `applyTournamentMetadataFromJoin` and liveGameOver effect |

---

## 2. Decomposition design

### 2.1 Responsibility inventory (before)

| Concern | Former LOC region |
|---------|-------------------|
| Types + pure helpers | L31–66 |
| UI/session state | L168–196 |
| Attach refs | L184–203 |
| Navigation (finalize/exit/enter/navigate) | L205–378 |
| Attach flow (metadata + attempt) | L380–709 |
| Socket listeners | L711–845 |
| Live game-over guard | L847–865 |
| Bracket terminal routing | L867–976 |
| Recovery + pending drain | L978–1036 |
| Result fetch + misc effects | L1038–1080 |
| Return assembly | L1082–1109 |

### 2.2 Extracted modules (after)

| File | Responsibility | LOC |
|------|----------------|-----|
| `tournament/tournamentMatchSessionTypes.ts` | `TournamentMatchContext`, API types, `getTournamentStageLabel`, `isTournamentJoinMatchPayload` | 114 |
| `tournament/useTournamentSessionState.ts` | Sub-view, match, result, attach phase, consumed IDs state | 57 |
| `tournament/useTournamentAttachRefs.ts` | Attach/finalize refs + `clearTournamentAttachRefs` | 24 |
| `tournament/useTournamentSessionNavigation.ts` | `finalizeTournamentMatchSession`, `exitToTournamentHub`, `enterTournamentLobby`, `navigateAfterTournamentMatch` | 262 |
| `tournament/useTournamentAttachFlow.ts` | `applyTournamentMetadataFromJoin`, `attemptTournamentAttach`, `attachAssignedTournamentMatch` | 417 |
| `tournament/useTournamentSessionSockets.ts` | 3 socket listeners + `tournament:completed` routing effect | 204 |
| `tournament/useTournamentBracketTerminal.ts` | Terminal guard + auto-kick effects | 149 |
| `tournament/useTournamentSessionLifecycle.ts` | liveGameOver, recovery, pending drain, result fetch, invalid-state fallback | 178 |
| `useTournamentMatchSession.ts` | **Thin orchestrator** — composes hooks, returns same 26-field API | 145 |

**Choice:** Keep `useTournamentMatchSession` as a thin orchestrator (mirrors `useLiveMatchSession` composing `transientUi/`, `input/`, `viewModel/`). Subfolder `match/session/tournament/` holds domain-specific hooks. Re-exports preserve existing import paths:

```typescript
export type { TournamentMatchContext, ... } from './tournament/tournamentMatchSessionTypes';
export { getTournamentStageLabel } from './tournament/tournamentMatchSessionTypes';
```

---

## 3. Equivalence tracing (quoted before/after)

### 3.1 `finalizeTournamentMatchSession` dedup guard

**Before** (`useTournamentMatchSession.ts` L215–218):

```typescript
      if (matchFinalizedRef.current.has(matchId)) {
        console.warn('[tournament] already finalized', matchId);
        return;
      }
      matchFinalizedRef.current.add(matchId);
```

**After** (`useTournamentSessionNavigation.ts` L67–70):

```typescript
      if (matchFinalizedRef.current.has(matchId)) {
        console.warn('[tournament] already finalized', matchId);
        return;
      }
      matchFinalizedRef.current.add(matchId);
```

### 3.2 `tournament:match_completed` deferral + finalize

**Before** (L732–753):

```typescript
      if (isTerminalTournamentMatch(payload.matchId)) return;
      if (
        shouldDeferTournamentMatchFinalize({
          appMode: appModeRef.current,
          attachedMatchId: attachedTournamentMatchIdRef.current,
          payloadMatchId: payload.matchId,
        })
      ) {
        console.log('[tournament:complete] deferring finalize until postgame overlay', {
          matchId: payload.matchId,
        });
        void tournament.openBracket(payload.tournamentId);
        void tournament.refresh();
        return;
      }
      finalizeTournamentMatchSession({
        matchId: payload.matchId,
        tournamentId: payload.tournamentId,
        roomCode: payload.roomCode,
        round: payload.round,
        tournamentCompleted: payload.round === 3,
      });
```

**After** — see §8.1 for full verbatim current source (handler body matches before; `useEffect` dependency array adds `attachedTournamentMatchIdRef`).

### 3.3 Attach in-flight guard

**Before** (L464–472):

```typescript
      if (attachInFlightRef.current === matchId) {
        console.warn('[tournament] attach already in flight for', matchId);
        return false;
      }
      if (attachInFlightRef.current !== null) {
        console.warn('[tournament] attach in flight for different match, skipping', matchId);
        return false;
      }
      attachInFlightRef.current = matchId;
```

**After** — see §8.2 for full verbatim current source.

### 3.4 Bracket terminal auto-kick

**Before** (L927–966):

```typescript
    const scheduleKick = () => {
      const terminal = deriveBracketTerminalState({ bracket, userId: authUserId, ... });
      if (!isTournamentBracketTerminal(terminal)) return null;
      if (terminal.shouldAutoKickToHub) return 0;
      return msUntilBracketAutoKick(terminal.completedAtMs);
    };
    // ... setTimeout + 15s interval → exitToTournamentHub('auto_kick')
```

**After** — see §8.3 for full verbatim current source.

### 3.5 Public return shape (26 fields preserved)

**Before** (L1082–1109) and **after** (`useTournamentMatchSession.ts` L113–145) return the same keys:

`tournamentSubView`, `setTournamentSubView`, `activeTournamentId`, `setActiveTournamentId`, `tournamentMatch`, `setTournamentMatch`, `currentTournamentContext`, `tournamentAttachPhase`, `tournamentAttachError`, `tournamentResult`, `setTournamentResult`, `tournamentResultLoading`, `setTournamentResultLoading`, `tournamentResultError`, `setTournamentResultError`, `pendingTournamentAttachMatchIdRef`, `attachedTournamentMatchIdRef`, `consumedTournamentGameOverMatchIds`, `clearTournamentAttachRefs`, `applyTournamentMetadataFromJoin`, `attemptTournamentAttach`, `attachAssignedTournamentMatch`, `finalizeTournamentMatchSession`, `exitToTournamentHub`, `enterTournamentLobby`, `navigateAfterTournamentMatch`.

Verified by `tournamentMatchSessionTypes.test.ts`:

```
it('TournamentMatchSessionApi preserves all 26 public return fields', () => {
  expect(SESSION_API_KEYS).toHaveLength(26);
});
```

---

## 4. Files changed

| File | Action |
|------|--------|
| `client/src/match/session/useTournamentMatchSession.ts` | Replaced 1,110 LOC with 145 LOC orchestrator |
| `client/src/match/session/tournament/tournamentMatchSessionTypes.ts` | **New** — types + pure helpers |
| `client/src/match/session/tournament/useTournamentSessionState.ts` | **New** |
| `client/src/match/session/tournament/useTournamentAttachRefs.ts` | **New** |
| `client/src/match/session/tournament/useTournamentSessionNavigation.ts` | **New** |
| `client/src/match/session/tournament/useTournamentAttachFlow.ts` | **New** |
| `client/src/match/session/tournament/useTournamentSessionSockets.ts` | **New** |
| `client/src/match/session/tournament/useTournamentBracketTerminal.ts` | **New** |
| `client/src/match/session/tournament/useTournamentSessionLifecycle.ts` | **New** |
| `client/src/match/session/tournament/tournamentMatchSessionTypes.test.ts` | **New** — 3 tests |
| `client/src/appRouteTypes.test.ts` | Minor unused-import cleanup (build fix, non-frozen) |

**Frozen paths touched:** none.

---

## 5. LOC and test counts

| Metric | Before | After |
|--------|--------|-------|
| `useTournamentMatchSession.ts` | 1,110 | 145 |
| `match/session/tournament/**` | 0 | 1,523 (9 source + 1 test file) |
| Test files | 65 | 66 (+1) |
| Tests | 530 | 533 (+3) |

---

## 6. Build and test results

**Build:**

```
npm run build --prefix client
```

Result: **PASS** (`tsc -b && vite build`, exit code 0)

**Full client test suite:**

```
Test Files  66 passed (66)
     Tests  533 passed (533)
  Duration  11.40s
```

Result: **PASS** — 0 regressions.

---

## 7. Remaining risks

1. **No hook-level integration test** for socket effect wiring — coverage is structural (26-field API test) + full suite pass. A future `useTournamentSessionSockets` behavior test with a mock socket could lock subscription teardown.
2. **Orchestrator dependency order** matters: navigation must be constructed before attach flow and sockets (finalize callback dependency). Current order matches original declaration order in the monolith.
3. **Total LOC increased** (1,110 → 1,668 across tournament modules) due to explicit module boundaries and type exports — tradeoff for single-responsibility maintainability.

---

## 8. Follow-up verification gaps (appendix)

### 8.1 §3.2 — Full AFTER source: `tournament:match_completed` deferral + finalize

**File:** `client/src/match/session/tournament/useTournamentSessionSockets.ts` **lines 77–113** (verbatim, 2026-07-05):

```typescript
  useEffect(() => {
    if (!socket) return;
    const onMatchCompleted = (payload: {
      tournamentId?: string;
      matchId?: string;
      roomCode?: string | null;
      round?: number;
    }) => {
      if (!payload?.tournamentId || !payload?.matchId) return;
      if (isTerminalTournamentMatch(payload.matchId)) return;
      if (
        shouldDeferTournamentMatchFinalize({
          appMode: appModeRef.current,
          attachedMatchId: attachedTournamentMatchIdRef.current,
          payloadMatchId: payload.matchId,
        })
      ) {
        console.log('[tournament:complete] deferring finalize until postgame overlay', {
          matchId: payload.matchId,
        });
        void tournament.openBracket(payload.tournamentId);
        void tournament.refresh();
        return;
      }
      finalizeTournamentMatchSession({
        matchId: payload.matchId,
        tournamentId: payload.tournamentId,
        roomCode: payload.roomCode,
        round: payload.round,
        tournamentCompleted: payload.round === 3,
      });
    };
    socket.on('tournament:match_completed', onMatchCompleted);
    return () => {
      socket.off('tournament:match_completed', onMatchCompleted);
    };
  }, [appModeRef, attachedTournamentMatchIdRef, finalizeTournamentMatchSession, socket, tournament]);
```

**BEFORE** (`git show HEAD:client/src/match/session/useTournamentMatchSession.ts` lines 723–759) — handler body is the same; the enclosing `useEffect` dependency array differed:

```typescript
  }, [appModeRef, finalizeTournamentMatchSession, socket, tournament]);
```

The extracted module adds `attachedTournamentMatchIdRef` to the dependency array. The ref object identity is stable across renders, so runtime behavior of the handler is unchanged; this is an exhaustive-deps alignment only.

---

### 8.2 §3.3 — Full AFTER source: attach in-flight guard

**File:** `client/src/match/session/tournament/useTournamentAttachFlow.ts` **lines 151–176** (verbatim, 2026-07-05):

```typescript
  const attemptTournamentAttach = useCallback(
    async (
      matchId: string,
      opts?: { manual?: boolean; tournamentId?: string; matchStatus?: string },
    ): Promise<boolean> => {
      if (attachInFlightRef.current === matchId) {
        console.warn('[tournament] attach already in flight for', matchId);
        return false;
      }
      if (attachInFlightRef.current !== null) {
        console.warn('[tournament] attach in flight for different match, skipping', matchId);
        return false;
      }
      attachInFlightRef.current = matchId;
      try {
        const socketConnected = Boolean(socketRef.current?.connected);
        const guard = evaluateTournamentAttachGuard({
          matchId,
          socketConnected,
          appMode: appModeRef.current,
          pendingMatchId: pendingTournamentAttachMatchIdRef.current,
          attachedMatchId: attachedTournamentMatchIdRef.current,
          failedAtByMatchId: failedTournamentAttachByMatchIdRef.current,
          terminalMatchIds: readTerminalTournamentMatchIds(),
          manual: opts?.manual,
        });
```

**BEFORE** (`git show HEAD:client/src/match/session/useTournamentMatchSession.ts` lines 459–484) — the in-flight guard block (lines 464–472 in the monolith) matches the AFTER lines 156–164 character-for-character. AFTER continues immediately into `evaluateTournamentAttachGuard` as the monolith did; only the enclosing function moved from the god-hook into `useTournamentAttachFlow.ts`.

---

### 8.3 §3.4 — Full AFTER source: bracket terminal auto-kick

**File:** `client/src/match/session/tournament/useTournamentBracketTerminal.ts` **lines 92–149** (verbatim, 2026-07-05):

```typescript
  useEffect(() => {
    if (appMode !== 'tournament' || tournamentSubView !== 'bracket' || !activeTournamentId) return;
    const bracket =
      tournament.activeBracket?.tournament.id === activeTournamentId
        ? tournament.activeBracket
        : null;
    if (!bracket) return;

    const scheduleKick = () => {
      const terminal = deriveBracketTerminalState({
        bracket,
        userId: authUserId,
        tournamentPhase: tournament.tournamentPhase,
        assignedMatch:
          tournament.assignedMatch?.tournamentId === activeTournamentId
            ? tournament.assignedMatch
            : null,
      });
      if (!isTournamentBracketTerminal(terminal)) return null;
      if (terminal.shouldAutoKickToHub) return 0;
      return msUntilBracketAutoKick(terminal.completedAtMs);
    };

    const kick = () => {
      const waitMs = scheduleKick();
      if (waitMs == null) return;
      console.log('[tournament:exit] final completed, routing hub', {
        tournamentId: activeTournamentId,
        waitMs,
      });
      exitToTournamentHub('auto_kick');
    };

    const initialWait = scheduleKick();
    if (initialWait == null) return undefined;
    if (initialWait === 0) {
      kick();
      return undefined;
    }
    const timer = window.setTimeout(kick, initialWait);
    const interval = window.setInterval(() => {
      const waitMs = scheduleKick();
      if (waitMs === 0) kick();
    }, 15_000);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
    };
  }, [
    activeTournamentId,
    appMode,
    authUserId,
    exitToTournamentHub,
    tournament.activeBracket,
    tournament.assignedMatch,
    tournament.tournamentPhase,
    tournamentSubView,
  ]);
```

**BEFORE** (`git show HEAD:client/src/match/session/useTournamentMatchSession.ts` lines 919–976) — effect body and dependency array match the AFTER source above line-for-line (the monolith used the same dependency list).

---

### 8.4 Test/file count reconciliation (AppRoutes task → tournament task)

**AppRoutes prop-grouping task end state** (`docs/phase-approutes-prop-grouping-report.md` §6.2):

```
Test Files  65 passed (65)
     Tests  530 passed (530)
  Duration  12.33s
```

That run included the new `client/src/appRouteTypes.test.ts` (+1 file, +3 tests over the prior 64/527 baseline documented in the same report).

**Pre-tournament-task baseline** — verified 2026-07-05 by running the suite with the tournament test file excluded:

```
cd client && npm test -- --exclude '**/tournamentMatchSessionTypes.test.ts' 2>&1 | tail -8
```

Output:

```
 Test Files  65 passed (65)
      Tests  530 passed (530)
   Start at  14:01:31
   Duration  42.20s
```

**Post-tournament-task full suite** — verified 2026-07-05:

```
cd client && npm test 2>&1 | tail -10
```

Output:

```
 ✓ src/match/session/tournament/tournamentMatchSessionTypes.test.ts (3 tests) 2ms
 ...
 Test Files  66 passed (66)
      Tests  533 passed (533)
   Start at  14:02:50
   Duration  11.40s
```

**Accounting:**

| Milestone | Test files | Tests | Delta from prior |
|-----------|------------|-------|------------------|
| AppRoutes task end | 65 | 530 | +1 file / +3 tests (`appRouteTypes.test.ts`) |
| Tournament task **before** (corrected) | 65 | 530 | — |
| Tournament task **after** | 66 | 533 | +1 file / +3 tests (`tournamentMatchSessionTypes.test.ts`) |

The original §5–§6 of this report incorrectly stated a tournament-task **before** baseline of **66 files / 533 tests**. That figure already included `appRouteTypes.test.ts` and therefore double-counted the AppRoutes-task delta as if it belonged to the tournament task. The corrected tournament-only delta is **+1 file / +3 tests** (530 → 533).

Neither new test file is in `git HEAD` yet (`git status` shows `?? client/src/appRouteTypes.test.ts` and `?? client/src/match/session/tournament/`).

---

### 8.5 `appRouteTypes.test.ts` diff (tournament-task build fix)

`client/src/appRouteTypes.ts` was not modified. The only touch in that vicinity was `client/src/appRouteTypes.test.ts`, which failed `tsc -b` after the tournament decomposition because unused type imports/aliases triggered TS6196. The change removed dead imports and dead `type` aliases inside the third test — **no `expect(...)` assertion changed in meaning**.

**Actual diff** (version as written by the AppRoutes task → version after tournament-task build fix):

```diff
--- a/client/src/appRouteTypes.test.ts
+++ b/client/src/appRouteTypes.test.ts
@@ -1,16 +1,7 @@
 import { describe, expect, it } from 'vitest';
 import type {
-  AppRoutesAuthProps,
-  AppRoutesBotMatchProps,
-  AppRoutesGhostProps,
-  AppRoutesHomeOverlayProps,
   AppRoutesHostRouteBundles,
-  AppRoutesLearnProps,
-  AppRoutesMultiplayerProps,
   AppRoutesNavigationProps,
   AppRoutesProps,
   AppRoutesShellProps,
-  AppRoutesSocialProps,
-  AppRoutesTournamentProps,
 } from './appRouteTypes';
 
@@ -64,14 +55,6 @@ describe('appRouteTypes prop bundles', () => {
   it('flat bundle field counts sum to former 84-prop surface', () => {
     type ShellKeys = keyof AppRoutesShellProps;
     type NavKeys = keyof AppRoutesNavigationProps;
-    type AuthKeys = keyof AppRoutesAuthProps;
-    type LearnKeys = keyof AppRoutesLearnProps;
-    type BotKeys = keyof AppRoutesBotMatchProps;
-    type GhostKeys = keyof AppRoutesGhostProps;
-    type SocialKeys = keyof AppRoutesSocialProps;
-    type HomeKeys = keyof AppRoutesHomeOverlayProps;
-    type MpKeys = keyof AppRoutesMultiplayerProps;
-    type TourKeys = keyof AppRoutesTournamentProps;
 
     const fieldCounts = {
       shell: 5 satisfies number,
```

**Assertions unchanged** (all three `it(...)` blocks retain the same expectations):

1. `expect(APP_ROUTES_BUNDLE_KEYS).toHaveLength(10)` and ordered key list equality
2. `expect(HOST_ROUTE_BUNDLE_KEYS).toHaveLength(9)`
3. `expect(total).toBe(84)` plus compile-time `Record<ShellKeys, unknown>` / `Record<NavKeys, unknown>` smoke objects

The removed `type AuthKeys` … `type TourKeys` aliases were declared but never referenced (they were intended as compile-time guards but triggered strict unused-local errors under `tsc -b`). The `fieldCounts` object and all runtime assertions are identical before and after.