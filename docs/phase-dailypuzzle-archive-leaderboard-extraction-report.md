# Phase: Daily Puzzle Cleanup Sub-phase 6 — Archive Date-Picking + Leaderboard State Extraction

## Sub-phase 5 report path confirmation

**Does `docs/phase-dailypuzzle-ladder-slot-viewmodel-report.md` exist on disk?** **YES**

---

## Goal

Extract archive date-picking and leaderboard state management from `DailyPuzzleScreen.tsx` into dedicated module(s). Preserve race-condition guards and coupling with puzzle-load (without moving load logic). Medium-risk extraction — stateful, not purely functional.

## Summary

| Item | Result |
|------|--------|
| New hook | `client/src/dailyPuzzle/useDailyPuzzleArchiveLeaderboard.ts` (151 LOC) |
| New pure helpers | `client/src/dailyPuzzle/dailyPuzzleArchiveLeaderboardHelpers.ts` (93 LOC) |
| New tests | `client/src/dailyPuzzle/dailyPuzzleArchiveLeaderboardHelpers.test.ts` (126 LOC, 10 tests) |
| `DailyPuzzleScreen.tsx` LOC | **1294 → 1235** (−59) |
| Behavior change | **None** (load effect, race guards, UI flows preserved) |
| Test files / tests | **52 / 459** → **53 / 469** (+1 file, +10 tests) |
| Build | **Pass** |

---

## Current LOC (pre-extraction, post sub-phases 4–5)

**1294 LOC**

---

## Investigation — archive date picking

### State

```tsx
  const [selectedDateSeed, setSelectedDateSeed] = useState(localDateKey);
  const [archiveDateInput, setArchiveDateInput] = useState(localDateKey);
  const [archivePickerOpen, setArchivePickerOpen] = useState(false);
  const pendingStartDateRef = useRef<string | null>(null);
```

(`pendingStartDateRef` stays in screen — auto-start-after-date-change is gameplay/start flow, not archive/leaderboard domain.)

### Derived values (inline, pre-extraction)

```tsx
  const isArchiveMode = selectedDateSeed !== localDateKey;
  const archiveInputHasCompleteDate = /^\d{4}-\d{2}-\d{2}$/.test(archiveDateInput);
  const archiveDateDirty = archiveDateInput !== selectedDateSeed;
  const archiveTargetDate = archiveInputHasCompleteDate
    ? normalizeDateInputToLocalKey(archiveDateInput)
    : selectedDateSeed;
  const archiveTargetIsToday = archiveTargetDate === localDateKey;
  const displayDateSeed = puzzle?.puzzleDate ?? (showLobby ? archiveTargetDate : selectedDateSeed);
  const selectedPuzzleReady = puzzle?.puzzleDate === selectedDateSeed;
```

### Callbacks

```tsx
  const applyArchiveDate = useCallback(() => {
    if (!archiveInputHasCompleteDate) return;
    const nextDate = normalizeDateInputToLocalKey(archiveDateInput);
    setArchiveDateInput(nextDate);
    setSelectedDateSeed(nextDate);
    setLoadError(null);
    setDailyLeaderboardOpen(false);
  }, [archiveDateInput, archiveInputHasCompleteDate]);
```

(`setLoadError(null)` remains at screen call sites after hook methods — load error is puzzle-load domain.)

### UI handlers (inline JSX, not moved)

- Primary action: commits date via `setArchiveDateInput` / `setSelectedDateSeed` / closes leaderboard
- Archive modal: `type="date"` input with `max={localDateKey}`, Load Date / Today / Enter key
- `handleBackHome`: closes archive picker + leaderboard modal

### URL / query-param sync

**None found.** No `useSearchParams`, `window.location`, or routing state for archive dates.

### Forward/back navigation

**None.** Only `<input type="date" max={localDateKey}>` — no prev/next day buttons.

---

## Investigation — leaderboard state

### State

