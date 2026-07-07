# Phase: Daily Puzzle Cleanup Sub-phase 5 — Ladder Slot Row/Breakdown View-Model Extraction

## Sub-phase 4 report path confirmation

**Does `docs/phase-dailypuzzle-debug-logging-cleanup-report.md` exist on disk?** **YES**

---

## Goal

Extract pure derived view-model logic for ladder slot rows and score/points breakdown from `DailyPuzzleLadderScreen.tsx` into a dedicated module. Preserve `useMemo` dependency arrays at call sites. Zero behavior change.

## Summary

| Item | Result |
|------|--------|
| New module | `client/src/dailyPuzzle/ladderSlotRowViewModel.ts` (86 LOC) |
| New tests | `client/src/dailyPuzzle/ladderSlotRowViewModel.test.ts` (175 LOC, 9 tests) |
| `DailyPuzzleLadderScreen.tsx` LOC | **1220 → 1192** (−28) |
| Behavior change | **None** |
| Test files / tests | **51 / 450** → **52 / 459** (+1 file, +9 tests) |
| Build | **Pass** |

---

## Current LOC (pre-extraction, post sub-phase 2)

**1220 LOC**

---

## Investigation — derivations found

Three pure rendering derivations were identified in `DailyPuzzleLadderScreen.tsx`. All were inline inside `useMemo`. No local helper functions existed for these. `getLadderPuzzleCardState` is **not** part of the derivation — it runs at JSX render time on each row (unchanged).

### Supporting values (not extracted — inputs only)

```tsx
  const completedSlots = attempt?.result.slots ?? [];
  const nextSlotIndex = attempt?.status === 'completed' ? null : (attempt?.currentSlotIndex ?? 1);
```

```tsx
  const hubSlots = today.attemptSlots ?? today.slots;
```

### Derivation 1: `currentSlotBreakdown` — score breakdown chips for final overlay

**useMemo dependency array:** `[completedSlots]`

**Before (full source):**

```tsx
  const currentSlotBreakdown = useMemo(() => {
    return [1, 2, 3].map((slotIndex) => {
      const result = completedSlots.find((entry) => entry.slotIndex === slotIndex);
      const step = getDailyPuzzleStepPresentation(slotIndex);
      return {
        slotIndex,
        label: step.shortLabel,
        value: result ? `${result.awardedPoints}` : '—',
      };
    });
  }, [completedSlots]);
```

**After:**

```tsx
  const currentSlotBreakdown = useMemo(
    () => buildLadderSlotBreakdown(completedSlots),
    [completedSlots],
  );
```

**Classification:** Pure breakdown derivation — **extracted** as `buildLadderSlotBreakdown`.

---

### Derivation 2: `ladderSlotRows` — per-slot hub progress row view-models

**useMemo dependency array:** `[attempt?.status, completedSlots, hubSlots, nextSlotIndex]`

**Before (full source):**

```tsx
  const ladderSlotRows = useMemo(() => {
    return [1, 2, 3].map((slotIndex) => {
      const slot = hubSlots.find((s) => s.slotIndex === slotIndex);
      const slotResult = completedSlots.find((e) => e.slotIndex === slotIndex);
      const isCompleteRun = attempt?.status === 'completed';
      const isAvailable = !isCompleteRun && nextSlotIndex === slotIndex;
      const isLocked = !isCompleteRun && nextSlotIndex != null && nextSlotIndex < slotIndex;
      const rowVariant = slotResult ? 'done' : isAvailable ? 'active' : 'muted';
      const step = getDailyPuzzleStepPresentation(slotIndex);

      let statusSub: string;
      let unlockHint: string | null = null;
      if (slotResult) {
        statusSub = `Completed · ${slotResult.awardedPoints} pts`;
      } else if (isAvailable) {
        statusSub = 'Available now';
      } else if (isLocked) {
        statusSub = 'Locked';
        unlockHint = slotIndex === 2 ? 'Complete puzzle 1 to unlock' : 'Complete puzzle 2 to unlock';
      } else {
        statusSub = 'Up next';
      }

      return {
        slotIndex,
        slot,
        slotResult,
        step,
        rowVariant,
        statusSub,
        unlockHint,
        isLocked,
        isAvailable,
      };
    });
  }, [attempt?.status, completedSlots, hubSlots, nextSlotIndex]);
```

