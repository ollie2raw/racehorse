# Phase: Daily Puzzle Cleanup Sub-phase 2 — Ladder Icons & Pure Helpers Extraction

## Goal

Extract 8 icon components and 3 pure helper functions from `DailyPuzzleLadderScreen.tsx` into colocated modules. Zero behavior change. Touch **only** imports and removed inline definitions in the ladder screen.

## Summary

| Item | Result |
|------|--------|
| New icons module | `client/src/dailyPuzzle/dailyPuzzleLadderIcons.tsx` (60 LOC) |
| New ladder helpers | `client/src/dailyPuzzle/ladderHelpers.ts` (21 LOC) |
| New slot helper | `client/src/dailyPuzzle/dailyPuzzleSlotHelpers.ts` (24 LOC) |
| New tests | `ladderHelpers.test.ts` (6 tests), `dailyPuzzleSlotHelpers.test.ts` (2 tests) |
| `DailyPuzzleLadderScreen.tsx` | 1318 → **1220** LOC (−98) |
| Behavior change | **None** |

---

## Grep proof — consumers per symbol (`client/src/`)

**Command:**

```bash
rg 'LadderIconSameBoard|LadderIconOrdered|LadderIconLeaderboard|DplIconCalendar|DplIconFlame|DplIconLock|DplIconTrophy|DplIconLayers|formatDateLabel|getLadderPuzzleCardState|toCuratedPuzzle' client/src
```

| Symbol | Consumers |
|--------|-----------|
| `LadderIconSameBoard` | **Only** `DailyPuzzleLadderScreen.tsx` (JSX usage) |
| `LadderIconOrdered` | **Only** `DailyPuzzleLadderScreen.tsx` |
| `LadderIconLeaderboard` | **Only** `DailyPuzzleLadderScreen.tsx` |
| `DplIconCalendar` | **Only** `DailyPuzzleLadderScreen.tsx` |
| `DplIconFlame` | **Only** `DailyPuzzleLadderScreen.tsx` |
| `DplIconLock` | **Only** `DailyPuzzleLadderScreen.tsx` |
| `DplIconTrophy` | **Only** `DailyPuzzleLadderScreen.tsx` |
| `DplIconLayers` | **Only** `DailyPuzzleLadderScreen.tsx` |
| `getLadderPuzzleCardState` | **Only** `DailyPuzzleLadderScreen.tsx` |
| `toCuratedPuzzle` | **Only** `DailyPuzzleLadderScreen.tsx` |
| `formatDateLabel` | **Multiple unrelated private copies** — see note below |

### `formatDateLabel` — name collision note

The **extracted** function is the **local private** `formatDateLabel` that lived in `DailyPuzzleLadderScreen.tsx`. Other files define **separate, unexported** homonyms (not imports of this symbol):

| File | Relationship |
|------|--------------|
| `dailyPuzzle/ladderShareCard.ts` | Private duplicate (unchanged) |
| `dailyPuzzle/DailyPuzzleLadderLeaderboardScreen.tsx` | Private duplicate (unchanged) |
| `dailyFritz/DailyFritzLeaderboardScreen.tsx` | Private duplicate (unchanged) |
| `dailyFritz/buildFinalOverlayViewModel.ts` | Private duplicate (unchanged) |
| `dailyFritz/DailyFritzScreen.tsx` | Imports from `dailyFritzScreenHelpers.ts` (different module) |
| `dailyFritz/dailyFritzScreenHelpers.ts` | Exported copy (unchanged) |

Consolidating those duplicates is **out of scope** for this sub-phase.

---

## `toCuratedPuzzle` placement reasoning

**Verdict: structurally generic, single call site today.**

| Dependency | Ladder-specific? |
|------------|------------------|
| `DailyPuzzleSlot`, `CuratedDailyPuzzle` (`./types`) | Shared Daily Puzzle domain types |
| `getDailyPuzzleDisplayTitle` (`./presentation`) | Shared presentation helper |
| Function body | Maps any slot with board+hand → curated puzzle; no ladder hub/attempt logic |

