# Phase: Daily Fritz Screen Decomposition

Decompose `client/src/dailyFritz/DailyFritzScreen.tsx` into a controller-shaped entry file plus supporting modules, following the Daily Puzzle reference architecture (`client/src/dailyPuzzle/**` — read-only pattern reference, not modified).

---

## Step 0 — Scope check

### BotMatchScreen / `bot/**` / `modules/**` dependency

**Finding: DailyFritzScreen only consumes BotMatchScreen as a lazy-loaded opaque leaf. No Daily-Fritz-specific logic lives inside frozen `bot/**` or `modules/**` trees that this task needed to move or modify.**

Evidence from `DailyFritzScreen.tsx` (before decomposition):

```tsx
const LazyBotMatchScreen = lazy(() => import('../bot/BotMatchScreen'));
```

Embedded render passes props only (`mode="daily-fritz"`, `dailyFritzPackage`, `dailyFritzSetOverlay`, `onDailyFritzGameComplete`, etc.). Daily Fritz orchestration (init, hub, overlays, API record/complete) lived entirely in `dailyFritz/**`.

**Imports from frozen areas (read-only / type-only, not modified):**

| Import path | Usage |
|-------------|-------|
| `../bot/BotMatchScreen` | Lazy-loaded match UI leaf |
| `../bot/botEngine` types | Via `dailyFritz/api.ts` only (`BotDealSize`, `BotHandDeal`) |

**Reverse dependency (frozen code consumes dailyFritz, not vice versa):**

- `modules/daily/dailyFritzContracts.ts` re-exports types from `dailyFritz/api.ts`
- `modules/match/**` imports daily Fritz contracts for hand lifecycle inside BotMatchScreen
- `bot/BotDailyFritzSetOverlay.tsx` imports `DailyFritzFinalResultOverlay` and `DailyFritzSetOverlayViewModel` from `dailyFritz/**`

These are intentional cross-package contracts. This decomposition did not touch any frozen path.

### Call sites and public contract

| Call site | Import | Contract |
|-----------|--------|----------|
| `client/src/AppRoutes.tsx` | `React.lazy(() => import('./dailyFritz/DailyFritzScreen'))` | Default export component |
| Props passed from AppRoutes | `user`, `profile`, `ghostProfile`, `onGhostProfileChange`, `onProfileRefresh`, `onProfilePatch`, `onOpenAuth`, `onOpenAccount`, `onBack`, `onNavigate` | Matches `DailyFritzScreenProps` in `dailyFritzScreenTypes.ts` |

**No changes** to `App.tsx`, `AppRoutes.tsx`, or `DailyFritzScreenProps`. Default export name remains `DailyFritzScreen`.

---

## 1. Responsibility inventory (pre-decomposition, 1,211 LOC)

| Concern | Lines (approx) | Description |
|---------|----------------|-------------|
| Init / retry state machine | 86–266 | `runInit`, `initPhase`, request-id cancellation, slow timer, cache stale clearing |
| Today / hub data | 134–160, 846–958 | `refreshToday`, session cache, hub labels |
| Embedded match lifecycle | 270–279, 406–476, 821–845 | `activeRun`, stable `embeddedMatchKey`, `beginRun` / `continueSet` |
| Game completion pipeline | 289–565 | `buildCompletedGame`, `submitSetCompletion`, `submitCompletedGame`, idempotency refs |
| Overlay orchestration | 94–95, 605–819 | `setOverlay` state + `setOverlayConfig` view-model `useMemo` |
| Countdown tick guard | 125–132 | 1 Hz lobby timer suppressed while embedded match open |
| Hub lobby render | 960–1210 | Large JSX for set overview, game cards, CTA |
| Init loading screen | 848–861 | `DailyFritzLoadingScreen` branch |
| Hero asset | 97–101 | `useDeferredAsset` for play-vs-Fritz hero image |

---

## 2. Decomposition plan (executed)

Mirror Daily Puzzle patterns:

