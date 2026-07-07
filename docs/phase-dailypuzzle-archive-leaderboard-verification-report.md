# Phase: Daily Puzzle Cleanup Sub-phase 6 — Archive/Leaderboard Verification Pass

## Sub-phase 5 report path confirmation

**Does `docs/phase-dailypuzzle-ladder-slot-viewmodel-report.md` exist on disk?** **YES**

---

## Purpose

Required follow-up to sub-phase 6 (`useDailyPuzzleArchiveLeaderboard` extraction). Verify three reported gaps before sub-phase 7. **No code changes were required** — behavior is preserved with proof below.

## Summary

| Issue | Verdict |
|-------|---------|
| 1 — `setLoadError(null)` in `applyArchiveDate` | **No regression** — preserved at every archive-commit call site |
| 2 — Action function equivalence | **Confirmed** — current call sites match original inline handlers |
| 3 — Raw setter usage in screen | **Documented** — 8 direct calls; all legitimate or intentional |

**Code changes:** None  
**Tests:** 53 files / 469 tests (unchanged, confirmed passing)  
**Build:** Not re-run (no code changes); sub-phase 6 build still passes

---

## Issue 1 — `setLoadError(null)` on archive date change

### Hook implementation (missing `setLoadError` — by design)

`useDailyPuzzleArchiveLeaderboard.ts`:

```tsx
  const applyArchiveDate = useCallback(() => {
    if (!archiveInputHasCompleteDate) return;
    const nextDate = normalizeDateInputToLocalKey(archiveDateInput);
    setArchiveDateInput(nextDate);
    setSelectedDateSeed(nextDate);
    setDailyLeaderboardOpen(false);
  }, [archiveDateInput, archiveInputHasCompleteDate]);
```

`loadError` is screen-owned puzzle-load state; the hook does not receive `setLoadError`.

### Original `applyArchiveDate` (pre-extraction, git `HEAD`)

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

### Call site audit — `applyArchiveDate()`

#### Call site A — Archive modal Enter key

**Current source (`DailyPuzzleScreen.tsx`):**

```tsx
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      applyArchiveDate();
                      setLoadError(null);
                      setArchivePickerOpen(false);
                    }
                  }}
```

**Verdict: (a)** `setLoadError(null)` is called immediately after `applyArchiveDate()` at this call site. Behavior unchanged vs original (where `setLoadError` lived inside `applyArchiveDate`).

#### Call site B — Archive modal “Load Date” button

**Current source:**

```tsx
                    onClick={() => {
                      applyArchiveDate();
                      setLoadError(null);
                      setArchivePickerOpen(false);
                    }}
```

**Verdict: (a)** `setLoadError(null)` is called immediately after `applyArchiveDate()`. Behavior unchanged.

**Note:** Original git `HEAD` Load Date / Enter handlers only called `applyArchiveDate(); setArchivePickerOpen(false);` — `setLoadError(null)` was implicit inside `applyArchiveDate`. Current code makes the reset explicit at the call site; effect is identical.

---

### Call site audit — `commitArchiveDateSelection()`

#### Call site C — Lobby `ClaudePrimaryAction` (main CTA when date differs)

**Current source:**

```tsx
                    onClick={() => {
                      const nextDate = archiveInputHasCompleteDate
                        ? normalizeArchiveDateInput(archiveDateInput)
                        : selectedDateSeed;
                      if (nextDate !== selectedDateSeed) {
                        pendingStartDateRef.current = nextDate;
                        commitArchiveDateSelection(nextDate);
                        setLoadError(null);
                        return;
                      }
                      if (!puzzle || puzzle.puzzleDate !== nextDate) return;
                      void startDailyPuzzle();
                    }}
```

**Verdict: (a)** `setLoadError(null)` called immediately after `commitArchiveDateSelection(nextDate)`.

**Original inline equivalent (git `HEAD`):**

```tsx
                      if (nextDate !== selectedDateSeed) {
                        pendingStartDateRef.current = nextDate;
                        setArchiveDateInput(nextDate);
                        setSelectedDateSeed(nextDate);
                        setLoadError(null);
                        setDailyLeaderboardOpen(false);
                        return;
                      }
```

