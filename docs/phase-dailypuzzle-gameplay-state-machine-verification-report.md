# Phase: Daily Puzzle Cleanup — Sub-phase 7 Verification/Fix Pass

## Gameplay State Machine Extraction Equivalence Audit

**Date:** 2026-07-05  
**Scope:** Close the investigation gap in `docs/phase-dailypuzzle-gameplay-state-machine-extraction-report.md` where original `onPositionClick` FAILED branches were elided with `// ... FAILED branches`.  
**Outcome:** FAILED-branch **conditions and order match** the pre-extraction original. A **`solvedMoves` regression** on the FAILED path was found and fixed.

---

## Executive summary

| Check | Result |
|-------|--------|
| `evaluateTargetScoreMoveOutcome` FAILED conditions vs original | **Match exactly** (same three conditions, same order) |
| `finalizeResult` `solvedMoves` on FAILED (pre-fix extraction wiring) | **Regression** — passed `nextMoves` instead of `null` |
| Fix applied | `resolveLegacyFinalizeSolvedMoves` restores `null` on FAILED |
| `evaluateOneTurnHighScoreMoveOutcome` | **Equivalent** to original |
| Ladder `completeSlot` / `runFinalize` extraction | **Equivalent** to original |
| Vitest | **56 files / 492 tests** — all pass |
| Behavior tests | **31 files** — all pass |
| Build | **Pass** |

---

## Step 1 — Current `onPositionClick` reach_target code (post sub-phase 7 + verification fix)

Source: `client/src/dailyPuzzle/DailyPuzzleScreen.tsx` (current working tree).

The reach_target path is everything after the `one_turn_high_score` early return. Full `onPositionClick` as it exists today:

```tsx
  const onPositionClick = (position: Move['position']) => {
    if (!runtimeState || !puzzle || !selectedTile || status !== 'IN_PROGRESS') return;

    const move = legalMoves.find(
      (candidate) =>
        candidate.tile &&
        candidate.position === position &&
        tileEquals(candidate.tile, selectedTile),
    );
    if (!move) return;

    const result = applyPlayMove(runtimeState, 'you', move);
    const nextState = result.state;
    const pointsAwarded = result.scored?.points ?? 0;
    const nextMoves = movesUsed + 1;
    const totalScore = nextState.players.you.score;
    const upcomingPlayMoves = getLegalMoves(nextState, 'you').filter(
      (candidate) => candidate.type === 'play',
    );

    setRuntimeState(nextState);
    setSelectedTile(null);
    setMovesUsed(nextMoves);
    flashLastPlayed(move.tile ?? null);

    if (puzzle.puzzleType === 'one_turn_high_score') {
      const outcome = evaluateOneTurnHighScoreMoveOutcome({
        pointsAwarded,
        isDouble: isDominoDouble(move.tile!),
        priorRunningScore: runningScoreRef.current,
        upcomingPlayMovesCount: upcomingPlayMoves.length,
      });
      if (outcome.type === 'terminal') {
        runningScoreRef.current = outcome.runningScore;
        setFinalScore(outcome.runningScore);
        setStatus(outcome.status);
        finalizeResult(outcome.status, nextMoves, outcome.runningScore);
      } else {
        runningScoreRef.current = outcome.runningScore;
      }
      return;
    }

    const targetOutcome = evaluateTargetScoreMoveOutcome({
      totalScore,
      nextMoves,
      targetScore: puzzle.targetScore,
      maxMoves: puzzle.maxMoves,
      currentPlayer: nextState.currentPlayer,
      upcomingPlayMovesCount: upcomingPlayMoves.length,
    });
    if (targetOutcome.type === 'terminal') {
      setStatus(targetOutcome.status);
      finalizeResult(
        targetOutcome.status,
        resolveLegacyFinalizeSolvedMoves(targetOutcome.status, targetOutcome.nextMoves),
        targetOutcome.totalScore,
      );
    }
  };
```