| Daily Puzzle reference | Daily Fritz extraction |
|------------------------|------------------------|
| `useDailyPuzzleLegacyGameplay.ts` / `useDailyPuzzleLadderGameplay.ts` | `useDailyFritzInit.ts`, `useDailyFritzRunController.ts` |
| `dailyPuzzleScreenHelpers.ts` | Existing `dailyFritzScreenHelpers.ts` (unchanged) |
| `ladderSlotRowViewModel.ts` | `dailyFritzHubViewModel.ts`, `buildDailyFritzSetOverlayViewModel.ts` |
| `DailyPuzzleLadderHubView.tsx` | `DailyFritzHubView.tsx` |
| `DailyPuzzleLegacyInPlayView.tsx` | `DailyFritzEmbeddedMatchView.tsx` |
| Thin `DailyPuzzleScreen.tsx` controller | Thin `DailyFritzScreen.tsx` (202 LOC) |

**No ref bridges.** State flows through hook return values and callback props. `activeRunRef` remains inside `useDailyFritzRunController` for game-over callback staleness avoidance (same as before — internal to one hook, not cross-module mutation).

---

## 3. Extracted file map

| File | LOC | Role |
|------|-----|------|
| `DailyFritzScreen.tsx` | **202** (was **1,211**) | Controller: hook wiring, route branches, overlay/hub memoization |
| `useDailyFritzInit.ts` | 200 | Init/retry state machine + today fetch/cache |
| `useDailyFritzRunController.ts` | 405 | Embedded run, game record/complete, overlay state |
| `buildDailyFritzSetOverlayViewModel.ts` | 257 | Pure overlay view-model builder (all overlay kinds) |
| `dailyFritzHubViewModel.ts` | 176 | Pure hub labels + game card state |
| `DailyFritzHubView.tsx` | 308 | Hub lobby presentation |
| `DailyFritzEmbeddedMatchView.tsx` | 83 | Suspense + lazy `BotMatchScreen` embed |
| `buildDailyFritzSetOverlayViewModel.test.ts` | 94 | **New** — 3 tests |
| `dailyFritzHubViewModel.test.ts` | 84 | **New** — 4 tests |

**Unchanged supporting files:** `dailyFritzScreenTypes.ts`, `dailyFritzScreenHelpers.ts`, `DailyFritzLoadingScreen.tsx`, `DailyFritzIcons.tsx`, `api.ts`, `setOverlayViewModel.ts`, `buildFinalOverlayViewModel.ts`, etc.

---

## 4. Thin controller — full current source

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDeferredAsset } from '../ui/useDeferredAsset';
import '../screens/RacehorseHomeArt.css';

import { normalizeSetResult } from './dailyFritzScreenHelpers';
import type { DailyFritzScreenProps } from './dailyFritzScreenTypes';
import { DailyFritzLoadingScreen } from './DailyFritzLoadingScreen';
import { useDailyFritzInit } from './useDailyFritzInit';
import { useDailyFritzRunController } from './useDailyFritzRunController';
import { buildDailyFritzSetOverlayViewModel } from './buildDailyFritzSetOverlayViewModel';
import { buildDailyFritzHubViewModel } from './dailyFritzHubViewModel';
import { DailyFritzHubView } from './DailyFritzHubView';
import { DailyFritzEmbeddedMatchView } from './DailyFritzEmbeddedMatchView';
import './dailyFritz.css';