**After:**

```tsx
  const ladderSlotRows = useMemo(
    () =>
      buildLadderSlotRows({
        hubSlots,
        completedSlots,
        attemptStatus: attempt?.status,
        nextSlotIndex,
      }),
    [attempt?.status, completedSlots, hubSlots, nextSlotIndex],
  );
```

**Classification:** Pure slot-row view-model — **extracted** as `buildLadderSlotRows`. Card state label (`active`/`locked`/`done`/`idle`) still derived at render via `getLadderPuzzleCardState(row)` in JSX (unchanged).

---

### Derivation 3: `ladderTotalPoints` — total available points for hub overview/summary

**useMemo dependency array:** `[today.slots]`

**Before (full source):**

```tsx
  const ladderTotalPoints = useMemo(
    () => today.slots.reduce((sum, slot) => sum + (slot.slotMaxPoints ?? 0), 0),
    [today.slots],
  );
```

**After:**

```tsx
  const ladderTotalPoints = useMemo(
    () => computeLadderTotalPoints(today.slots),
    [today.slots],
  );
```

**Classification:** Pure points aggregate — **extracted** as `computeLadderTotalPoints`.

---

### Not in scope (other useMemos in file)

| useMemo | Purpose | Why not extracted |
|---------|---------|-------------------|
| `finalizeReady` | Attempt completion gate for finalize button | Gameplay/state machine |
| `legalMoves` | In-play move list | Gameplay |
| `streakDisplay` | Streak storage read | Not slot row/breakdown |
| `profileRating` | Profile field normalize | Share text input |
| `hubLadderShareText` / `finalLadderShareText` | Share card text | Share flow, not hub row rendering |

---

## Grep — consumer confirmation (`client/src/`)

| Symbol / derivation | Consumers |
|---------------------|-----------|
| `buildLadderSlotBreakdown` | **Only** `DailyPuzzleLadderScreen.tsx` (after extraction) |
| `buildLadderSlotRows` | **Only** `DailyPuzzleLadderScreen.tsx` |
| `computeLadderTotalPoints` | **Only** `DailyPuzzleLadderScreen.tsx` |
| `currentSlotBreakdown` (inline, pre) | **Only** `DailyPuzzleLadderScreen.tsx` |
| `ladderSlotRows` (inline, pre) | **Only** `DailyPuzzleLadderScreen.tsx` |
| `ladderTotalPoints` (inline, pre) | **Only** `DailyPuzzleLadderScreen.tsx` |
| `getLadderPuzzleCardState` | `DailyPuzzleLadderScreen.tsx` (JSX), `ladderHelpers.test.ts` |
| `toCuratedPuzzle` | `DailyPuzzleLadderScreen.tsx` (`launchSlot`), `dailyPuzzleSlotHelpers.test.ts` — **not used in row derivations** |
| `getDailyPuzzleStepPresentation` | Now imported only by `ladderSlotRowViewModel.ts` for row/breakdown; still used in `presentation.ts`, `ladderShareCard.ts`, `DailyPuzzleLoadingScreen.tsx` |

**Conclusion:** All three derivations had a single call site: `DailyPuzzleLadderScreen.tsx`.

---

## Dependency analysis

| Function | Inputs | External deps | Impure? |
|----------|--------|---------------|---------|
| `buildLadderSlotBreakdown` | `completedSlots: DailyPuzzleSlotResult[]` | `getDailyPuzzleStepPresentation` (pure) | **No** |
| `buildLadderSlotRows` | `hubSlots`, `completedSlots`, `attemptStatus`, `nextSlotIndex` | `getDailyPuzzleStepPresentation` (pure) | **No** |
| `computeLadderTotalPoints` | `slots: DailyPuzzleSlot[]` | None | **No** |

- **Does not call** `getLadderPuzzleCardState` internally — same as before (card state at JSX).
- **Does not call** `toCuratedPuzzle` — not part of row/breakdown derivation.
- **No** `Date.now()`, `Math.random()`, context, or hooks inside extracted functions.
- Component-local state feeds inputs only via existing `useMemo` wrappers with **unchanged** dependency arrays.