Reach_target-specific wiring is the `evaluateTargetScoreMoveOutcome` call and the terminal `finalizeResult` block (lines 484–498 in file).

---

## Step 2 — Original pre-sub-phase-7 FAILED branch logic (full quote, no placeholders)

Source: `git show HEAD:client/src/dailyPuzzle/DailyPuzzleScreen.tsx` — last committed version before sub-phase 7 working-tree changes. The reach_target block immediately followed the `one_turn_high_score` branch.

Full original reach_target terminal logic (SOLVED + all three FAILED branches):

```tsx
    if (totalScore >= puzzle.targetScore && nextMoves <= puzzle.maxMoves) {
      setStatus('SOLVED');
      finalizeResult('SOLVED', nextMoves, totalScore);
      return;
    }

    if (nextMoves >= puzzle.maxMoves && totalScore < puzzle.targetScore) {
      setStatus('FAILED');
      finalizeResult('FAILED', null, totalScore);
      return;
    }

    if (nextState.currentPlayer !== 'you') {
      setStatus('FAILED');
      finalizeResult('FAILED', null, totalScore);
      return;
    }

    if (upcomingPlayMoves.length === 0) {
      setStatus('FAILED');
      finalizeResult('FAILED', null, totalScore);
      return;
    }
```

Every FAILED branch passes **`null`** as the second argument to `finalizeResult` (`solvedMoves`).

---

## Step 3 — Line-by-line comparison: original FAILED branches vs `evaluateTargetScoreMoveOutcome`

Source: `client/src/dailyPuzzle/dailyPuzzlePlayMoveCompletion.ts`

Full extracted function:

```tsx
export function evaluateTargetScoreMoveOutcome(params: {
  totalScore: number;
  nextMoves: number;
  targetScore: number;
  maxMoves: number;
  currentPlayer: string;
  upcomingPlayMovesCount: number;
}): TargetScoreMoveOutcome {
  if (params.totalScore >= params.targetScore && params.nextMoves <= params.maxMoves) {
    return {
      type: 'terminal',
      status: 'SOLVED',
      totalScore: params.totalScore,
      nextMoves: params.nextMoves,
    };
  }
  if (params.nextMoves >= params.maxMoves && params.totalScore < params.targetScore) {
    return {
      type: 'terminal',
      status: 'FAILED',
      totalScore: params.totalScore,
      nextMoves: params.nextMoves,
    };
  }
  if (params.currentPlayer !== 'you') {
    return {
      type: 'terminal',
      status: 'FAILED',
      totalScore: params.totalScore,
      nextMoves: params.nextMoves,
    };
  }
  if (params.upcomingPlayMovesCount === 0) {
    return {
      type: 'terminal',
      status: 'FAILED',
      totalScore: params.totalScore,
      nextMoves: params.nextMoves,
    };
  }
  return { type: 'continue' };
}
```

### Condition order comparison

| Order | Original (`DailyPuzzleScreen.tsx` pre-extraction) | Extracted (`evaluateTargetScoreMoveOutcome`) | Match? |
|-------|---------------------------------------------------|-----------------------------------------------|--------|
| 1 (SOLVED) | `totalScore >= puzzle.targetScore && nextMoves <= puzzle.maxMoves` | `totalScore >= targetScore && nextMoves <= maxMoves` | **Yes** |
| 2 (FAILED) | `nextMoves >= puzzle.maxMoves && totalScore < puzzle.targetScore` | `nextMoves >= maxMoves && totalScore < targetScore` | **Yes** |
| 3 (FAILED) | `nextState.currentPlayer !== 'you'` | `currentPlayer !== 'you'` | **Yes** |
| 4 (FAILED) | `upcomingPlayMoves.length === 0` | `upcomingPlayMovesCount === 0` | **Yes** |
| Continue | implicit fall-through (no terminal action) | `{ type: 'continue' }` | **Yes** |