Hook `commitArchiveDateSelection` performs the three archive/leaderboard sets; screen still owns `pendingStartDateRef` and `setLoadError(null)`.

---

### Call site audit — `resetArchiveToToday()`

#### Call site D — Archive modal “Today” button

**Current source:**

```tsx
                    onClick={() => {
                      resetArchiveToToday();
                      setLoadError(null);
                    }}
```

**Verdict: (a)** `setLoadError(null)` called immediately after `resetArchiveToToday()`.

**Original inline equivalent (git `HEAD`):**

```tsx
                    onClick={() => {
                      setArchiveDateInput(localDateKey);
                      setSelectedDateSeed(localDateKey);
                      setLoadError(null);
                      setDailyLeaderboardOpen(false);
                      setArchivePickerOpen(false);
                    }}
```

---

### `handleBackHome` — not an archive date commit

**Current source:**

```tsx
  const handleBackHome = useCallback(() => {
    closeArchiveLeaderboardUi();
    setShowLobby(true);
    onBack();
  }, [closeArchiveLeaderboardUi, onBack]);
```

**Original (git `HEAD`):**

```tsx
  const handleBackHome = useCallback(() => {
    setDailyLeaderboardOpen(false);
    setArchivePickerOpen(false);
    setShowLobby(true);
    onBack();
  }, [onBack]);
```

Neither original nor current calls `setLoadError(null)` on back navigation. **Not a regression.**

### Issue 1 conclusion

**No code fix applied.** Every archive date commit path that cleared load error before still does so at the screen call site.

---

## Issue 2 — Action function equivalence vs original handlers

### Hook action implementations (reference)

```tsx
  const closeArchiveLeaderboardUi = useCallback(() => {
    setDailyLeaderboardOpen(false);
    setArchivePickerOpen(false);
  }, []);

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
```

### 1 — “Load Date” button (archive modal)

**Current full handler** — see Issue 1 Call site B above.

| Step | Original | Current |
|------|----------|---------|
| Commit date | `applyArchiveDate()` (normalize + set input + set seed + clear load error + close leaderboard) | `applyArchiveDate()` + `setLoadError(null)` at call site |
| Close picker | `setArchivePickerOpen(false)` | `setArchivePickerOpen(false)` |

**Screen-level extras at call site:** `setArchivePickerOpen(false)` — not hook responsibility (picker UX). **Not lost.**

---

### 2 — Lobby primary CTA (`ClaudePrimaryAction`) — date-change branch

**Current full handler** — see Issue 1 Call site C above.

| Step | Original inline | Current |
|------|-----------------|---------|
| Compute `nextDate` | Same | Same (`normalizeArchiveDateInput` ≡ `normalizeDateInputToLocalKey`) |
| Pending auto-start | `pendingStartDateRef.current = nextDate` | Same (screen) |
| Set archive input/seed | `setArchiveDateInput` + `setSelectedDateSeed` | `commitArchiveDateSelection(nextDate)` |
| Clear load error | `setLoadError(null)` | Same (screen) |
| Close leaderboard | `setDailyLeaderboardOpen(false)` | Inside `commitArchiveDateSelection` |
| Start play (same date) | `void startDailyPuzzle()` | Same (screen) |

**Screen-level extras:** `pendingStartDateRef`, `setLoadError(null)`, `startDailyPuzzle()` — gameplay/navigation; correctly remain at call site.

---

### 3 — “Today” button (archive modal)

**Current full handler** — see Issue 1 Call site D above.

| Step | Original inline | `resetArchiveToToday` + call site |
|------|-----------------|-----------------------------------|
| `setArchiveDateInput(localDateKey)` | ✓ | ✓ hook |
| `setSelectedDateSeed(localDateKey)` | ✓ | ✓ hook |
| `setLoadError(null)` | ✓ | ✓ call site |
| `setDailyLeaderboardOpen(false)` | ✓ | ✓ hook |
| `setArchivePickerOpen(false)` | ✓ | ✓ hook |