---

## New module — full source

`client/src/dailyPuzzle/ladderSlotRowViewModel.ts`:

```typescript
import {
  getDailyPuzzleStepPresentation,
  type DailyPuzzleStepPresentation,
} from './presentation';
import type { DailyPuzzleSlot, DailyPuzzleSlotResult } from './types';

export type LadderSlotBreakdownChip = {
  slotIndex: number;
  label: string;
  value: string;
};

export type LadderSlotRowVariant = 'done' | 'active' | 'muted';

export type LadderSlotRowViewModel = {
  slotIndex: number;
  slot: DailyPuzzleSlot | undefined;
  slotResult: DailyPuzzleSlotResult | undefined;
  step: DailyPuzzleStepPresentation;
  rowVariant: LadderSlotRowVariant;
  statusSub: string;
  unlockHint: string | null;
  isLocked: boolean;
  isAvailable: boolean;
};

export function buildLadderSlotBreakdown(
  completedSlots: DailyPuzzleSlotResult[],
): LadderSlotBreakdownChip[] {
  return [1, 2, 3].map((slotIndex) => {
    const result = completedSlots.find((entry) => entry.slotIndex === slotIndex);
    const step = getDailyPuzzleStepPresentation(slotIndex);
    return {
      slotIndex,
      label: step.shortLabel,
      value: result ? `${result.awardedPoints}` : '—',
    };
  });
}

export function buildLadderSlotRows(params: {
  hubSlots: DailyPuzzleSlot[];
  completedSlots: DailyPuzzleSlotResult[];
  attemptStatus: 'started' | 'completed' | undefined;
  nextSlotIndex: 1 | 2 | 3 | null;
}): LadderSlotRowViewModel[] {
  const { hubSlots, completedSlots, attemptStatus, nextSlotIndex } = params;
  return [1, 2, 3].map((slotIndex) => {
    const slot = hubSlots.find((s) => s.slotIndex === slotIndex);
    const slotResult = completedSlots.find((e) => e.slotIndex === slotIndex);
    const isCompleteRun = attemptStatus === 'completed';
    const isAvailable = !isCompleteRun && nextSlotIndex === slotIndex;
    const isLocked = !isCompleteRun && nextSlotIndex != null && nextSlotIndex < slotIndex;
    const rowVariant = slotResult ? 'done' : isAvailable ? 'active' : 'muted';
    const step = getDailyPuzzleStepPresentation(slotIndex);

    let statusSub: string;
    let unlockHint: string | null = null;
    if (slotResult) {
      statusSub = `Completed · ${slotResult.awardedPoints} pts`;
    } else if (isAvailable) {
      statusSub = 'Available now';
    } else if (isLocked) {
      statusSub = 'Locked';
      unlockHint = slotIndex === 2 ? 'Complete puzzle 1 to unlock' : 'Complete puzzle 2 to unlock';
    } else {
      statusSub = 'Up next';
    }

    return {
      slotIndex,
      slot,
      slotResult,
      step,
      rowVariant,
      statusSub,
      unlockHint,
      isLocked,
      isAvailable,
    };
  });
}

export function computeLadderTotalPoints(slots: DailyPuzzleSlot[]): number {
  return slots.reduce((sum, slot) => sum + (slot.slotMaxPoints ?? 0), 0);
}
```

**Module name:** `ladderSlotRowViewModel.ts` — matches suggested name; covers both slot rows and breakdown chips in one pure view-model module.

---

## New test file — full source