**Verdict:** FAILED-branch conditions and their **order match exactly**. First-match-wins semantics are preserved. The sub-phase 7 report's `// ... FAILED branches` placeholder was poor documentation, but the extracted pure function faithfully transcribes the original logic.

---

## Step 4 — `solvedMoves` on the FAILED path today

### Call chain

1. `DailyPuzzleScreen.tsx` terminal reach_target block calls `finalizeResult`.
2. `finalizeResult` is defined in `useDailyPuzzleLegacyGameplay.ts` and forwards `solvedMoves` to `writeLegacyLocalProgress` and `runLegacyBackendSubmission`.

`finalizeResult` signature and forwarding (current):

```tsx
  const finalizeResult = useCallback(
    (nextStatus: PlayStatus, solvedMoves: number | null, finalScoreValue: number) => {
      if (!puzzle) return;

      const resolvedStreak = writeLegacyLocalProgress({
        puzzle,
        isArchiveMode,
        nextStatus,
        solvedMoves,
        currentStreakDays: streakDays,
        onStreakDaysUpdated: setStreakDays,
      });

      if (
        shouldAllowLegacyBackendSubmission({
          isArchiveMode,
          userId: user?.id,
          alreadySubmitted: submittedRef.current,
        })
      ) {
        submittedRef.current = true;
        const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startTimeRef.current) / 1000));
        void runLegacyBackendSubmission({
          puzzle,
          nextStatus,
          finalScoreValue,
          solvedMoves,
          movesUsed,
          elapsedSeconds,
          bestPossibleScore,
          resolvedStreak,
          userId: user!.id,
          username: profile?.username ?? user!.email?.split('@')[0] ?? 'Player',
          requestBestScoreFromWorker,
          refreshLeaderboard,
        });
      } else {
        refreshLegacyLeaderboardAfterResult({
          isArchiveMode,
          puzzleDate: puzzle.puzzleDate,
          refreshLeaderboard,
        });
      }
    },
```

`runLegacyBackendSubmission` uses `solvedMoves` for the best-score upsert:

```tsx
  const bestScorePromise = upsertDailyPuzzleBestScore({
    puzzleDate: params.puzzleDate,
    userId: params.userId,
    username: params.username,
    score: params.finalScoreValue,
    movesUsed: params.solvedMoves ?? params.movesUsed,
    seconds: params.elapsedSeconds,
  }).catch((err) => {
    console.warn('[DailyPuzzle] best score upsert failed', err);
  });
```

`writeLegacyLocalProgress` only updates `bestMoves` when SOLVED:

```tsx
  if (!params.isArchiveMode && params.nextStatus === 'SOLVED' && params.solvedMoves !== null) {
    const nextStreak = recordSolvedStreak(params.puzzle.puzzleDate);
    params.onStreakDaysUpdated(nextStreak);
    resolvedStreak = nextStreak;
    const nextBest =
      progress.bestMoves === null
        ? params.solvedMoves
        : Math.min(progress.bestMoves, params.solvedMoves);
    writeProgress(params.puzzle.puzzleDate, params.puzzle.puzzleType, {
      ...progress,
      bestMoves: nextBest,
      lastResult: params.nextStatus,
    });
  } else if (!params.isArchiveMode) {
    writeProgress(params.puzzle.puzzleDate, params.puzzle.puzzleType, {
      ...progress,
      lastResult: params.nextStatus,
    });
  }
```

### Current call site (after verification fix)

```tsx
    if (targetOutcome.type === 'terminal') {
      setStatus(targetOutcome.status);
      finalizeResult(
        targetOutcome.status,
        resolveLegacyFinalizeSolvedMoves(targetOutcome.status, targetOutcome.nextMoves),
        targetOutcome.totalScore,
      );
    }
```

`resolveLegacyFinalizeSolvedMoves` (current):

```tsx
export function resolveLegacyFinalizeSolvedMoves(
  status: PlayStatus,
  nextMoves: number,
): number | null {
  return status === 'SOLVED' ? nextMoves : null;
}
```