**Decision:** Placed in `client/src/dailyPuzzle/dailyPuzzleSlotHelpers.ts` (not `ladderHelpers.ts`) because it is reusable across Daily Puzzle screens that need slot→curated conversion. Only `DailyPuzzleLadderScreen` calls it today; a future screen (e.g. legacy puzzle flow) could import the same helper without pulling ladder hub card-state logic.

`formatDateLabel` and `getLadderPuzzleCardState` remain in `ladderHelpers.ts` — the former is a local date formatter for this screen's hub UI; the latter is ladder hub card-state logic only.

---

## Files touched

| File | Change |
|------|--------|
| `DailyPuzzleLadderScreen.tsx` | Imports added; 8 icons + 3 helpers + `LadderPuzzleCardState` type removed; unused `CuratedDailyPuzzle` type import removed |
| `dailyPuzzleLadderIcons.tsx` | **New** — 8 icon components |
| `ladderHelpers.ts` | **New** — `formatDateLabel`, `getLadderPuzzleCardState` |
| `dailyPuzzleSlotHelpers.ts` | **New** — `toCuratedPuzzle` |
| `ladderHelpers.test.ts` | **New** |
| `dailyPuzzleSlotHelpers.test.ts` | **New** |
| All other files | **Untouched** |

**Confirmed:** No JSX, state, effects, handlers, or gameplay logic changed in `DailyPuzzleLadderScreen.tsx` beyond import lines and removal of extracted definitions.

---

## Full before/after — extracted symbols

### `formatDateLabel` (before — in `DailyPuzzleLadderScreen.tsx`)

```typescript
function formatDateLabel(dateText: string): string {
  const parsed = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return dateText;
  return parsed.toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}
```

### `formatDateLabel` (after — `ladderHelpers.ts`)

```typescript
export function formatDateLabel(dateText: string): string {
  const parsed = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return dateText;
  return parsed.toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}
```

---

### `LadderIconSameBoard` (before)

```typescript
const LadderIconSameBoard = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
    <path d="M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z" fill="currentColor" opacity={0.92} />
  </svg>
);
```

### `LadderIconSameBoard` (after — `dailyPuzzleLadderIcons.tsx`)

```typescript
export const LadderIconSameBoard = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
    <path d="M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z" fill="currentColor" opacity={0.92} />
  </svg>
);
```

---

### `LadderIconOrdered` (before)

```typescript
const LadderIconOrdered = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
    <path d="M7 7h10M7 12h10M7 17h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <circle cx="5" cy="7" r="1.5" fill="currentColor" />
    <circle cx="5" cy="12" r="1.5" fill="currentColor" />
    <circle cx="5" cy="17" r="1.5" fill="currentColor" />
  </svg>
);
```

### `LadderIconOrdered` (after)

```typescript
export const LadderIconOrdered = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
    <path d="M7 7h10M7 12h10M7 17h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <circle cx="5" cy="7" r="1.5" fill="currentColor" />
    <circle cx="5" cy="12" r="1.5" fill="currentColor" />
    <circle cx="5" cy="17" r="1.5" fill="currentColor" />
  </svg>
);
```

---

### `LadderIconLeaderboard` (before)

```typescript
const LadderIconLeaderboard = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
    <path d="M8 21V11M12 21V7M16 21V14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M6 11h4M10 7h4M14 14h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity={0.5} />
  </svg>
);
```

### `LadderIconLeaderboard` (after)

```typescript
export const LadderIconLeaderboard = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
    <path d="M8 21V11M12 21V7M16 21V14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M6 11h4M10 7h4M14 14h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity={0.5} />
  </svg>
);
```

---

### `DplIconCalendar` (before)

```typescript
const DplIconCalendar = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
    <rect x="4" y="5" width="16" height="16" rx="2" />
    <path d="M8 3v4M16 3v4M4 11h16" strokeLinecap="round" />
  </svg>
);
```

### `DplIconCalendar` (after)