`client/src/dailyPuzzle/ladderSlotRowViewModel.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { getLadderPuzzleCardState } from './ladderHelpers';
import {
  buildLadderSlotBreakdown,
  buildLadderSlotRows,
  computeLadderTotalPoints,
} from './ladderSlotRowViewModel';
import type { DailyPuzzleSlot, DailyPuzzleSlotResult } from './types';

function makeSlot(overrides: Partial<DailyPuzzleSlot> = {}): DailyPuzzleSlot {
  return {
    id: 'slot-1',
    puzzleDate: '2024-06-01',
    slotIndex: 1,
    slotTitle: 'Quick Line',
    tier: 'quick_line',
    puzzleType: 'reach_target',
    maxMoves: 3,
    targetScore: 30,
    dealSize: 7,
    slotMaxPoints: 10,
    bestPossibleScore: 30,
    startingBoard: { mainLine: [], leftEnd: 0, rightEnd: 0, leftEndIsDouble: false, rightEndIsDouble: false, hubDoubles: [] },
    startingHand: [{ low: 1, high: 2 }],
    objectiveType: 'reach_target',
    objectivePayload: {},
    ...overrides,
  };
}

function makeSlotResult(overrides: Partial<DailyPuzzleSlotResult> = {}): DailyPuzzleSlotResult {
  return {
    id: 'result-1',
    attemptId: 'attempt-1',
    puzzleId: 'slot-1',
    puzzleDate: '2024-06-01',
    userId: 'user-1',
    slotIndex: 1,
    tier: 'quick_line',
    slotTitle: 'Quick Line',
    puzzleType: 'reach_target',
    rawScore: 25,
    awardedPoints: 8,
    bestPossibleScore: 10,
    slotMaxPoints: 10,
    solved: true,
    perfect: false,
    movesUsed: 2,
    elapsedSeconds: 45,
    completedAt: '2024-06-01T12:00:00Z',
    submittedLine: [],
    result: {},
    ...overrides,
  };
}

describe('buildLadderSlotBreakdown', () => {
  it('returns three chips with dashes when no results exist', () => {
    const chips = buildLadderSlotBreakdown([]);
    expect(chips).toHaveLength(3);
    expect(chips.map((c) => c.value)).toEqual(['—', '—', '—']);
    expect(chips.map((c) => c.label)).toEqual(['P1', 'P2', 'P3']);
  });

  it('fills awarded points for completed slots', () => {
    const chips = buildLadderSlotBreakdown([
      makeSlotResult({ slotIndex: 1, awardedPoints: 7 }),
      makeSlotResult({ slotIndex: 3, awardedPoints: 12 }),
    ]);
    expect(chips[0]).toMatchObject({ slotIndex: 1, label: 'P1', value: '7' });
    expect(chips[1]).toMatchObject({ slotIndex: 2, value: '—' });
    expect(chips[2]).toMatchObject({ slotIndex: 3, value: '12' });
  });
});

describe('buildLadderSlotRows', () => {
  const hubSlots = [
    makeSlot({ id: 's1', slotIndex: 1, slotMaxPoints: 10 }),
    makeSlot({ id: 's2', slotIndex: 2, slotMaxPoints: 15 }),
    makeSlot({ id: 's3', slotIndex: 3, slotMaxPoints: 20 }),
  ];

  it('marks slot 1 active when attempt started on first slot', () => {
    const rows = buildLadderSlotRows({
      hubSlots,
      completedSlots: [],
      attemptStatus: 'started',
      nextSlotIndex: 1,
    });
    expect(rows).toHaveLength(3);
    expect(getLadderPuzzleCardState(rows[0])).toBe('active');
    expect(rows[0]).toMatchObject({
      rowVariant: 'active',
      statusSub: 'Available now',
      isAvailable: true,
      isLocked: false,
    });
    expect(getLadderPuzzleCardState(rows[1])).toBe('locked');
    expect(rows[1]).toMatchObject({
      rowVariant: 'muted',
      statusSub: 'Locked',
      unlockHint: 'Complete puzzle 1 to unlock',
      isLocked: true,
    });
    expect(getLadderPuzzleCardState(rows[2])).toBe('locked');
    expect(rows[2].unlockHint).toBe('Complete puzzle 2 to unlock');
  });

  it('marks slot 2 active when next slot is 2', () => {
    const rows = buildLadderSlotRows({
      hubSlots,
      completedSlots: [makeSlotResult({ slotIndex: 1, awardedPoints: 9 })],
      attemptStatus: 'started',
      nextSlotIndex: 2,
    });
    expect(getLadderPuzzleCardState(rows[0])).toBe('done');
    expect(rows[0]).toMatchObject({
      rowVariant: 'done',
      statusSub: 'Completed · 9 pts',
    });
    expect(getLadderPuzzleCardState(rows[1])).toBe('active');
    expect(getLadderPuzzleCardState(rows[2])).toBe('locked');
  });

  it('returns idle rows when run is completed with no per-slot results', () => {
    const rows = buildLadderSlotRows({
      hubSlots,
      completedSlots: [],
      attemptStatus: 'completed',
      nextSlotIndex: null,
    });
    expect(rows.every((row) => getLadderPuzzleCardState(row) === 'idle')).toBe(true);
    expect(rows.every((row) => row.statusSub === 'Up next')).toBe(true);
  });

  it('handles empty hub slots without throwing', () => {
    const rows = buildLadderSlotRows({
      hubSlots: [],
      completedSlots: [],
      attemptStatus: undefined,
      nextSlotIndex: 1,
    });
    expect(rows).toHaveLength(3);
    expect(rows[0].slot).toBeUndefined();
    expect(getLadderPuzzleCardState(rows[0])).toBe('active');
  });

  it('preserves slot ordering 1, 2, 3', () => {
    const rows = buildLadderSlotRows({
      hubSlots: [hubSlots[2], hubSlots[0], hubSlots[1]],
      completedSlots: [],
      attemptStatus: 'started',
      nextSlotIndex: 1,
    });
    expect(rows.map((r) => r.slotIndex)).toEqual([1, 2, 3]);
    expect(rows[0].step.title).toBe('Puzzle 1');
    expect(rows[2].step.title).toBe('Puzzle 3');
  });
});

describe('computeLadderTotalPoints', () => {
  it('sums slotMaxPoints across slots', () => {
    expect(
      computeLadderTotalPoints([
        makeSlot({ slotMaxPoints: 10 }),
        makeSlot({ slotMaxPoints: 15 }),
        makeSlot({ slotMaxPoints: 20 }),
      ]),
    ).toBe(45);
  });

  it('returns 0 for an empty slot list', () => {
    expect(computeLadderTotalPoints([])).toBe(0);
  });
});
```