### Verdict on step 4

| Path | Original `solvedMoves` | Pre-fix extraction wiring | Current (fixed) wiring |
|------|------------------------|---------------------------|------------------------|
| SOLVED | `nextMoves` | `targetOutcome.nextMoves` (= `nextMoves`) | `resolveLegacyFinalizeSolvedMoves('SOLVED', nextMoves)` → `nextMoves` |
| FAILED | **`null`** | **`targetOutcome.nextMoves`** (non-null number) — **regression** | `resolveLegacyFinalizeSolvedMoves('FAILED', nextMoves)` → **`null`** |

**Current code passes `null` on FAILED**, matching the original. The pre-fix natural wiring of `finalizeResult(targetOutcome.status, targetOutcome.nextMoves, targetOutcome.totalScore)` was a real regression: it would have sent post-increment `nextMoves` into `upsertDailyPuzzleBestScore` via `solvedMoves ?? movesUsed` instead of falling back to the hook's closure `movesUsed` (pre-increment). Local `bestMoves` was not affected on FAILED (guarded by `nextStatus === 'SOLVED'`), but backend `movesUsed` on the best-score upsert would have differed.

---

## Step 5 — Fix applied (regression found in step 4)

### Before (broken — natural post-extraction wiring without `resolveLegacyFinalizeSolvedMoves`)

This is what sub-phase 7 produced when wiring the terminal outcome shape directly:

```tsx
    const targetOutcome = evaluateTargetScoreMoveOutcome({
      totalScore,
      nextMoves,
      targetScore: puzzle.targetScore,
      maxMoves: puzzle.maxMoves,
      currentPlayer: nextState.currentPlayer,
      upcomingPlayMovesCount: upcomingPlayMoves.length,
    });
    if (targetOutcome.type === 'terminal') {
      setStatus(targetOutcome.status);
      finalizeResult(targetOutcome.status, targetOutcome.nextMoves, targetOutcome.totalScore);
    }
```

### After (fixed — current working tree)

**New helper** in `client/src/dailyPuzzle/dailyPuzzleLegacyResultSubmission.ts`:

```tsx
export function resolveLegacyFinalizeSolvedMoves(
  status: PlayStatus,
  nextMoves: number,
): number | null {
  return status === 'SOLVED' ? nextMoves : null;
}
```

**Updated call site** in `client/src/dailyPuzzle/DailyPuzzleScreen.tsx`:

```tsx
    const targetOutcome = evaluateTargetScoreMoveOutcome({
      totalScore,
      nextMoves,
      targetScore: puzzle.targetScore,
      maxMoves: puzzle.maxMoves,
      currentPlayer: nextState.currentPlayer,
      upcomingPlayMovesCount: upcomingPlayMoves.length,
    });
    if (targetOutcome.type === 'terminal') {
      setStatus(targetOutcome.status);
      finalizeResult(
        targetOutcome.status,
        resolveLegacyFinalizeSolvedMoves(targetOutcome.status, targetOutcome.nextMoves),
        targetOutcome.totalScore,
      );
    }
```

**Test added** in `client/src/dailyPuzzle/dailyPuzzleLegacyResultSubmission.test.ts`:

```tsx
describe('resolveLegacyFinalizeSolvedMoves', () => {
  it('passes nextMoves only for SOLVED (FAILED must be null for legacy finalize)', () => {
    expect(resolveLegacyFinalizeSolvedMoves('SOLVED', 3)).toBe(3);
    expect(resolveLegacyFinalizeSolvedMoves('FAILED', 3)).toBeNull();
  });
});
```

### Files changed in verification pass

| File | Change |
|------|--------|
| `client/src/dailyPuzzle/dailyPuzzleLegacyResultSubmission.ts` | Added `resolveLegacyFinalizeSolvedMoves` |
| `client/src/dailyPuzzle/DailyPuzzleScreen.tsx` | Import + fixed `finalizeResult` second argument on reach_target terminal |
| `client/src/dailyPuzzle/dailyPuzzleLegacyResultSubmission.test.ts` | +1 test |