```tsx
  const [dailyLeaderboardOpen, setDailyLeaderboardOpen] = useState(false);
  const [leaderboard, setLeaderboard] = useState<DailyPuzzleLeaderboardEntry[]>([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const leaderboardLoadIdRef = useRef(0);
  const leaderboardInFlightDateRef = useRef<string | null>(null);
```

### Fetch callback (full source, pre-extraction)

```tsx
  const refreshLeaderboard = useCallback(async (puzzleDate: string) => {
    if (leaderboardInFlightDateRef.current === puzzleDate) {
      return;
    }

    const requestId = ++leaderboardLoadIdRef.current;
    leaderboardInFlightDateRef.current = puzzleDate;
    setLeaderboardLoading(true);
    try {
      const rows = await fetchDailyPuzzleLeaderboard(puzzleDate, 20);
      if (requestId !== leaderboardLoadIdRef.current) return;
      setLeaderboard(rows);
    } catch {
      if (requestId !== leaderboardLoadIdRef.current) return;
      setLeaderboard([]);
    } finally {
      if (requestId === leaderboardLoadIdRef.current) {
        setLeaderboardLoading(false);
      }
      if (leaderboardInFlightDateRef.current === puzzleDate) {
        leaderboardInFlightDateRef.current = null;
      }
    }
  }, []);
```

### Display derivations (pre-extraction)

```tsx
  const currentLeaderboardIndex = useMemo(() => {
    if (!currentUserId) return -1;
    return leaderboard.findIndex((row) => row.userId === currentUserId);
  }, [currentUserId, leaderboard]);
  const currentLeaderboardRow =
    currentLeaderboardIndex >= 0 ? leaderboard[currentLeaderboardIndex] ?? null : null;
  const leaderboardSummaryCards = useMemo<LeaderboardSummaryCard[]>(() => { /* 4 cards */ }, [...]);
```

`completionSummary` used `leaderboard.slice(0, 20)` — now `modalLeaderboardPreview` from hook.

### Caching

**No persistent cache.** Leaderboard rows live in component state only; cleared via `setLeaderboard([])` on archive load paths (in puzzle-load effect — **not moved**).

### `renderLeaderboardRows` JSX helper

**Left in screen** — pure presentation markup, not state management.

---

## Dependency mapping

### Archive ↔ Leaderboard coupling

| Trigger | Behavior |
|---------|----------|
| `applyArchiveDate` | Closes `dailyLeaderboardOpen` |
| `commitArchiveDateSelection` / primary action date change | Closes leaderboard |
| `resetArchiveToToday` | Closes leaderboard + archive picker |
| `handleBackHome` / `closeArchiveLeaderboardUi` | Closes both modals |
| `startDailyPuzzle` | Closes leaderboard (screen still calls `setDailyLeaderboardOpen(false)`) |

### Archive ↔ Puzzle-load coupling (load logic **not moved**)

| Trigger | Behavior |
|---------|----------|
| `selectedDateSeed` change | Puzzle-load `useEffect` re-runs (`loadKey = selectedDateSeed`) |
| `isArchiveMode` | Load path: today → `refreshLeaderboard`; archive → `setLeaderboard([])` |
| `entryMode` effect | `selectedDateSeed !== localDateKey` → `'legacy'` mode |
| Ladder routing guards | Multiple `selectedDateSeed === localDateKey` checks |

### Leaderboard ↔ Puzzle-load / submission (call sites **not moved**)

| Caller | Action |
|--------|--------|
| Puzzle-load effect (cached/today path) | `refreshLeaderboard(puzzleDate)` or `setLeaderboard([])` |
| `finalizeResult` | `refreshLeaderboard(puzzle.puzzleDate)` after submission |

### Parent props / routing

- `user?.id` feeds leaderboard summary index lookup
- No parent routing props for archive dates
- `localDateKey` from `getLocalDateKey()` (Pacific calendar)

---

## Grep — consumer confirmation (`client/src/`)