**Equivalence: exact** (load error split to call site only).

---

### 4 — `handleBackHome`

**Current** — quoted in Issue 1.

| Step | Original | Current |
|------|----------|---------|
| Close leaderboard | `setDailyLeaderboardOpen(false)` | `closeArchiveLeaderboardUi()` |
| Close archive picker | `setArchivePickerOpen(false)` | `closeArchiveLeaderboardUi()` |
| Show lobby | `setShowLobby(true)` | `setShowLobby(true)` (screen) |
| Navigate back | `onBack()` | `onBack()` (screen prop) |

**Screen-level extras:** `setShowLobby(true)`, `onBack()` — correctly not in hook.

---

## Issue 3 — Raw setter usage in `DailyPuzzleScreen.tsx`

Grep for direct calls outside the hook module:

### `setArchiveDateInput(`

| Line | Context | Verdict |
|------|---------|---------|
| 976 | Date `<input onChange>` — user typing in picker | **Legitimate** — incremental input edit; no leaderboard close needed until commit |

No other direct `setArchiveDateInput` in screen. Date commits route through `applyArchiveDate` / `commitArchiveDateSelection` / `resetArchiveToToday`.

### `setArchivePickerOpen(`

| Line | Context | Verdict |
|------|---------|---------|
| 933 | “Choose Date” — open picker | **Legitimate** — opening modal only |
| 954 | Overlay backdrop click — close | **Legitimate** — dismiss without date commit |
| 964 | Modal “Close” button | **Legitimate** — dismiss without date commit |
| 982 | After Enter + `applyArchiveDate` | **Legitimate companion** — `applyArchiveDate` does not close picker by design (same as original) |
| 994 | After Load Date + `applyArchiveDate` | **Legitimate companion** — same as original |

### `setDailyLeaderboardOpen(`

| Line | Context | Verdict |
|------|---------|---------|
| 347 | `startDailyPuzzle` — entering play | **Legitimate** — gameplay transition; not archive navigation |
| 813 | `LeaderboardPageShell onClose` | **Legitimate** — close leaderboard view only |
| 939 | “Leaderboard” secondary action — open | **Legitimate** — intentional open |

### `setLeaderboard(`

| Line | Context | Verdict |
|------|---------|---------|
| 229 | Puzzle-load cached path, archive mode | **Legitimate** — load effect clears rows (frozen load logic) |
| 267 | Puzzle-load network path, archive mode | **Legitimate** — same |

### `setSelectedDateSeed(`

**Not destructured / not called directly in screen.** All seed changes go through hook action functions.

### Issue 3 recommendations (decision pending — no changes made)

| Setter | Recommendation |
|--------|----------------|
| `setArchiveDateInput` on `onChange` | Keep direct — typing is not a commit |
| `setArchivePickerOpen` open/close dismiss | Keep direct — no archive commit side effects |
| `setArchivePickerOpen` after `applyArchiveDate` | Keep at call site — matches original; could later add `applyArchiveDateAndClosePicker()` if desired |
| `setDailyLeaderboardOpen(false)` in `startDailyPuzzle` | Keep direct — gameplay domain |
| `setDailyLeaderboardOpen` open / page close | Keep direct |
| `setLeaderboard([])` in load effect | Keep direct — frozen load effect |

**Risk note:** None of the direct setter calls bypass a missing leaderboard-close side effect on **date commit** paths — those use action wrappers.

---

## Files touched

| File | Change |
|------|--------|
| `docs/phase-dailypuzzle-archive-leaderboard-verification-report.md` | **New** — this verification report |

**No application code modified.**

---

## Verification

```
Test files: 53 (unchanged)
Tests:      469 (unchanged)
Command:    npm test -- --run (client) — all passed
Build:      Not re-run (no code diff)
```

---

## Gate for sub-phase 7

Sub-phase 6 extraction is **cleared** for sub-phase 7. Issue 1 is proven preserved at call sites; Issues 2–3 documented with quoted current source.