---

## Step 6 — Equivalence conclusion for `evaluateTargetScoreMoveOutcome`

- **FAILED conditions/order:** Proven equivalent in step 3.
- **`solvedMoves` on FAILED:** Regression existed in naive wiring; **fixed** in step 5.
- **No further changes required** to `evaluateTargetScoreMoveOutcome` itself — the pure function is correct; only the screen wiring needed the `resolveLegacyFinalizeSolvedMoves` guard.

---

## Step 7 — Rest of sub-phase 7 extractions (no-placeholder audit)

### 7a. `evaluateOneTurnHighScoreMoveOutcome`

**Original** (`git show HEAD:client/src/dailyPuzzle/DailyPuzzleScreen.tsx`):

```tsx
    if (puzzle.puzzleType === 'one_turn_high_score') {
      const isDouble = move.tile!.low === move.tile!.high;
      const newRunningScore = runningScoreRef.current + pointsAwarded;

      if ((pointsAwarded === 0 && !isDouble) || upcomingPlayMoves.length === 0) {
        runningScoreRef.current = newRunningScore;
        setFinalScore(newRunningScore);
        setStatus('SOLVED');
        finalizeResult('SOLVED', nextMoves, newRunningScore);
      } else {
        runningScoreRef.current = newRunningScore;
      }
      return;
    }
```

**Extracted function** (`dailyPuzzlePlayMoveCompletion.ts`):

```tsx
export function evaluateOneTurnHighScoreMoveOutcome(params: {
  pointsAwarded: number;
  isDouble: boolean;
  priorRunningScore: number;
  upcomingPlayMovesCount: number;
}): OneTurnHighScoreMoveOutcome {
  const newRunningScore = params.priorRunningScore + params.pointsAwarded;
  if (
    (params.pointsAwarded === 0 && !params.isDouble)
    || params.upcomingPlayMovesCount === 0
  ) {
    return { type: 'terminal', status: 'SOLVED', runningScore: newRunningScore };
  }
  return { type: 'continue', runningScore: newRunningScore };
}
```

**Current screen wiring** still passes `nextMoves` to `finalizeResult` on SOLVED (unchanged from original). Stuck auto-fail effect:

**Original:**

```tsx
  useEffect(() => {
    if (!puzzle || status !== 'IN_PROGRESS' || puzzle.puzzleType !== 'one_turn_high_score') return;
    if (showLobby) return;
    if (legalMoves.length > 0) return;
    setFinalScore(0);
    setStatus('FAILED');
    finalizeResult('FAILED', null, 0);
  }, [puzzle, status, legalMoves.length]);
```

**Current:**

```tsx
  useEffect(() => {
    if (!puzzle || status !== 'IN_PROGRESS' || puzzle.puzzleType !== 'one_turn_high_score') return;
    if (showLobby) return;
    if (!shouldAutoFailOneTurnHighScoreWithNoLegalMoves(legalMoves.length)) return;
    setFinalScore(0);
    setStatus('FAILED');
    finalizeResult('FAILED', null, 0);
  }, [puzzle, status, legalMoves.length]);
```

`shouldAutoFailOneTurnHighScoreWithNoLegalMoves(0)` === `legalMoves.length === 0`. **Equivalent. No fix needed.**

---

### 7b. Ladder `onPositionClick` reach_target extraction

**Original** (`git show HEAD:client/src/dailyPuzzle/DailyPuzzleLadderScreen.tsx`):