```typescript
export const DplIconCalendar = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
    <rect x="4" y="5" width="16" height="16" rx="2" />
    <path d="M8 3v4M16 3v4M4 11h16" strokeLinecap="round" />
  </svg>
);
```

---

### `DplIconFlame` (before)

```typescript
const DplIconFlame = ({ color = 'var(--tier-standard)' }: { color?: string }) => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
    <path
      d="M12 22c4-2.5 6-6 6-10 0-3-1.5-5-3-6.5C13 4.5 12 2 12 2s-1 2.5-3 3.5C7.5 7 6 9 6 12c0 4 2 7.5 6 10z"
      stroke={color}
      strokeWidth="1.6"
      fill={color}
      fillOpacity="0.2"
    />
  </svg>
);
```

### `DplIconFlame` (after)

```typescript
export const DplIconFlame = ({ color = 'var(--tier-standard)' }: { color?: string }) => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
    <path
      d="M12 22c4-2.5 6-6 6-10 0-3-1.5-5-3-6.5C13 4.5 12 2 12 2s-1 2.5-3 3.5C7.5 7 6 9 6 12c0 4 2 7.5 6 10z"
      stroke={color}
      strokeWidth="1.6"
      fill={color}
      fillOpacity="0.2"
    />
  </svg>
);
```

---

### `DplIconLock` (before)

```typescript
const DplIconLock = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" strokeLinecap="round" />
  </svg>
);
```

### `DplIconLock` (after)

```typescript
export const DplIconLock = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" strokeLinecap="round" />
  </svg>
);
```

---

### `DplIconTrophy` (before)

```typescript
const DplIconTrophy = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
    <path d="M8 21h8M12 17v4M8 4h8v4a4 4 0 0 1-8 0V4z" strokeLinejoin="round" />
    <path d="M16 6h2a2 2 0 0 1 0 4h-2M8 6H6a2 2 0 0 0 0 4h2" strokeLinecap="round" />
  </svg>
);
```

### `DplIconTrophy` (after)

```typescript
export const DplIconTrophy = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
    <path d="M8 21h8M12 17v4M8 4h8v4a4 4 0 0 1-8 0V4z" strokeLinejoin="round" />
    <path d="M16 6h2a2 2 0 0 1 0 4h-2M8 6H6a2 2 0 0 0 0 4h2" strokeLinecap="round" />
  </svg>
);
```

---

### `DplIconLayers` (before)

```typescript
const DplIconLayers = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
    <path d="M12 2l8 4.5v7L12 18l-8-4.5v-7L12 2z" />
    <path d="M12 11l8-4.5M12 11v7M12 11L4 6.5" />
  </svg>
);
```

### `DplIconLayers` (after)

```typescript
export const DplIconLayers = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
    <path d="M12 2l8 4.5v7L12 18l-8-4.5v-7L12 2z" />
    <path d="M12 11l8-4.5M12 11v7M12 11L4 6.5" />
  </svg>
);
```

---

### `getLadderPuzzleCardState` + `LadderPuzzleCardState` (before)

```typescript
type LadderPuzzleCardState = 'active' | 'locked' | 'done' | 'idle';

function getLadderPuzzleCardState(row: {
  slotResult?: { awardedPoints: number } | null;
  isLocked: boolean;
  isAvailable: boolean;
}): LadderPuzzleCardState {
  if (row.slotResult) return 'done';
  if (row.isLocked) return 'locked';
  if (row.isAvailable) return 'active';
  return 'idle';
}
```

### `getLadderPuzzleCardState` + `LadderPuzzleCardState` (after — `ladderHelpers.ts`)

```typescript
export type LadderPuzzleCardState = 'active' | 'locked' | 'done' | 'idle';

export function getLadderPuzzleCardState(row: {
  slotResult?: { awardedPoints: number } | null;
  isLocked: boolean;
  isAvailable: boolean;
}): LadderPuzzleCardState {
  if (row.slotResult) return 'done';
  if (row.isLocked) return 'locked';
  if (row.isAvailable) return 'active';
  return 'idle';
}
```