| Symbol | Consumers |
|--------|-----------|
| `refreshLeaderboard` (pre) | **Only** `DailyPuzzleScreen.tsx` |
| `leaderboardInFlightDateRef` | **Only** `DailyPuzzleScreen.tsx` |
| `selectedDateSeed` / `archiveDateInput` | **Only** `DailyPuzzleScreen.tsx` |
| `applyArchiveDate` | **Only** `DailyPuzzleScreen.tsx` |
| `dailyLeaderboardOpen` | **Only** `DailyPuzzleScreen.tsx` |

**Conclusion:** Single consumer — `DailyPuzzleScreen.tsx`.

---

## Race-condition guard mapping (high-scrutiny)

### Leaderboard fetch guards (preserved exactly in hook)

1. **In-flight dedup by date:** `leaderboardInFlightDateRef.current === puzzleDate` → skip new fetch for same date.
2. **Monotonic `requestId`:** `++leaderboardLoadIdRef.current` per outbound fetch.
3. **Stale response ignore:** On resolve/reject, `if (requestId !== leaderboardLoadIdRef.current) return` — drops superseded responses.
4. **Loading flag:** Cleared in `finally` only when `requestId === leaderboardLoadIdRef.current`.
5. **In-flight ref cleanup:** `leaderboardInFlightDateRef` nulled in `finally` when still matching `puzzleDate`.

### Scenario: user changes archive date while leaderboard fetch in flight

**Today (preserved):**

1. User on today; `refreshLeaderboard('2024-06-01')` starts (`requestId = 1`).
2. User switches to archive `'2024-05-01'` via date picker.
3. Puzzle-load effect runs: `isArchiveMode === true` → `setLeaderboard([])` immediately (in load effect — unchanged).
4. No new `refreshLeaderboard` for archive (archive skips leaderboard).
5. If original fetch completes with `requestId` still `1` (no newer fetch started), **it may call `setLeaderboard(rows)` for the old date** — this is pre-existing behavior; extraction does not alter it.

### Scenario: rapid today refreshes

Second `refreshLeaderboard` for a **different** date increments `requestId`; first response ignored by guard #3.

### No ref bridges

Hook owns `leaderboardLoadIdRef` and `leaderboardInFlightDateRef` internally. Screen receives `refreshLeaderboard` and `setLeaderboard` as return values — no cross-hook ref sharing.

---

## Decision point — one module vs two

**Decision: ONE cohesive hook** (`useDailyPuzzleArchiveLeaderboard`) **+ pure helpers file**.

**Reasoning:**

| Factor | Assessment |
|--------|------------|
| Archive date commit | Always closes leaderboard modal |
| `displayDateSeed` | Combines `puzzleDate`, `showLobby`, archive target, and `selectedDateSeed` |
| Archive mode | Controls whether load calls `refreshLeaderboard` vs `setLeaderboard([])` |
| UI close paths | `handleBackHome`, Today button, apply date — all close both surfaces |

Splitting into `useDailyPuzzleArchive` + `useDailyPuzzleLeaderboard` would require either:

- Passing `setDailyLeaderboardOpen` across hooks on every archive action, or
- A ref bridge to share modal/seed state (explicitly forbidden)

A single hook with one clear responsibility — **"daily puzzle archive navigation + today's leaderboard data for the lobby"** — matches project standard (one hook = one cohesive domain). Pure date/summary math lives in `dailyPuzzleArchiveLeaderboardHelpers.ts` for testability.

---

## Extraction — `DailyPuzzleScreen.tsx` after

Hook invocation (replaces inline state/refs/callbacks):

```tsx
  const {
    selectedDateSeed,
    archiveDateInput,
    setArchiveDateInput,
    archivePickerOpen,
    setArchivePickerOpen,
    isArchiveMode,
    archiveInputHasCompleteDate,
    archiveDateDirty,
    archiveTargetIsToday,
    displayDateSeed,
    selectedPuzzleReady,
    applyArchiveDate,
    resetArchiveToToday,
    commitArchiveDateSelection,
    closeArchiveLeaderboardUi,
    dailyLeaderboardOpen,
    setDailyLeaderboardOpen,
    leaderboard,
    setLeaderboard,
    leaderboardLoading,
    refreshLeaderboard,
    leaderboardSummaryCards,
    modalLeaderboardPreview,
  } = useDailyPuzzleArchiveLeaderboard({
    localDateKey,
    userId: user?.id ?? null,
    puzzleDate: puzzle?.puzzleDate,
    showLobby,
  });
```