```tsx
    if (totalScore >= activeSlot.targetScore && nextMoves <= activeSlot.maxMoves) {
      setFinalScore(totalScore);
      setStatus('SOLVED');
      void completeSlot('SOLVED', totalScore);
      return;
    }

    if (nextMoves >= activeSlot.maxMoves && totalScore < activeSlot.targetScore) {
      setFinalScore(totalScore);
      setStatus('FAILED');
      void completeSlot('FAILED', totalScore);
      return;
    }

    if (nextState.currentPlayer !== 'you') {
      setFinalScore(totalScore);
      setStatus('FAILED');
      void completeSlot('FAILED', totalScore);
      return;
    }

    const upcoming = getLegalMoves(nextState, 'you').filter((candidate) => candidate.type === 'play');
    if (upcoming.length === 0) {
      setFinalScore(totalScore);
      setStatus('FAILED');
      void completeSlot('FAILED', totalScore);
    }
```

**Current** (`DailyPuzzleLadderScreen.tsx`):

```tsx
    const upcoming = getLegalMoves(nextState, 'you').filter((candidate) => candidate.type === 'play');
    const targetOutcome = evaluateTargetScoreMoveOutcome({
      totalScore,
      nextMoves,
      targetScore: activeSlot.targetScore,
      maxMoves: activeSlot.maxMoves,
      currentPlayer: nextState.currentPlayer,
      upcomingPlayMovesCount: upcoming.length,
    });
    if (targetOutcome.type === 'terminal') {
      setFinalScore(targetOutcome.totalScore);
      setStatus(targetOutcome.status);
      void submitLadderSlot(targetOutcome.status, targetOutcome.totalScore, activeSlot);
    }
```

Ladder submission has no `solvedMoves` parameter — `submitLadderSlot(status, totalScore)` only. Condition order matches via shared `evaluateTargetScoreMoveOutcome`. Screen-specific `setFinalScore` on all terminal paths preserved. **No fix needed.**

---

### 7c. Ladder `completeSlot` / `runFinalize` extraction

**Original `completeSlot`** (`git show HEAD:client/src/dailyPuzzle/DailyPuzzleLadderScreen.tsx`):

```tsx
  const completeSlot = useCallback(async (
    nextStatus: PlayStatus,
    rawScoreValue: number,
  ) => {
    if (!activeSlot) return;
    if (playMode === 'practice') {
      setPracticeOverlay({
        slotIndex: activeSlot.slotIndex,
        slotTitle: activeSlot.slotTitle,
        rawScore: rawScoreValue,
        bestPossible: activeSlot.bestPossibleScore,
      });
      return;
    }
    if (!attempt || submitPending) return;
    setSubmitPending(true);
    setHubError(null);
    try {
      const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startTimeRef.current) / 1000));
      const response = await submitDailyPuzzleSlot({
        attemptId: attempt.id,
        puzzleDate: attempt.puzzleDate,
        slotIndex: activeSlot.slotIndex,
        puzzleId: activeSlot.id,
        rawScore: rawScoreValue,
        movesUsed,
        elapsedSeconds,
        submittedLine: moveTraceRef.current,
        clientResult: {
          status: nextStatus,
          slotTitle: activeSlot.slotTitle,
          rawScore: rawScoreValue,
        },
      });
      setAttempt(response.attempt);
      setToday((current) => ({
        ...current,
        attemptStatus: response.attempt.status,
        attempt: response.attempt,
      }));
      if (response.ladderCompleted || response.requiresCompleteCall) {
        setFinalizePending(true);
        try {
          const completeResponse = await completeDailyPuzzleLadder({
            attemptId: response.attempt.id,
            puzzleDate: response.attempt.puzzleDate,
          });
          setAttempt(completeResponse.attempt);
          setToday((current) => ({
            ...current,
            attemptStatus: completeResponse.attempt.status,
            attempt: completeResponse.attempt,
            finalizeReady: false,
          }));
          setFinalOverlay({ response: completeResponse });
          recordSolvedStreak(completeResponse.attempt.puzzleDate);
        } catch (finalizeError) {
          setHubError(
            finalizeError instanceof Error
              ? finalizeError.message
              : 'Run scored. Finalize from the hub to save leaderboard progress.',
          );
        } finally {
          setFinalizePending(false);
        }
      } else {
        setSlotOverlay({ response, rawScore: rawScoreValue });
      }
    } catch (error) {
      setHubError(error instanceof Error ? error.message : 'Unable to submit slot result.');
    } finally {
      setSubmitPending(false);
    }
  }, [activeSlot, attempt, movesUsed, playMode, submitPending]);
```

