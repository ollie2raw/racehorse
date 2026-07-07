# Phase: Daily Puzzle Cleanup Sub-phase 7 — Gameplay State Machine Extraction

## Sub-phase 6 verification report path confirmation

**Does `docs/phase-dailypuzzle-archive-leaderboard-verification-report.md` exist on disk?** **YES**

---

## Summary

| Item | Result |
|------|--------|
| `DailyPuzzleScreen.tsx` LOC | **1235 → 1173** (−62) |
| `DailyPuzzleLadderScreen.tsx` LOC | **1192 → 1093** (−99) |
| Shared pure module | `dailyPuzzlePlayMoveCompletion.ts` |
| Legacy submission | `dailyPuzzleLegacyResultSubmission.ts` + `useDailyPuzzleLegacyGameplay.ts` |
| Ladder submission | `dailyPuzzleLadderSlotSubmission.ts` + `useDailyPuzzleLadderGameplay.ts` |
| Test files / tests | **53 / 469** → **56 / 491** (+3 files, +22 tests) |
| Build | **Pass** |
| Behavior change | **None intended** — guards and async shapes preserved |

---

## 1. Current LOC (pre-extraction)

| File | LOC |
|------|-----|
| `DailyPuzzleScreen.tsx` | **1235** |
| `DailyPuzzleLadderScreen.tsx` | **1192** |

---

## 2. Investigation — `DailyPuzzleScreen.tsx`

### (a) In-progress score/moves/completion status

**State:**
```tsx
  const [status, setStatus] = useState<PlayStatus>('IN_PROGRESS');
  const [movesUsed, setMovesUsed] = useState(0);
  const [finalScore, setFinalScore] = useState<number | null>(null);
  const runningScoreRef = useRef(0);
  const startTimeRef = useRef<number>(0);
```

**Refs (submission guard):**
```tsx
  const submittedRef = useRef(false);
```

**Validator stale guard (frozen hook — not moved):**
```tsx
  const currentPuzzleDateRef = useRef<string | null>(null);
  // puzzle effect: if (!cancelled && currentPuzzleDateRef.current === activePuzzleDate) setValidation/setBestPossibleScore
```

### (b) Completion detection — `onPositionClick` + stuck effect (pre-extraction, representative)

```tsx
  const onPositionClick = (position: Move['position']) => {
    // ... applyPlayMove ...
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
    if (totalScore >= puzzle.targetScore && nextMoves <= puzzle.maxMoves) {
      setStatus('SOLVED');
      finalizeResult('SOLVED', nextMoves, totalScore);
      return;
    }
    // ... FAILED branches → finalizeResult('FAILED', null, totalScore)
  };

  useEffect(() => {
    if (!puzzle || status !== 'IN_PROGRESS' || puzzle.puzzleType !== 'one_turn_high_score') return;
    if (showLobby) return;
    if (legalMoves.length > 0) return;
    setFinalScore(0);
    setStatus('FAILED');
    finalizeResult('FAILED', null, 0);
  }, [puzzle, status, legalMoves.length]);
```

### (c) Submission — `finalizeResult` (full pre-extraction)

```tsx
  const finalizeResult = (
    nextStatus: PlayStatus,
    solvedMoves: number | null,
    finalScoreValue: number,
  ) => {
    if (!puzzle) return;
    const progress = readProgress(puzzle.puzzleDate, puzzle.puzzleType);
    let resolvedStreak = streakDays;
    if (!isArchiveMode && nextStatus === 'SOLVED' && solvedMoves !== null) {
      const nextStreak = recordSolvedStreak(puzzle.puzzleDate);
      setStreakDays(nextStreak);
      resolvedStreak = nextStreak;
      const nextBest =
        progress.bestMoves === null ? solvedMoves : Math.min(progress.bestMoves, solvedMoves);
      writeProgress(puzzle.puzzleDate, puzzle.puzzleType, {
        ...progress,
        bestMoves: nextBest,
        lastResult: nextStatus,
      });
    } else if (!isArchiveMode) {
      writeProgress(puzzle.puzzleDate, puzzle.puzzleType, { ...progress, lastResult: nextStatus });
    }
    if (!isArchiveMode && user && !submittedRef.current) {
      submittedRef.current = true;
      const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startTimeRef.current) / 1000));
      const bestScorePromise = upsertDailyPuzzleBestScore({ ... }).catch((err) => {
        console.warn('[DailyPuzzle] best score upsert failed', err);
      });
      const completionPromise =
        nextStatus === 'SOLVED'
          ? (async () => {
              const resolvedBestPossibleScore =
                bestPossibleScore > 0
                  ? bestPossibleScore
                  : await requestBestScoreFromWorker(puzzle);
              await upsertDailyPuzzleCompletion({ ... });
            })().catch((err) => {
              console.warn('[DailyPuzzle] completion upsert failed', err);
            })
          : Promise.resolve();
      void Promise.allSettled([bestScorePromise, completionPromise]).finally(() => {
        void refreshLeaderboard(puzzle.puzzleDate);
      });
    } else {
      if (!isArchiveMode) {
        void refreshLeaderboard(puzzle.puzzleDate);
      }
    }
  };
```