---

### `toCuratedPuzzle` (before)

```typescript
function toCuratedPuzzle(slot: DailyPuzzleSlot): CuratedDailyPuzzle | null {
  if (!slot.startingBoard || !slot.startingHand) return null;
  return {
    id: slot.id,
    puzzleDate: slot.puzzleDate,
    title: getDailyPuzzleDisplayTitle(slot.slotIndex, slot.slotTitle),
    startingBoard: slot.startingBoard,
    startingHand: slot.startingHand,
    maxMoves: slot.maxMoves,
    targetScore: slot.targetScore,
    puzzleType: slot.puzzleType,
    dealSize: slot.dealSize,
    slotIndex: slot.slotIndex,
    slotTitle: slot.slotTitle,
    tier: slot.tier,
    slotMaxPoints: slot.slotMaxPoints,
    objectiveType: slot.objectiveType,
    objectivePayload: slot.objectivePayload,
    setVersion: 1,
    published: true,
  };
}
```

### `toCuratedPuzzle` (after — `dailyPuzzleSlotHelpers.ts`)

```typescript
import { getDailyPuzzleDisplayTitle } from './presentation';
import type { CuratedDailyPuzzle, DailyPuzzleSlot } from './types';

export function toCuratedPuzzle(slot: DailyPuzzleSlot): CuratedDailyPuzzle | null {
  if (!slot.startingBoard || !slot.startingHand) return null;
  return {
    id: slot.id,
    puzzleDate: slot.puzzleDate,
    title: getDailyPuzzleDisplayTitle(slot.slotIndex, slot.slotTitle),
    startingBoard: slot.startingBoard,
    startingHand: slot.startingHand,
    maxMoves: slot.maxMoves,
    targetScore: slot.targetScore,
    puzzleType: slot.puzzleType,
    dealSize: slot.dealSize,
    slotIndex: slot.slotIndex,
    slotTitle: slot.slotTitle,
    tier: slot.tier,
    slotMaxPoints: slot.slotMaxPoints,
    objectiveType: slot.objectiveType,
    objectivePayload: slot.objectivePayload,
    setVersion: 1,
    published: true,
  };
}
```

---

## `DailyPuzzleLadderScreen.tsx` — import changes (after)

```typescript
import { getDailyPuzzleDisplayTitle, getDailyPuzzleStepPresentation } from './presentation';
import {
  DplIconCalendar,
  DplIconFlame,
  DplIconLayers,
  DplIconLock,
  DplIconTrophy,
  LadderIconLeaderboard,
  LadderIconOrdered,
  LadderIconSameBoard,
} from './dailyPuzzleLadderIcons';
import { formatDateLabel, getLadderPuzzleCardState } from './ladderHelpers';
import { toCuratedPuzzle } from './dailyPuzzleSlotHelpers';
```

Removed from `types` import: `CuratedDailyPuzzle` (no longer referenced in screen file).

---

## Full source — `dailyPuzzleLadderIcons.tsx`

```typescript
export const LadderIconSameBoard = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
    <path d="M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z" fill="currentColor" opacity={0.92} />
  </svg>
);

export const LadderIconOrdered = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
    <path d="M7 7h10M7 12h10M7 17h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <circle cx="5" cy="7" r="1.5" fill="currentColor" />
    <circle cx="5" cy="12" r="1.5" fill="currentColor" />
    <circle cx="5" cy="17" r="1.5" fill="currentColor" />
  </svg>
);

export const LadderIconLeaderboard = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
    <path d="M8 21V11M12 21V7M16 21V14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M6 11h4M10 7h4M14 14h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity={0.5} />
  </svg>
);

export const DplIconCalendar = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
    <rect x="4" y="5" width="16" height="16" rx="2" />
    <path d="M8 3v4M16 3v4M4 11h16" strokeLinecap="round" />
  </svg>
);

export const DplIconFlame = ({ color = 'var(--tier-standard)' }: { color?: string }) => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
    <path
      d="M12 22c4-2.5 6-6 6-10 0-3-1.5-5-3-6.5C13 4.5 12 2 12 2s-1 2.5-3 3.5C7.5 7 6 9 6 12c0 4 2 7.5 6 10z"
      stroke={color}
      strokeWidth="1.6"
      fill={color}
      fillOpacity="0.2"
    />
  </svg>
);

export const DplIconLock = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" strokeLinecap="round" />
  </svg>
);

export const DplIconTrophy = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
    <path d="M8 21h8M12 17v4M8 4h8v4a4 4 0 0 1-8 0V4z" strokeLinejoin="round" />
    <path d="M16 6h2a2 2 0 0 1 0 4h-2M8 6H6a2 2 0 0 0 0 4h2" strokeLinecap="round" />
  </svg>
);

export const DplIconLayers = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
    <path d="M12 2l8 4.5v7L12 18l-8-4.5v-7L12 2z" />
    <path d="M12 11l8-4.5M12 11v7M12 11L4 6.5" />
  </svg>
);
```