Tests use `getLadderPuzzleCardState` from `ladderHelpers.ts` to assert `active` / `locked` / `done` / `idle` without duplicating card-state logic.

---

## `DailyPuzzleLadderScreen.tsx` import change

**Before:**

```tsx
import { getDailyPuzzleDisplayTitle, getDailyPuzzleStepPresentation } from './presentation';
```

**After:**

```tsx
import { getDailyPuzzleDisplayTitle } from './presentation';
import {
  buildLadderSlotBreakdown,
  buildLadderSlotRows,
  computeLadderTotalPoints,
} from './ladderSlotRowViewModel';
```

---

## Files touched

| File | Change |
|------|--------|
| `client/src/dailyPuzzle/DailyPuzzleLadderScreen.tsx` | **Only** inline `useMemo` derivations replaced with module calls; import added; `getDailyPuzzleStepPresentation` import removed. No gameplay, submission, JSX structure, or other logic changed. |
| `client/src/dailyPuzzle/ladderSlotRowViewModel.ts` | **New** pure view-model module |
| `client/src/dailyPuzzle/ladderSlotRowViewModel.test.ts` | **New** unit tests (9) |
| `docs/phase-dailypuzzle-ladder-slot-viewmodel-report.md` | This report |

**Frozen files untouched:** `ladderHelpers.ts`, `dailyPuzzleSlotHelpers.ts`, `useResponsiveHandTileSize.ts`, `useDailyPuzzleValidatorWorker.ts`, `DailyPuzzleScreen.tsx`, etc.

---

## Verification

### Tests

```
Before: 51 test files / 450 tests
After:  52 test files / 459 tests
```

Command: `npm test -- --run` (client) — all passed.

### Build

Command: `npm run build --prefix client` — **Pass** (`✓ built in ~5.3s`).

---

## Remaining risks

None identified. `useMemo` dependency arrays are identical. Card-state CSS class mapping remains in JSX via `getLadderPuzzleCardState(row)` as before.