**`resetAttempt` guard reset:**
```tsx
    submittedRef.current = false;
```

### (d) Idempotency / sequencing guards (legacy screen)

| Guard | Mechanism | Behavior |
|-------|-----------|----------|
| Duplicate backend submit | `submittedRef` set `true` before async upserts | Second `finalizeResult` skips upsert branch; may still refresh leaderboard via else path |
| Archive mode | `isArchiveMode` | No upserts; local progress skipped for archive |
| Guest | `user` null | No upserts |
| Validator stale | `currentPuzzleDateRef` + `cancelled` in puzzle effect | Ignores worker responses for wrong puzzle date |
| Best score on FAILED | **Preserved as-is** | `upsertDailyPuzzleBestScore` runs for FAILED too (not only SOLVED) |
| Async shape | `void runLegacyBackendSubmission(...)` inside sync `finalizeResult` | Fire-and-forget; same as pre-extraction `void Promise.allSettled` |

### Frozen hook call sites (unchanged)

- `requestValidationFromWorker` / `requestBestScoreFromWorker` — puzzle-load validation effect only (not in finalize path wiring changed)
- `finalizeResult` → `requestBestScoreFromWorker` when `bestPossibleScore <= 0` on SOLVED completion upsert — preserved in `runLegacyBackendSubmission`
- `refreshLeaderboard` from `useDailyPuzzleArchiveLeaderboard` — preserved in submission module

---

## 3. Investigation — `DailyPuzzleLadderScreen.tsx`

### (a) In-progress state

```tsx
  const [status, setStatus] = useState<PlayStatus>('IN_PROGRESS');
  const [movesUsed, setMovesUsed] = useState(0);
  const [finalScore, setFinalScore] = useState<number | null>(null);
  const runningScoreRef = useRef(0);
  const moveTraceRef = useRef<Array<Record<string, unknown>>>([]);
  const startTimeRef = useRef(0);
  const [submitPending, setSubmitPending] = useState(false);
  const [finalizePending, setFinalizePending] = useState(false);
```

### (b) Completion — `onPositionClick` + stuck effect (pre-extraction shape)

Same branching as legacy for puzzle types, but:
- Appends to `moveTraceRef` on each move
- Calls `void completeSlot(status, score)` instead of `finalizeResult`
- **Sets `setFinalScore` on reach_target terminal paths** (legacy screen does not set finalScore on reach_target SOLVED)

Stuck effect (no `showLobby` guard — ladder-only difference):
```tsx
  useEffect(() => {
    if (!activeSlot || activeSlot.puzzleType !== 'one_turn_high_score' || status !== 'IN_PROGRESS') return;
    if (runtimeState == null) return;
    if (legalMoves.length > 0) return;
    setFinalScore(0);
    setStatus('FAILED');
    void completeSlot('FAILED', 0);
  }, [...]);
```

### (c) Submission — `completeSlot` + `runFinalize` (pre-extraction)

`completeSlot`: practice overlay short-circuit → `submitPending` guard → `submitDailyPuzzleSlot` → update attempt → optional `completeDailyPuzzleLadder` with nested try/catch/finally on `finalizePending`.

`runFinalize`: hub auto-finalize when `finalizeReady` (3 slots scored, attempt still `started`).

`autoFinalizeTriedRef` + effect: one-shot auto finalize.

`handleStartScored`: may call `runFinalize` if already `finalizeReady` — **not extracted** (attempt-start hub flow).

### (d) Idempotency guards (ladder)

| Guard | Mechanism |
|-------|-----------|
| Duplicate slot submit | `submitPending` — early return in `completeSlot` |
| Practice mode | No API submit; practice overlay only |
| Auto-finalize once | `autoFinalizeTriedRef` |
| Finalize while pending | `finalizePending` check in `runFinalize` |
| Slot submit then finalize fail | Submit attempt kept; `ladderFinalizeFailureMessage` hub hint — **preserved** |

### Frozen hooks

Ladder scoring does **not** call validator or archive/leaderboard hooks directly.