Puzzle-load effect unchanged except it uses hook exports (`refreshLeaderboard`, `setLeaderboard`, `isArchiveMode`, `selectedDateSeed`).

---

## New module — `dailyPuzzleArchiveLeaderboardHelpers.ts` (full source)

```typescript
import { normalizeDateInputToLocalKey } from './date';
import { formatPuzzleElapsed } from './dailyPuzzleScreenHelpers';
import type { DailyPuzzleLeaderboardEntry } from './api';
import type { LeaderboardSummaryCard } from '../ui/LeaderboardPageShell';

const COMPLETE_ARCHIVE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isCompleteArchiveDateInput(value: string): boolean {
  return COMPLETE_ARCHIVE_DATE_PATTERN.test(value);
}

export function isArchiveModeForDate(selectedDateSeed: string, localDateKey: string): boolean {
  return selectedDateSeed !== localDateKey;
}

export function isArchiveDateDirty(archiveDateInput: string, selectedDateSeed: string): boolean {
  return archiveDateInput !== selectedDateSeed;
}

export function resolveArchiveTargetDate(
  archiveDateInput: string,
  selectedDateSeed: string,
): string {
  const archiveInputHasCompleteDate = isCompleteArchiveDateInput(archiveDateInput);
  return archiveInputHasCompleteDate
    ? normalizeDateInputToLocalKey(archiveDateInput)
    : selectedDateSeed;
}

export function resolveDisplayDateSeed(params: {
  puzzleDate: string | null | undefined;
  showLobby: boolean;
  archiveTargetDate: string;
  selectedDateSeed: string;
}): string {
  const { puzzleDate, showLobby, archiveTargetDate, selectedDateSeed } = params;
  return puzzleDate ?? (showLobby ? archiveTargetDate : selectedDateSeed);
}

export function isSelectedPuzzleReady(
  puzzleDate: string | null | undefined,
  selectedDateSeed: string,
): boolean {
  return puzzleDate === selectedDateSeed;
}

export function findCurrentLeaderboardIndex(
  leaderboard: DailyPuzzleLeaderboardEntry[],
  userId: string | null,
): number {
  if (!userId) return -1;
  return leaderboard.findIndex((row) => row.userId === userId);
}

export function buildLeaderboardSummaryCards(params: {
  currentLeaderboardIndex: number;
  currentLeaderboardRow: DailyPuzzleLeaderboardEntry | null;
}): LeaderboardSummaryCard[] {
  const { currentLeaderboardIndex, currentLeaderboardRow } = params;
  return [
    {
      label: 'Your Rank',
      value: currentLeaderboardIndex >= 0 ? `#${currentLeaderboardIndex + 1}` : '—',
      sublabel: 'Today’s placement',
      tone: 'accent',
    },
    {
      label: 'Score',
      value: currentLeaderboardRow ? `${currentLeaderboardRow.bestScore}` : '—',
      sublabel: currentLeaderboardRow ? 'Best submitted run' : 'No submitted score yet',
      tone: 'neutral',
    },
    {
      label: 'Moves',
      value: currentLeaderboardRow ? `${currentLeaderboardRow.bestMovesUsed}` : '—',
      sublabel: 'Tiles used',
      tone: 'neutral',
    },
    {
      label: 'Time',
      value: currentLeaderboardRow ? formatPuzzleElapsed(currentLeaderboardRow.bestSeconds) : '—',
      sublabel: 'Best finish time',
      tone: 'neutral',
    },
  ];
}