export default function DailyFritzScreen({
  user,
  profile,
  ghostProfile,
  onGhostProfileChange,
  onProfileRefresh,
  onProfilePatch,
  onOpenAuth,
  onOpenAccount,
  onBack,
  onNavigate,
}: DailyFritzScreenProps) {
  const {
    today,
    initPhase,
    loadError,
    initRetryPending,
    hubError,
    setHubError,
    refreshToday,
    runInit,
    showInitScreen,
  } = useDailyFritzInit({ userId: user?.id });

  const {
    activeRun,
    embeddedMatchKey,
    setOverlay,
    startActionPending,
    dailyFritzPackageForMatch,
    beginRun,
    continueSet,
    closeEmbeddedRun,
    finishEmbeddedRun,
    handleDailyFritzGameComplete,
    clearSetOverlay,
    hasEmbeddedMatch,
  } = useDailyFritzRunController({
    today,
    hubError,
    setHubError,
    refreshToday,
  });

  const [countdownTick, setCountdownTick] = useState(0);

  const loadHeroAsset = useCallback(
    () => import('../assets/dailyFritz/playvsfritzdone.webp'),
    [],
  );
  const heroSrc = useDeferredAsset('daily-fritz-hero', loadHeroAsset);

  // Do not tick the lobby countdown while an embedded match is open. A 1 Hz
  // parent re-render recreates inline props and was resetting Daily Fritz
  // hand-transition timers in BotMatchScreen (advanceHand identity churn).
  useEffect(() => {
    if (activeRun) return;
    const id = window.setInterval(() => setCountdownTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [activeRun]);

  const loadToday = refreshToday;

  const openLeaderboard = useCallback(() => {
    onNavigate?.('leaderboard');
  }, [onNavigate]);

  const openLeaderboardForRunDate = useCallback(() => {
    onNavigate?.('leaderboard');
  }, [onNavigate]);

  const handleSetAction = useCallback(() => {
    const isStarted = today?.attempt_status === 'started';
    if (isStarted) {
      void continueSet();
      return;
    }
    void beginRun();
  }, [beginRun, continueSet, today?.attempt_status]);

  const setOverlayConfig = useMemo(() => {
    if (!setOverlay) return null;
    return buildDailyFritzSetOverlayViewModel(
      setOverlay,
      {
        continueSet: () => {
          void continueSet();
        },
        submitCompletedGame: (game) => {
          void handleDailyFritzGameComplete(game);
        },
        closeEmbeddedRun,
        loadToday: () => {
          void loadToday();
        },
        openLeaderboardForRunDate,
        clearOverlay: clearSetOverlay,
      },
      {
        todayRunDate: today?.run_date,
        todayStreak: today?.streak,
        todayFritzTier: today?.fritz_tier,
        activeRunDate: activeRun?.run_date,
        activeFritzTier: activeRun?.fritz_tier,
        profileGlickoRating: profile?.glicko_rating,
      },
    );
  }, [
    setOverlay,
    continueSet,
    loadToday,
    today,
    activeRun,
    profile?.glicko_rating,
    openLeaderboardForRunDate,
    handleDailyFritzGameComplete,
    closeEmbeddedRun,
    clearSetOverlay,
  ]);

  const todaySetResult = useMemo(
    () => normalizeSetResult(today?.set_result ?? today?.result),
    [today],
  );

  const hubViewModel = useMemo(
    () => buildDailyFritzHubViewModel(today, todaySetResult, countdownTick, startActionPending),
    [today, todaySetResult, countdownTick, startActionPending],
  );

  if (hasEmbeddedMatch && activeRun && embeddedMatchKey) {
    return (
      <DailyFritzEmbeddedMatchView
        embeddedMatchKey={embeddedMatchKey}
        activeRun={activeRun}
        dailyFritzPackageForMatch={dailyFritzPackageForMatch}
        setOverlayConfig={setOverlayConfig}
        userId={user?.id ?? null}
        username={profile?.username ?? null}
        profile={profile}
        ghostProfile={ghostProfile}
        onGhostProfileChange={onGhostProfileChange}
        onProfileRefresh={onProfileRefresh}
        onProfilePatch={onProfilePatch}
        onBack={onBack}
        onEmbeddedBack={() => {
          closeEmbeddedRun();
          void loadToday();
        }}
        onDailyFritzGameComplete={(result) => {
          void handleDailyFritzGameComplete(result);
        }}
        onDailyFritzComplete={() => {
          void finishEmbeddedRun();
        }}
      />
    );
  }

  if (showInitScreen) {
    return (
      <DailyFritzLoadingScreen
        phase={initPhase as Exclude<typeof initPhase, 'ready'>}
        loadError={loadError}
        onBack={onBack}
        onRetry={() => {
          void runInit({ clearStale: true, isRetry: true });
        }}
        retryPending={initRetryPending}
      />
    );
  }

  return (
    <DailyFritzHubView
      hub={hubViewModel}
      heroSrc={heroSrc}
      hubError={hubError}
      startActionPending={startActionPending}
      onBack={onBack}
      onNavigate={onNavigate}
      onOpenAuth={onOpenAuth}
      onOpenAccount={onOpenAccount}
      onSetAction={handleSetAction}
      onOpenLeaderboard={openLeaderboard}
    />
  );
}
```

Other extracted modules live at the paths listed in §3 (full sources in repo).

---

## 5. State-machine / timing equivalence tracing

### 5.1 Init request idempotency (`runInit`)

**BEFORE** (`DailyFritzScreen.tsx` in git `HEAD`, lines 169–248):

```tsx
  const runInit = useCallback(
    async (options?: { clearStale?: boolean; isRetry?: boolean }) => {
      if (!user?.id) return;
      if (initInFlightRef.current) return;

      initInFlightRef.current = true;
      const requestId = ++initRequestIdRef.current;
      const retryAttempt = options?.isRetry ? initRequestIdRef.current : null;

      setInitRetryPending(Boolean(options?.isRetry));
      setLoadError(null);
      setHubError(null);
      setInitPhase((phase) => {
        const next: DailyFritzInitPhase =
          options?.isRetry || phase === 'failed' || phase === 'still-preparing' ? 'retrying' : 'preparing';
        dfInitLog('state', { phase: next });
        return next;
      });

      if (options?.clearStale) {
        clearDailyFritzClientStorage(user.id);
      } else {
        const corruptCache = readTodayCache(cacheKey);
        if (corruptCache === null && cacheKey && typeof window !== 'undefined') {
          try {
            const raw = window.sessionStorage.getItem(cacheKey);
            if (raw) clearDailyFritzClientStorage(user.id);
          } catch {
            /* noop */
          }
        }
      }

      const runDateHint = todayRef.current?.run_date ?? readTodayCache(cacheKey)?.run_date ?? null;
      dfInitLog('start', { date: runDateHint, userId: user.id });
      if (retryAttempt != null) {
        dfInitLog('retry', { attempt: retryAttempt });
      }

      clearInitSlowTimer();
      initSlowTimerRef.current = window.setTimeout(() => {
        if (initRequestIdRef.current !== requestId) return;
        setInitPhase((phase) => {
          if (phase === 'preparing' || phase === 'retrying') {
            dfInitLog('timeout', { ms: DAILY_FRITZ_INIT_SLOW_MS });
            dfInitLog('state', { phase: 'still-preparing' });
            return 'still-preparing';
          }
          return phase;
        });
      }, DAILY_FRITZ_INIT_SLOW_MS);

      try {
        const response = await getTodayDailyFritz({ timeoutMs: DAILY_FRITZ_INIT_TIMEOUT_MS });
        if (initRequestIdRef.current !== requestId) return;

        const cached = readTodayCache(cacheKey);
        if (cached && shouldClearStaleClientState(cached, response)) {
          clearDailyFritzClientStorage(user.id);
        }

        setToday(response);
        persistTodayCache(response);
        setInitPhase('ready');
        dfInitLog('state', { phase: 'ready' });
      } catch {
        if (initRequestIdRef.current !== requestId) return;
        setLoadError('Please try again.');
        setInitPhase('failed');
        dfInitLog('state', { phase: 'failed' });
      } finally {
        if (initRequestIdRef.current === requestId) {
          initInFlightRef.current = false;
          setInitRetryPending(false);
          clearInitSlowTimer();
        }
      }
    },
    [cacheKey, clearInitSlowTimer, persistTodayCache, user?.id],
  );
```

**AFTER** (`useDailyFritzInit.ts`, lines 89–168) — identical logic; only `user?.id` → `userId` param rename:

```tsx
  const runInit = useCallback(
    async (options?: { clearStale?: boolean; isRetry?: boolean }) => {
      if (!userId) return;
      if (initInFlightRef.current) return;

      initInFlightRef.current = true;
      const requestId = ++initRequestIdRef.current;
      const retryAttempt = options?.isRetry ? initRequestIdRef.current : null;

      setInitRetryPending(Boolean(options?.isRetry));
      setLoadError(null);
      setHubError(null);
      setInitPhase((phase) => {
        const next: DailyFritzInitPhase =
          options?.isRetry || phase === 'failed' || phase === 'still-preparing' ? 'retrying' : 'preparing';
        dfInitLog('state', { phase: next });
        return next;
      });

      if (options?.clearStale) {
        clearDailyFritzClientStorage(userId);
      } else {
        const corruptCache = readTodayCache(cacheKey);
        if (corruptCache === null && cacheKey && typeof window !== 'undefined') {
          try {
            const raw = window.sessionStorage.getItem(cacheKey);
            if (raw) clearDailyFritzClientStorage(userId);
          } catch {
            /* noop */
          }
        }
      }

      const runDateHint = todayRef.current?.run_date ?? readTodayCache(cacheKey)?.run_date ?? null;
      dfInitLog('start', { date: runDateHint, userId });
      if (retryAttempt != null) {
        dfInitLog('retry', { attempt: retryAttempt });
      }

      clearInitSlowTimer();
      initSlowTimerRef.current = window.setTimeout(() => {
        if (initRequestIdRef.current !== requestId) return;
        setInitPhase((phase) => {
          if (phase === 'preparing' || phase === 'retrying') {
            dfInitLog('timeout', { ms: DAILY_FRITZ_INIT_SLOW_MS });
            dfInitLog('state', { phase: 'still-preparing' });
            return 'still-preparing';
          }
          return phase;
        });
      }, DAILY_FRITZ_INIT_SLOW_MS);

      try {
        const response = await getTodayDailyFritz({ timeoutMs: DAILY_FRITZ_INIT_TIMEOUT_MS });
        if (initRequestIdRef.current !== requestId) return;

        const cached = readTodayCache(cacheKey);
        if (cached && shouldClearStaleClientState(cached, response)) {
          clearDailyFritzClientStorage(userId);
        }

        setToday(response);
        persistTodayCache(response);
        setInitPhase('ready');
        dfInitLog('state', { phase: 'ready' });
      } catch {
        if (initRequestIdRef.current !== requestId) return;
        setLoadError('Please try again.');
        setInitPhase('failed');
        dfInitLog('state', { phase: 'failed' });
      } finally {
        if (initRequestIdRef.current === requestId) {
          initInFlightRef.current = false;
          setInitRetryPending(false);
          clearInitSlowTimer();
        }
      }
    },
    [cacheKey, clearInitSlowTimer, persistTodayCache, userId],
  );
```

**Equivalence proof:** Same refs (`initRequestIdRef`, `initInFlightRef`, `initSlowTimerRef`), same early-return guards, same `requestId` stale-response cancellation at await boundaries, same `finally` ownership release. Dependency array unchanged except `user?.id` → `userId`.

---

### 5.2 Stable embedded match key (BotMatchScreen remount guard)

**BEFORE** (lines 275–279):

```tsx
  const openEmbeddedRun = useCallback((normalized: DailyFritzStartResponse) => {
    const gameSlot = normalized.current_game_number ?? 1;
    setEmbeddedMatchKey(`${normalized.attempt_id}:${gameSlot}`);
    setActiveRun(normalized);
  }, []);
```

**AFTER** (`useDailyFritzRunController.ts`, lines 76–80):

```tsx
  const openEmbeddedRun = useCallback((normalized: DailyFritzStartResponse) => {
    const gameSlot = normalized.current_game_number ?? 1;
    setEmbeddedMatchKey(`${normalized.attempt_id}:${gameSlot}`);
    setActiveRun(normalized);
  }, []);
```

Key is set **once per open**, not re-derived when `set_result` updates mid-set. Drift warning `useEffect` preserved verbatim in `useDailyFritzRunController.ts` (lines 358–369).

---

### 5.3 Record-game in-flight guard

**BEFORE** (lines 478–560, excerpt):

```tsx
  const submitCompletedGame = useCallback(async (game: DailyFritzGameCompletionPayload) => {
    const run = activeRunRef.current;
    if (!run) return;
    const priorSet = normalizeSetResult(run.set_result);
    if (priorSet?.setWinner) return;
    if (recordGameInFlightRef.current) return;
    recordGameInFlightRef.current = true;
    const gameNumber = getNextGameNumberFromSetResult(priorSet);
    const fallbackCompletedGame = buildCompletedGame(run, game, gameNumber);
    setHubError(null);
    setSetOverlay({
      kind: 'saving',
      completedGame: fallbackCompletedGame,
      message: `Saving Game ${gameNumber}…`,
    });

    try {
      const recorded = await recordDailyFritzGame({
        attemptId: run.attempt_id,
        verifiedMatchId: run.verified_match_id,
        runDate: run.run_date,
        gameNumber,
        playerScore: game.yourScore,
        fritzScore: game.botScore,
        movesUsed: game.movesUsed,
        handsPlayed: game.handsPlayed,
      });

      const setResult = normalizeSetResult(recorded.set_result) ?? recorded.set_result;
      const completedGame =
        setResult.games.find((entry) => entry.gameNumber === gameNumber) ?? fallbackCompletedGame;

      if (setResult.setWinner) {
        setActiveRun((current) =>
          current
            ? {
                ...current,
                set_result: setResult,
              }
            : current,
        );
        await submitSetCompletion({
          run,
          setResult,
          completedGame,
          currentHandIndex: game.currentHandIndex,
          boardContext: true,
        });
        return;
      }

      const nextGameNumber = recorded.next_game_number;
      if (nextGameNumber != null) {
        setSetOverlay({
          kind: 'between',
          completedGame,
          setResult,
          nextGameNumber: normalizeGameNumber(nextGameNumber, 2),
        });
        return;
      }
      if (!setResult.setWinner) {
        setSetOverlay({
          kind: 'record-error',
          completedGame,
          message: 'Game saved, but the next match could not be determined.',
          error: 'The server did not return a next game number. You can try saving again.',
          game,
        });
        return;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save Daily Fritz set progress.';
      setSetOverlay({
        kind: 'record-error',
        completedGame: fallbackCompletedGame,
        message: `Game ${gameNumber} is finished, but the result has not been saved yet.`,
        error: message,
        game,
      });
    } finally {
      recordGameInFlightRef.current = false;
    }
  }, [buildCompletedGame, submitSetCompletion]);
```

**AFTER** (`useDailyFritzRunController.ts`, lines 248–340): **byte-identical** control flow and guards; `setHubError` added to dependency array (setter is stable; no behavior change).

---

### 5.4 Complete-set idempotency (`completedAttemptIdRef`)

**BEFORE** (lines 325–327):

```tsx
    if (completedAttemptIdRef.current === run.attempt_id) {
      return;
    }
```

**AFTER** (`useDailyFritzRunController.ts`, lines 113–115):

```tsx
    if (completedAttemptIdRef.current === run.attempt_id) {
      return;
    }
```

Set after successful `completeDailyFritz` in both versions at the same point.

---

### 5.5 Lobby countdown suppression (BotMatch hand-timer churn fix)

**BEFORE** (lines 125–132):

```tsx
  useEffect(() => {
    if (activeRun) return;
    const id = window.setInterval(() => setCountdownTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [activeRun]);
```

**AFTER** (`DailyFritzScreen.tsx`, lines 68–75):

```tsx
  useEffect(() => {
    if (activeRun) return;
    const id = window.setInterval(() => setCountdownTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [activeRun]);
```

Remains in the controller (not hub view) so embedded-match branch does not mount the interval. `countdownTick` still drives `buildDailyFritzHubViewModel` memo invalidation only on hub branch.

---

### 5.6 Overlay view-model `useMemo` dependency array

**BEFORE** (line 819):

```tsx
  }, [setOverlay, continueSet, loadToday, today, activeRun, profile?.glicko_rating, openLeaderboardForRunDate, submitCompletedGame, closeEmbeddedRun]);
```

**AFTER** (`DailyFritzScreen.tsx`, lines 123–134):

```tsx
  }, [
    setOverlay,
    continueSet,
    loadToday,
    today,
    activeRun,
    profile?.glicko_rating,
    openLeaderboardForRunDate,
    handleDailyFritzGameComplete,
    closeEmbeddedRun,
    clearSetOverlay,
  ]);
```

`submitCompletedGame` → `handleDailyFritzGameComplete` (thin wrapper calling the same function). `clearSetOverlay` replaces inline `setSetOverlay(null)` closures inside the extracted builder. Same invalidation triggers.

---

## 6. Frozen paths — confirmation

**Not modified:**

- `client/src/dailyPuzzle/**`
- `client/src/bot/**`, `client/src/modules/**`
- `client/src/match/session/**`
- `client/src/multiplayer/**` (including recoveryMachine, socketEventBus, shellDelegates)
- `client/src/App.tsx`
- All listed server frozen paths

---

## 7. Tests added

### `dailyFritzHubViewModel.test.ts` (4 tests)

- Game 1 active when no games played
- Game 2 active after player wins game 1
- Play CTA when attempt not started
- Resume CTA when attempt started

### `buildDailyFritzSetOverlayViewModel.test.ts` (3 tests)

- Saving overlay disabled wait state
- Between overlay next-game label + tracker length
- Record-error retry wires `submitCompletedGame`

Existing `dailyFritzScreenHelpers.test.ts` and `skunk.test.ts` unchanged and still pass.

---

## 8. Verification results

| Metric | Before | After |
|--------|--------|-------|
| `DailyFritzScreen.tsx` LOC | **1,211** | **202** |
| Client test files | 61 | **63** (+2) |
| Client tests | 513 | **520** (+7) |
| Client build | PASS | **PASS** (5.62s) |

```
Test Files  63 passed (63)
Tests       520 passed (520)
✓ built in 5.62s
```

---

## 9. Behavior preservation statement

- Default export `DailyFritzScreen` with unchanged `DailyFritzScreenProps`
- Same three render branches: embedded match → init loading → hub lobby
- Same lazy `BotMatchScreen` props and `embeddedMatchKey` stability contract
- Same API call sequence for init, start, record-game, complete-set
- Same overlay kinds and CTA wiring (extracted to `buildDailyFritzSetOverlayViewModel`)
- Same hub game-card progression logic (extracted to `dailyFritzHubViewModel`)
- No ref-bridge pattern introduced

---

## 10. Files changed summary

| File | Action |
|------|--------|
| `client/src/dailyFritz/DailyFritzScreen.tsx` | Rewritten — thin controller (202 LOC) |
| `client/src/dailyFritz/useDailyFritzInit.ts` | **Created** |
| `client/src/dailyFritz/useDailyFritzRunController.ts` | **Created** |
| `client/src/dailyFritz/buildDailyFritzSetOverlayViewModel.ts` | **Created** |
| `client/src/dailyFritz/dailyFritzHubViewModel.ts` | **Created** |
| `client/src/dailyFritz/DailyFritzHubView.tsx` | **Created** |
| `client/src/dailyFritz/DailyFritzEmbeddedMatchView.tsx` | **Created** |
| `client/src/dailyFritz/buildDailyFritzSetOverlayViewModel.test.ts` | **Created** |
| `client/src/dailyFritz/dailyFritzHubViewModel.test.ts` | **Created** |
| `docs/phase-dailyfritz-screen-decomposition-report.md` | **Created** — this report |

---

## 11. Follow-up verification — game completion, pass-through wrapper, render branches

Closes gaps in §5.3 (unquoted AFTER `submitCompletedGame`), unshown `handleDailyFritzGameComplete` / `hasEmbeddedMatch` sources, and missing BEFORE render-branch comparison.

### 11.1 Full current `submitCompletedGame` (`useDailyFritzRunController.ts`, lines 269–352)

```tsx
  const submitCompletedGame = useCallback(async (game: DailyFritzGameCompletionPayload) => {
    const run = activeRunRef.current;
    if (!run) return;
    const priorSet = normalizeSetResult(run.set_result);
    if (priorSet?.setWinner) return;
    if (recordGameInFlightRef.current) return;
    recordGameInFlightRef.current = true;
    const gameNumber = getNextGameNumberFromSetResult(priorSet);
    const fallbackCompletedGame = buildCompletedGame(run, game, gameNumber);
    setHubError(null);
    setSetOverlay({
      kind: 'saving',
      completedGame: fallbackCompletedGame,
      message: `Saving Game ${gameNumber}…`,
    });

    try {
      const recorded = await recordDailyFritzGame({
        attemptId: run.attempt_id,
        verifiedMatchId: run.verified_match_id,
        runDate: run.run_date,
        gameNumber,
        playerScore: game.yourScore,
        fritzScore: game.botScore,
        movesUsed: game.movesUsed,
        handsPlayed: game.handsPlayed,
      });

      const setResult = normalizeSetResult(recorded.set_result) ?? recorded.set_result;
      const completedGame =
        setResult.games.find((entry) => entry.gameNumber === gameNumber) ?? fallbackCompletedGame;

      if (setResult.setWinner) {
        setActiveRun((current) =>
          current
            ? {
                ...current,
                set_result: setResult,
              }
            : current,
        );
        await submitSetCompletion({
          run,
          setResult,
          completedGame,
          currentHandIndex: game.currentHandIndex,
          boardContext: true,
        });
        return;
      }

      const nextGameNumber = recorded.next_game_number;
      if (nextGameNumber != null) {
        setSetOverlay({
          kind: 'between',
          completedGame,
          setResult,
          nextGameNumber: normalizeGameNumber(nextGameNumber, 2),
        });
        return;
      }
      if (!setResult.setWinner) {
        setSetOverlay({
          kind: 'record-error',
          completedGame,
          message: 'Game saved, but the next match could not be determined.',
          error: 'The server did not return a next game number. You can try saving again.',
          game,
        });
        return;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save Daily Fritz set progress.';
      setSetOverlay({
        kind: 'record-error',
        completedGame: fallbackCompletedGame,
        message: `Game ${gameNumber} is finished, but the result has not been saved yet.`,
        error: message,
        game,
      });
    } finally {
      recordGameInFlightRef.current = false;
    }
  }, [buildCompletedGame, setHubError, submitSetCompletion]);
```

**Correction to §5.3:** The function body matches git `HEAD` `DailyFritzScreen.tsx` lines 478–560 line-for-line. The only delta is the `useCallback` dependency array: BEFORE ended with `[buildCompletedGame, submitSetCompletion]`; AFTER adds `setHubError` because the hook receives `setHubError` from `useDailyFritzInit` rather than closing over component-local `setHubError` — the `setHubError(null)` call at line 278 is the same statement that existed in the monolith.

### 11.2 `handleDailyFritzGameComplete` — full source and pass-through proof

**AFTER** (`useDailyFritzRunController.ts`, lines 354–356):

```tsx
  const handleDailyFritzGameComplete = useCallback(async (game: DailyFritzGameCompletionPayload) => {
    await submitCompletedGame(game);
  }, [submitCompletedGame]);
```

**BEFORE** (git `HEAD`, `DailyFritzScreen.tsx`, lines 563–565):

```tsx
  const handleDailyFritzGameComplete = useCallback(async (game: DailyFritzGameCompletionPayload) => {
    await submitCompletedGame(game);
  }, [submitCompletedGame]);
```

`handleDailyFritzGameComplete` is a pure pass-through to `submitCompletedGame`: its body is a single `await submitCompletedGame(game)` with no additional guard, no alternate error handling, and no separate dedup key — all idempotency (`recordGameInFlightRef`, `priorSet?.setWinner` early return, `completedAttemptIdRef` inside `submitSetCompletion`) remains inside `submitCompletedGame` / `submitSetCompletion` exactly as before.

### 11.3 Render branch conditions — BEFORE vs AFTER

**BEFORE** (git `HEAD`, `DailyFritzScreen.tsx`, embedded-match branch):

```tsx
  if (activeRun && embeddedMatchKey) {
    return (
      <Suspense fallback={<DailyFritzLoadingScreen phase="preparing" loadError={null} onBack={onBack} onRetry={() => {}} retryPending={false} />}>
        <LazyBotMatchScreen
          key={embeddedMatchKey}
          matchInstanceKey={embeddedMatchKey}
          onBack={() => { closeEmbeddedRun(); void loadToday(); }}
          mode="daily-fritz"
          userId={user?.id ?? null}
          username={profile?.username ?? null}
          dealSize={activeRun.deal_size}
          fritzTier={activeRun.fritz_tier}
          winningScore={activeRun.winning_score}
          currentGlickoRating={profile?.glicko_rating ?? null}
          ghostProfile={ghostProfile}
          onGhostProfileChange={onGhostProfileChange}
          onProfileRefresh={onProfileRefresh}
          onProfilePatch={onProfilePatch}
          dailyFritzPackage={dailyFritzPackageForMatch}
          dailyFritzSetOverlay={setOverlayConfig}
          onDailyFritzGameComplete={(result) => { void handleDailyFritzGameComplete(result); }}
          onDailyFritzComplete={() => { void finishEmbeddedRun(); }}
        />
      </Suspense>
    );
  }

  const showInitScreen = Boolean(user?.id) && initPhase !== 'ready';

  if (showInitScreen) {
```

**AFTER** — `hasEmbeddedMatch` derivation (`useDailyFritzRunController.ts`, line 390):

```tsx
  const hasEmbeddedMatch = Boolean(activeRun && embeddedMatchKey);
```

**AFTER** — controller branch (`DailyFritzScreen.tsx`, line 146):

```tsx
  if (hasEmbeddedMatch && activeRun && embeddedMatchKey) {
```

**Logical equivalence:** `hasEmbeddedMatch` is defined as `Boolean(activeRun && embeddedMatchKey)`. Therefore:

- If `activeRun` and `embeddedMatchKey` are both truthy, `hasEmbeddedMatch` is necessarily `true` (it cannot be `false` in that case).
- If either `activeRun` or `embeddedMatchKey` is falsy (`null` / `undefined`), `hasEmbeddedMatch` is `false`, and the three-part condition fails for the same reason the original two-part condition would fail.

`hasEmbeddedMatch` cannot be `false` while `activeRun` and `embeddedMatchKey` are both truthy — the third conjunct adds no new exclusion beyond the original `activeRun && embeddedMatchKey` check. Behavior is unchanged; the extra `hasEmbeddedMatch &&` is redundant but equivalent.