---

## 4. Side-by-side comparison

| Aspect | Legacy screen | Ladder screen |
|--------|---------------|---------------|
| Per-move completion rules | Same one_turn + reach_target logic | Same rules |
| Submission API | `upsertDailyPuzzleBestScore` + `upsertDailyPuzzleCompletion` | `submitDailyPuzzleSlot` + `completeDailyPuzzleLadder` |
| Idempotency | `submittedRef` (per puzzle attempt) | `submitPending` (per in-flight API call) |
| Move trace | None | `moveTraceRef` sent to server |
| Practice | N/A (archive mode only) | `playMode === 'practice'` bypass |
| Multi-slot | Single puzzle | 3-slot attempt + finalize |
| `setFinalScore` on reach_target SOLVED | **No** | **Yes** |
| Stuck effect `showLobby` guard | **Yes** | **No** |

**Conclusion:** Per-move completion detection is the **same shape**. Submission/finalization is **genuinely different** (local upserts vs ladder attempt APIs).

---

## 5. Grep — consumers

| Symbol | Consumers |
|--------|-----------|
| `finalizeResult` / legacy submission | **Only** `DailyPuzzleScreen.tsx` |
| `completeSlot` / ladder slot submission | **Only** `DailyPuzzleLadderScreen.tsx` |
| `upsertDailyPuzzleBestScore` (daily puzzle screen path) | `DailyPuzzleScreen` module + `modules/daily-puzzle/useDailyPuzzleLeaderboardSync` (bot path — out of scope) |
| `submitDailyPuzzleSlot` | Ladder module + `api.ts` |
| `PlayStatus` | `dailyPuzzleScreenTypes.ts` (canonical) + ladder local duplicate type (unchanged) |

---

## 6. Decision point — shared vs separate (before extraction)

### Decision: **Hybrid — one shared pure completion module + two separate submission stacks**

**Shared:** `dailyPuzzlePlayMoveCompletion.ts` — move-outcome evaluation used by both screens' `onPositionClick` and stuck effects.

**Separate:**
- `dailyPuzzleLegacyResultSubmission.ts` + `useDailyPuzzleLegacyGameplay.ts` — legacy upsert/progress/`submittedRef`
- `dailyPuzzleLadderSlotSubmission.ts` + `useDailyPuzzleLadderGameplay.ts` — slot submit, ladder finalize, `submitPending`, auto-finalize effect

**Why not one shared hook:** Ladder requires attempt/slot APIs, move trace, practice bypass, and hub finalize orchestration. Legacy requires local storage progress, dual upserts, archive gating, and worker-sourced `bestPossibleScore`. Forcing one abstraction would need mode flags and ref bridges.

**What stays screen-specific:** `onPositionClick` UI state updates (`setRuntimeState`, `setMovesUsed`, ladder `moveTraceRef`), `handleStartScored`, confetti, completion summary UI, `resetAttempt`.

---

## 7. Extraction — screen wiring after

### `DailyPuzzleScreen.tsx`

```tsx
  const { resetSubmissionGuard, finalizeResult } = useDailyPuzzleLegacyGameplay({
    puzzle,
    isArchiveMode,
    user,
    profile,
    movesUsed,
    bestPossibleScore,
    streakDays,
    setStreakDays,
    startTimeRef,
    requestBestScoreFromWorker,
    refreshLeaderboard,
  });
```

`onPositionClick` uses `evaluateOneTurnHighScoreMoveOutcome` / `evaluateTargetScoreMoveOutcome` then calls `finalizeResult` unchanged in semantics.

### `DailyPuzzleLadderScreen.tsx`

```tsx
  const { submitPending, runFinalize, completeSlot: submitLadderSlot } = useDailyPuzzleLadderGameplay({
    attempt,
    finalizeReady,
    finalizePending,
    playMode,
    movesUsed,
    startTimeRef,
    moveTraceRef,
    setAttempt,
    setToday,
    setHubError,
    setFinalizePending,
    setSlotOverlay,
    setFinalOverlay,
    setPracticeOverlay,
    finalOverlay,
  });
```

`void submitLadderSlot(status, score, activeSlot)` at terminal move outcomes.

---

## 8. Preserved as-is, looks odd, did not change