---

## Full source — test files

### `ladderHelpers.test.ts`

```typescript
import { describe, expect, it } from 'vitest';
import { formatDateLabel, getLadderPuzzleCardState } from './ladderHelpers';

describe('formatDateLabel', () => {
  it('formats a valid ISO date string', () => {
    const result = formatDateLabel('2024-01-15');
    expect(result).toContain('2024');
    expect(result).toContain('15');
  });

  it('returns the input when parsing fails', () => {
    expect(formatDateLabel('not-a-date')).toBe('not-a-date');
  });
});

describe('getLadderPuzzleCardState', () => {
  it('returns done when slotResult is present', () => {
    expect(getLadderPuzzleCardState({
      slotResult: { awardedPoints: 10 },
      isLocked: false,
      isAvailable: true,
    })).toBe('done');
  });

  it('returns locked when locked without a result', () => {
    expect(getLadderPuzzleCardState({
      slotResult: null,
      isLocked: true,
      isAvailable: false,
    })).toBe('locked');
  });

  it('returns active when available and not locked', () => {
    expect(getLadderPuzzleCardState({
      slotResult: null,
      isLocked: false,
      isAvailable: true,
    })).toBe('active');
  });

  it('returns idle otherwise', () => {
    expect(getLadderPuzzleCardState({
      slotResult: null,
      isLocked: false,
      isAvailable: false,
    })).toBe('idle');
  });
});
```

### `dailyPuzzleSlotHelpers.test.ts`

```typescript
import { describe, expect, it } from 'vitest';
import type { DailyPuzzleSlot } from './types';
import { toCuratedPuzzle } from './dailyPuzzleSlotHelpers';

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

describe('toCuratedPuzzle', () => {
  it('returns null when starting board or hand is missing', () => {
    expect(toCuratedPuzzle(makeSlot({ startingBoard: undefined }))).toBeNull();
    expect(toCuratedPuzzle(makeSlot({ startingHand: undefined }))).toBeNull();
  });

  it('maps a ladder slot into a curated daily puzzle', () => {
    const result = toCuratedPuzzle(makeSlot({ slotIndex: 2, slotTitle: 'Tactical Setup' }));
    expect(result).toMatchObject({
      id: 'slot-1',
      puzzleDate: '2024-06-01',
      slotIndex: 2,
      slotTitle: 'Tactical Setup',
      setVersion: 1,
      published: true,
      maxMoves: 3,
      targetScore: 30,
    });
    expect(result?.title).toBeTruthy();
    expect(result?.startingHand).toEqual([{ low: 1, high: 2 }]);
  });
});
```

---

## Build and test results

### Baseline (before extraction — sub-phase 1 after-numbers)

| Metric | Value |
|--------|-------|
| Test files | **48** |
| Tests | **435** |
| Build | **Pass** |

### After extraction

| Metric | Value |
|--------|-------|
| Test files | **50** (+2) |
| Tests | **443** (+8) |
| Build | **Pass** |

**Commands run:**

```bash
npm test --prefix client
npm run build --prefix client
```