export function sliceLeaderboardModalPreview(
  leaderboard: DailyPuzzleLeaderboardEntry[],
  limit = 20,
): DailyPuzzleLeaderboardEntry[] {
  return leaderboard.slice(0, limit);
}
```

---

## New module — `useDailyPuzzleArchiveLeaderboard.ts` (full source)

```typescript
import { useCallback, useMemo, useRef, useState } from 'react';
import { fetchDailyPuzzleLeaderboard, type DailyPuzzleLeaderboardEntry } from './api';
import { normalizeDateInputToLocalKey } from './date';
import {
  buildLeaderboardSummaryCards,
  findCurrentLeaderboardIndex,
  isArchiveDateDirty,
  isArchiveModeForDate,
  isCompleteArchiveDateInput,
  isSelectedPuzzleReady,
  resolveArchiveTargetDate,
  resolveDisplayDateSeed,
  sliceLeaderboardModalPreview,
} from './dailyPuzzleArchiveLeaderboardHelpers';
import type { LeaderboardSummaryCard } from '../ui/LeaderboardPageShell';

export type UseDailyPuzzleArchiveLeaderboardParams = {
  localDateKey: string;
  userId: string | null;
  puzzleDate: string | null | undefined;
  showLobby: boolean;
};

export function useDailyPuzzleArchiveLeaderboard({
  localDateKey,
  userId,
  puzzleDate,
  showLobby,
}: UseDailyPuzzleArchiveLeaderboardParams) {
  const [selectedDateSeed, setSelectedDateSeed] = useState(localDateKey);
  const [archiveDateInput, setArchiveDateInput] = useState(localDateKey);
  const [archivePickerOpen, setArchivePickerOpen] = useState(false);
  const [dailyLeaderboardOpen, setDailyLeaderboardOpen] = useState(false);
  const [leaderboard, setLeaderboard] = useState<DailyPuzzleLeaderboardEntry[]>([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const leaderboardLoadIdRef = useRef(0);
  const leaderboardInFlightDateRef = useRef<string | null>(null);

  const isArchiveMode = isArchiveModeForDate(selectedDateSeed, localDateKey);
  const archiveInputHasCompleteDate = isCompleteArchiveDateInput(archiveDateInput);
  const archiveDateDirty = isArchiveDateDirty(archiveDateInput, selectedDateSeed);
  const archiveTargetDate = resolveArchiveTargetDate(archiveDateInput, selectedDateSeed);
  const archiveTargetIsToday = archiveTargetDate === localDateKey;
  const displayDateSeed = resolveDisplayDateSeed({
    puzzleDate,
    showLobby,
    archiveTargetDate,
    selectedDateSeed,
  });
  const selectedPuzzleReady = isSelectedPuzzleReady(puzzleDate, selectedDateSeed);

  const closeArchiveLeaderboardUi = useCallback(() => {
    setDailyLeaderboardOpen(false);
    setArchivePickerOpen(false);
  }, []);

  const applyArchiveDate = useCallback(() => {
    if (!archiveInputHasCompleteDate) return;
    const nextDate = normalizeDateInputToLocalKey(archiveDateInput);
    setArchiveDateInput(nextDate);
    setSelectedDateSeed(nextDate);
    setDailyLeaderboardOpen(false);
  }, [archiveDateInput, archiveInputHasCompleteDate]);

  const resetArchiveToToday = useCallback(() => {
    setArchiveDateInput(localDateKey);
    setSelectedDateSeed(localDateKey);
    setDailyLeaderboardOpen(false);
    setArchivePickerOpen(false);
  }, [localDateKey]);

  const commitArchiveDateSelection = useCallback((nextDate: string) => {
    setArchiveDateInput(nextDate);
    setSelectedDateSeed(nextDate);
    setDailyLeaderboardOpen(false);
  }, []);

  const refreshLeaderboard = useCallback(async (puzzleDateKey: string) => {
    if (leaderboardInFlightDateRef.current === puzzleDateKey) {
      return;
    }

    const requestId = ++leaderboardLoadIdRef.current;
    leaderboardInFlightDateRef.current = puzzleDateKey;
    setLeaderboardLoading(true);
    try {
      const rows = await fetchDailyPuzzleLeaderboard(puzzleDateKey, 20);
      if (requestId !== leaderboardLoadIdRef.current) return;
      setLeaderboard(rows);
    } catch {
      if (requestId !== leaderboardLoadIdRef.current) return;
      setLeaderboard([]);
    } finally {
      if (requestId === leaderboardLoadIdRef.current) {
        setLeaderboardLoading(false);
      }
      if (leaderboardInFlightDateRef.current === puzzleDateKey) {
        leaderboardInFlightDateRef.current = null;
      }
    }
  }, []);

  const currentLeaderboardIndex = useMemo(
    () => findCurrentLeaderboardIndex(leaderboard, userId),
    [leaderboard, userId],
  );
  const currentLeaderboardRow =
    currentLeaderboardIndex >= 0 ? leaderboard[currentLeaderboardIndex] ?? null : null;
  const leaderboardSummaryCards = useMemo<LeaderboardSummaryCard[]>(
    () =>
      buildLeaderboardSummaryCards({
        currentLeaderboardIndex,
        currentLeaderboardRow,
      }),
    [currentLeaderboardIndex, currentLeaderboardRow],
  );
  const modalLeaderboardPreview = useMemo(
    () => sliceLeaderboardModalPreview(leaderboard),
    [leaderboard],
  );

  return {
    selectedDateSeed,
    setSelectedDateSeed,
    archiveDateInput,
    setArchiveDateInput,
    archivePickerOpen,
    setArchivePickerOpen,
    isArchiveMode,
    archiveInputHasCompleteDate,
    archiveDateDirty,
    archiveTargetDate,
    archiveTargetIsToday,
    displayDateSeed,
    selectedPuzzleReady,
    applyArchiveDate,
    resetArchiveToToday,
    commitArchiveDateSelection,
    closeArchiveLeaderboardUi,
    dailyLeaderboardOpen,
    setDailyLeaderboardOpen,
    leaderboard,
    setLeaderboard,
    leaderboardLoading,
    refreshLeaderboard,
    leaderboardSummaryCards,
    modalLeaderboardPreview,
    currentLeaderboardIndex,
    currentLeaderboardRow,
  };
}
```

---

## New test file — full source

See `client/src/dailyPuzzle/dailyPuzzleArchiveLeaderboardHelpers.test.ts` (126 LOC, 10 tests) — covers date validation, target/display resolution, archive mode, leaderboard index/summary cards, modal slice.

### Hook-level tests — not added

**Reason:** `refreshLeaderboard` calls `fetchDailyPuzzleLeaderboard` (Supabase/API). Same pattern as `useDailyPuzzleValidatorWorker` — pure protocol/math tested; async integration left to build + manual behavior. `useResponsiveHandTileSize` tests pure `computeResponsiveHandTileSize` + minimal hook wiring with mocked `resize` — leaderboard fetch has no equivalent cheap mock without stubbing `api.ts`.

---

## Files touched

| File | Change |
|------|--------|
| `client/src/dailyPuzzle/DailyPuzzleScreen.tsx` | Inline archive/leaderboard state, refs, callbacks, and display `useMemo`s replaced with `useDailyPuzzleArchiveLeaderboard()` call. Puzzle-load effect **unchanged** (still calls `refreshLeaderboard` / `setLeaderboard`). `setLoadError(null)` remains at screen handlers. |
| `client/src/dailyPuzzle/useDailyPuzzleArchiveLeaderboard.ts` | **New** cohesive hook |
| `client/src/dailyPuzzle/dailyPuzzleArchiveLeaderboardHelpers.ts` | **New** pure helpers |
| `client/src/dailyPuzzle/dailyPuzzleArchiveLeaderboardHelpers.test.ts` | **New** tests |
| `docs/phase-dailypuzzle-archive-leaderboard-extraction-report.md` | This report |

**Frozen files untouched.**

---

## Verification

### Tests

```
Before: 52 test files / 459 tests
After:  53 test files / 469 tests
```

### Build

`npm run build --prefix client` — **Pass**

---

## Remaining risks

- Pre-existing race: stale leaderboard fetch may repopulate rows after archive switch (documented above; not introduced by extraction).
- `entryMode` initial state simplified to `'checking'` (equivalent on mount since `selectedDateSeed` always initializes to `localDateKey`).