1. **Legacy upserts best score on FAILED** — not only SOLVED (`runLegacyBackendSubmission` always calls `upsertDailyPuzzleBestScore`).
2. **Legacy reach_target SOLVED does not call `setFinalScore`**; ladder does — screen-specific UI updates kept in each screen.
3. **Legacy stuck effect checks `showLobby`**; ladder stuck effect does not.
4. **`finalizeResult` remains synchronous entry** firing `void runLegacyBackendSubmission` (fire-and-forget).
5. **`completeSlot` call sites remain `void submitLadderSlot(...)`** (fire-and-forget).
6. **Two `console.warn` upsert handlers** unchanged per sub-phase 6 verification.
7. **`submitPending` early return uses `if (!attempt || shouldSkipLadderSlotSubmission(submitPending)) return`** — when pending, skips without queueing retry (same as before).

---

## 9. New modules — full source

### `dailyPuzzlePlayMoveCompletion.ts`

```typescript
import type { PlayStatus } from './dailyPuzzleScreenTypes';

export type OneTurnHighScoreMoveOutcome =
  | { type: 'continue'; runningScore: number }
  | { type: 'terminal'; status: Extract<PlayStatus, 'SOLVED'>; runningScore: number };

export function isDominoDouble(tile: { low: number; high: number }): boolean {
  return tile.low === tile.high;
}

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

export type TargetScoreMoveOutcome =
  | { type: 'continue' }
  | {
      type: 'terminal';
      status: Extract<PlayStatus, 'SOLVED' | 'FAILED'>;
      totalScore: number;
      nextMoves: number;
    };

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

export function shouldAutoFailOneTurnHighScoreWithNoLegalMoves(legalMovesCount: number): boolean {
  return legalMovesCount === 0;
}
```

### `dailyPuzzleLegacyResultSubmission.ts`

See `client/src/dailyPuzzle/dailyPuzzleLegacyResultSubmission.ts` (117 LOC) — exports `shouldAllowLegacyBackendSubmission`, `writeLegacyLocalProgress`, `resolveLegacyBestPossibleScore`, `runLegacyBackendSubmission`, `refreshLegacyLeaderboardAfterResult`. Async `.catch` + `void Promise.allSettled(...).finally(() => { void refreshLeaderboard(...) })` preserved verbatim.

### `useDailyPuzzleLegacyGameplay.ts`

See `client/src/dailyPuzzle/useDailyPuzzleLegacyGameplay.ts` (109 LOC) — owns `submittedRef`, exposes `finalizeResult` + `resetSubmissionGuard`.

### `dailyPuzzleLadderSlotSubmission.ts`

See `client/src/dailyPuzzle/dailyPuzzleLadderSlotSubmission.ts` (82 LOC) — `runLadderSlotSubmission` (submit only), `runLadderFinalizeSubmission`, guards, `mergeTodayAfterAttemptUpdate`.

### `useDailyPuzzleLadderGameplay.ts`

See `client/src/dailyPuzzle/useDailyPuzzleLadderGameplay.ts` (181 LOC) — `completeSlot` two-step submit→finalize preserved; `runFinalize`; auto-finalize effect with `autoFinalizeTriedRef`.

---

## 10. New test files

| File | Tests |
|------|-------|
| `dailyPuzzlePlayMoveCompletion.test.ts` | 10 |
| `dailyPuzzleLegacyResultSubmission.test.ts` | 6 |
| `dailyPuzzleLadderSlotSubmission.test.ts` | 6 |

**Hook/async orchestration:** Not unit-tested (Supabase/API + React state). Pure decision functions tested; build pass + preserved async shapes documented (same precedent as sub-phases 3/6).

---

## 11. Files touched

| File | Change |
|------|--------|
| `DailyPuzzleScreen.tsx` | `finalizeResult` → hook; move completion → shared pure functions |
| `DailyPuzzleLadderScreen.tsx` | `completeSlot`/`runFinalize`/auto-finalize → hook; move completion → shared pure functions |
| `dailyPuzzlePlayMoveCompletion.ts` | **New** shared pure completion |
| `dailyPuzzleLegacyResultSubmission.ts` | **New** legacy upsert orchestration |
| `useDailyPuzzleLegacyGameplay.ts` | **New** legacy hook |
| `dailyPuzzleLadderSlotSubmission.ts` | **New** ladder API helpers |
| `useDailyPuzzleLadderGameplay.ts` | **New** ladder hook |
| `dailyPuzzlePlayMoveCompletion.test.ts` | **New** |
| `dailyPuzzleLegacyResultSubmission.test.ts` | **New** |
| `dailyPuzzleLadderSlotSubmission.test.ts` | **New** |
| `docs/phase-dailypuzzle-gameplay-state-machine-extraction-report.md` | This report |

**Frozen modules not modified.**

---

## 12. Verification

```
Before: 53 test files / 469 tests
After:  56 test files / 491 tests
Build:  Pass (npm run build --prefix client)
```