**Original `runFinalize`:**

```tsx
  const runFinalize = useCallback(async () => {
    if (!attempt || finalizePending) return;
    setFinalizePending(true);
    setHubError(null);
    try {
      const completeResponse = await completeDailyPuzzleLadder({
        attemptId: attempt.id,
        puzzleDate: attempt.puzzleDate,
      });
      setAttempt(completeResponse.attempt);
      setToday((current) => ({
        ...current,
        attemptStatus: completeResponse.attempt.status,
        attempt: completeResponse.attempt,
        finalizeReady: false,
      }));
      setFinalOverlay({ response: completeResponse });
      recordSolvedStreak(completeResponse.attempt.puzzleDate);
    } catch (error) {
      setHubError(
        error instanceof Error ? error.message : 'Unable to finalize ladder run. Try again.',
      );
    } finally {
      setFinalizePending(false);
    }
  }, [attempt, finalizePending]);
```

**Extracted equivalents:**

- `useDailyPuzzleLadderGameplay.ts` — `completeSlot` delegates to `runLadderSlotSubmission`, `ladderSlotRequiresFinalize`, `runLadderFinalizeSubmission`, `mergeTodayAfterAttemptUpdate`, `applyLadderComplete`.
- `dailyPuzzleLadderSlotSubmission.ts` — pure helpers mirror guards and API payload shape.

Guards preserved:
- `shouldShowPracticeOverlay(playMode)` ↔ `playMode === 'practice'`
- `shouldSkipLadderSlotSubmission(submitPending)` ↔ `submitPending` early return
- `ladderSlotRequiresFinalize(response)` ↔ `response.ladderCompleted || response.requiresCompleteCall`
- `ladderFinalizeFailureMessage` ↔ same ternary error string
- `runFinalize` ↔ `runLadderFinalizeSubmission` + `applyLadderComplete`
- Auto-finalize `autoFinalizeTriedRef` effect unchanged in hook

**No behavioral mismatch found. No fix needed.**

---

## Step 8 — Build and test results

### Before verification fix (sub-phase 7 baseline from extraction report)

| Metric | Value |
|--------|-------|
| Vitest files | 56 |
| Vitest tests | 491 |

### After verification fix (this pass)

Command: `npm run test:all --prefix client`

```
 Test Files  56 passed (56)
      Tests  492 passed (492)
```

Behavior tests: `[run-behavior-tests] 31 files passed`

Command: `npm run build --prefix client`

```
✓ built in 5.85s
```

| Metric | Before fix | After fix |
|--------|------------|-----------|
| Vitest test files | 56 | 56 |
| Vitest tests | 491 | **492** (+1) |
| Behavior test files | 31 | 31 |
| Build | Pass | **Pass** |

---

## Frozen scope confirmation

No changes were made to frozen files: `recoveryMachine.ts`, `socketEventBus.ts`, projection-gate functions in `useRoomSocketSync.ts`, `client/src/modules/**`, `client/src/bot/**`, `useResponsiveHandTileSize.ts`, `dailyPuzzleLadderIcons.tsx`, `ladderHelpers.ts`, `dailyPuzzleSlotHelpers.ts`, `useDailyPuzzleValidatorWorker.ts`, `ladderSlotRowViewModel.ts`, `useDailyPuzzleArchiveLeaderboard.ts`, `dailyPuzzleArchiveLeaderboardHelpers.ts`. No ref bridges added.

---

## Report path confirmation

**This file exists at:** `docs/phase-dailypuzzle-gameplay-state-machine-verification-report.md`