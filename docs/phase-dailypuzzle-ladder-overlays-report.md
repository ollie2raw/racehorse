# Phase: Daily Puzzle Cleanup — Sub-phase 8b, Target 3: Ladder Result Overlays Extraction

## Prerequisite confirmation

**Does `docs/phase-dailypuzzle-legacy-inplay-view-report.md` exist at that exact path?** **YES**

---

## Summary

| Item | Result |
|------|--------|
| New component | `client/src/dailyPuzzle/DailyPuzzleLadderOverlays.tsx` (283 LOC) |
| `DailyPuzzleLadderScreen.tsx` LOC | 1070 → **874** (−196) |
| Props shape | `flags` + `actions` + 3 presentation fields (not 15+ flat props) |
| Vitest files | 58 → **59** (+1) |
| Vitest tests | 500 → **506** (+6) |
| Build | **Pass** (`✓ built in 5.67s`) |

---

## Investigation

### 1. Current LOC (post Target 1, pre Target 3)

**1070 lines** in `DailyPuzzleLadderScreen.tsx` at task start.

After extraction: **874 lines**.

---

### 2. Full quoted `renderLadderOverlays()` (pre-extraction)

Source: `DailyPuzzleLadderScreen.tsx` lines 405–649 as it existed before this extraction.

```tsx
  const renderLadderOverlays = () => (
    <>
      {submitPending || finalizePending ? (
        <div
          className="rh-modal-overlay dpl-ladder-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-busy="true"
          aria-label={finalizePending ? 'Finalizing ladder' : 'Submitting puzzle'}
        >
          <div className="rh-result dpl-ladder-pending-modal">
            <header className="rh-result__head">
              <div className="claude-mode-hero__eyebrow" style={{ color: 'var(--tier-standard)' }}>
                DAILY LADDER
              </div>
              <div className="rh-result__feedback">
                {finalizePending ? 'Finalizing ladder…' : 'Submitting puzzle…'}
              </div>
            </header>
            <p className="dpl-ladder-pending-copy">Please wait.</p>
          </div>
        </div>
      ) : null}

      {slotOverlay ? (
        <div
          className="rh-modal-overlay dpl-ladder-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Puzzle complete"
        >
          <div className="rh-result dpl-ladder-result">
            <header className="rh-result__head">
              <div className="claude-mode-hero__eyebrow">PUZZLE COMPLETE</div>
              <div className="rh-result__score">
                <span>{slotOverlay.response.slotResult.awardedPoints}</span>
                <span className="rh-result__score-suffix">PTS</span>
              </div>
              <div className="rh-result__feedback">
                {getDailyPuzzleDisplayTitle(
                  slotOverlay.response.slotResult.slotIndex,
                  slotOverlay.response.slotResult.slotTitle,
                )}
              </div>
            </header>
            <div className="rh-result__summary">
              <div>
                <span className="rh-result__summary-label">Raw Score</span>
                <span className="rh-result__summary-value">{slotOverlay.rawScore}</span>
              </div>
              <div>
                <span className="rh-result__summary-label">Best Possible</span>
                <span className="rh-result__summary-value">{slotOverlay.response.slotResult.bestPossibleScore}</span>
              </div>
              <div>
                <span className="rh-result__summary-label">Ladder Total</span>
                <span className="rh-result__summary-value">{slotOverlay.response.attempt.totalScore}</span>
              </div>
            </div>
            <footer className="rh-result__actions dpl-ladder-result__actions">
              <button type="button" className="dpl-ladder-result-btn dpl-ladder-result-btn--ghost" onClick={exitPlayToHub}>
                Back to Ladder
              </button>
              {slotOverlay.response.nextSlot ? (
                <button
                  type="button"
                  className="dpl-ladder-result-btn dpl-ladder-result-btn--primary"
                  onClick={() => {
                    const nextSlot = slotOverlay.response.nextSlot;
                    setSlotOverlay(null);
                    if (nextSlot) launchSlot(nextSlot, 'scored');
                  }}
                >
                  {`Next · Puzzle ${slotOverlay.response.nextSlot.slotIndex}`}
                </button>
              ) : null}
            </footer>
          </div>
        </div>
      ) : null}

      {practiceOverlay ? (
        <div className="rh-modal-overlay dpl-ladder-modal-overlay" role="dialog" aria-modal="true" aria-label="Practice complete">
          <div className="rh-result">
            <header className="rh-result__head">
              <div className="claude-mode-hero__eyebrow" style={{ color: 'var(--tier-standard)' }}>PRACTICE COMPLETE</div>
              <div className="rh-result__score">
                <span>{practiceOverlay.rawScore}</span>
                <span className="rh-result__score-suffix">PTS</span>
              </div>
              <div className="rh-result__feedback">
                {getDailyPuzzleDisplayTitle(practiceOverlay.slotIndex, practiceOverlay.slotTitle)}
              </div>
            </header>
            <div className="rh-result__summary">
              <div>
                <span className="rh-result__summary-label">Best Possible</span>
                <span className="rh-result__summary-value">{practiceOverlay.bestPossible ?? '—'}</span>
              </div>
              <div>
                <span className="rh-result__summary-label">Mode</span>
                <span className="rh-result__summary-value">Practice</span>
              </div>
              <div>
                <span className="rh-result__summary-label">Slot</span>
                <span className="rh-result__summary-value">P{practiceOverlay.slotIndex}</span>
              </div>
            </div>
            <footer
              className="rh-result__actions"
              style={{ gridTemplateColumns: practiceOverlay.slotIndex < 3 ? '1fr 1.2fr' : '1fr 1fr' }}
            >
              <button
                type="button"
                className="rh-btn-leave"
                onClick={() => {
                  const idx = practiceOverlay.slotIndex;
                  setPracticeOverlay(null);
                  handleStartPractice(idx as 1 | 2 | 3);
                }}
              >
                Replay P{practiceOverlay.slotIndex}
              </button>
              {practiceOverlay.slotIndex < 3 ? (
                <button
                  type="button"
                  className="rh-btn-cancel"
                  onClick={() => {
                    const nextIdx = practiceOverlay.slotIndex + 1;
                    setPracticeOverlay(null);
                    handleStartPractice(nextIdx as 1 | 2 | 3);
                  }}
                >
                  Practice P{practiceOverlay.slotIndex + 1}
                </button>
              ) : (
                <button
                  type="button"
                  className="rh-btn-cancel"
                  onClick={() => {
                    setPracticeOverlay(null);
                    setRuntimeState(null);
                    setActiveSlot(null);
                  }}
                >
                  ← Back to Ladder
                </button>
              )}
            </footer>
            {practiceOverlay.slotIndex < 3 && (
              <div style={{ padding: '0 22px 22px', marginTop: '-10px', textAlign: 'center' }}>
                <button
                  type="button"
                  className="btn text compact"
                  style={{ opacity: 0.5, fontSize: '11px' }}
                  onClick={() => {
                    setPracticeOverlay(null);
                    setRuntimeState(null);
                    setActiveSlot(null);
                  }}
                >
                  Return to Ladder Home
                </button>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {finalOverlay ? (
        <div className="rh-modal-overlay dpl-ladder-modal-overlay" role="dialog" aria-modal="true" aria-label="Ladder complete">
          <div className="rh-result dpl-ladder-result">
            <header className="rh-result__head">
              <div className="claude-mode-hero__eyebrow">LADDER COMPLETE</div>
              <div className="rh-result__score">
                <span>{finalOverlay.response.attempt.totalScore}</span>
                <span className="rh-result__score-suffix">PTS</span>
              </div>
              <div className="rh-result__feedback">
                {finalOverlay.response.leaderboardRank ? `Rank #${finalOverlay.response.leaderboardRank}` : 'Ladder finalized'}
              </div>
            </header>
            <div className="rh-result__summary">
              <div>
                <span className="rh-result__summary-label">Completed</span>
                <span className="rh-result__summary-value">{finalOverlay.response.attempt.puzzlesCompleted}/3</span>
              </div>
              <div>
                <span className="rh-result__summary-label">Puzzle 3</span>
                <span className="rh-result__summary-value">{finalOverlay.response.attempt.masterChainScore}</span>
              </div>
              <div>
                <span className="rh-result__summary-label">Breakdown</span>
                <span className="rh-result__summary-value">
                  {currentSlotBreakdown.map((chip) => `${chip.label} ${chip.value}`).join(' · ')}
                </span>
              </div>
            </div>
            <footer className="rh-result__actions dpl-ladder-result__actions dpl-ladder-result__actions--with-share">
              {finalLadderShareText ? (
                <button
                  type="button"
                  className="dpl-ladder-result-btn dpl-ladder-share-result-btn"
                  onClick={() => handleShareLadderResult(finalLadderShareText)}
                >
                  {shareDone ? '✓ Shared!' : 'Share Result'}
                </button>
              ) : null}
              <button
                type="button"
                className="dpl-ladder-result-btn dpl-ladder-result-btn--ghost"
                onClick={() => {
                  exitPlayToHub();
                  onBack();
                }}
              >
                ← Home
              </button>
              <button
                type="button"
                className="dpl-ladder-result-btn dpl-ladder-result-btn--ghost"
                onClick={() => {
                  setFinalOverlay(null);
                  exitPlayToHub();
                }}
              >
                Review Ladder
              </button>
              <button
                type="button"
                className="dpl-ladder-result-btn dpl-ladder-result-btn--primary"
                onClick={() => {
                  setFinalOverlay(null);
                  exitPlayToHub();
                  setLeaderboardOpen(true);
                }}
              >
                Leaderboard
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </>
  );
```

---

### 3. Full quoted call sites (pre-extraction)

**Hub return (`!inActivePlay`):**

```tsx
    return (
      <>
        {renderLadderOverlays()}
        <div
          className="df-page dpl-ladder-hub"
```

**In-play return:**

```tsx
  return (
    <>
      {renderLadderOverlays()}
      <RotateOverlay />
      <div className="screen game-screen walnut-live theme-green daily-puzzle-screen rh-match-live rh-match-solo-hud">
```

---

### 4. State / prop / memo / callback inventory per overlay branch

#### Branch 2a — Pending (`submitPending || finalizePending`)

| Reads | Calls |
|-------|-------|
| `submitPending` (from `useDailyPuzzleLadderGameplay`) | None |
| `finalizePending` (screen state + hook flow) | None |

#### Branch 2b — Slot complete (`slotOverlay`)

| Reads | Calls |
|-------|-------|
| `slotOverlay.response`, `slotOverlay.rawScore` | `exitPlayToHub` |
| `getDailyPuzzleDisplayTitle` | `setSlotOverlay(null)`, `launchSlot(nextSlot, 'scored')` on Next |

#### Branch 2c — Practice complete (`practiceOverlay`)

| Reads | Calls |
|-------|-------|
| `practiceOverlay.slotIndex`, `slotTitle`, `rawScore`, `bestPossible` | `setPracticeOverlay(null)`, `handleStartPractice(idx)` on Replay/Next |
| `getDailyPuzzleDisplayTitle` | `setPracticeOverlay(null)`, `setRuntimeState(null)`, `setActiveSlot(null)` on Back/Return |

#### Branch 2d — Ladder final (`finalOverlay`)

| Reads | Calls |
|-------|-------|
| `finalOverlay.response` | `handleShareLadderResult(finalLadderShareText)` |
| `currentSlotBreakdown` (memo from `buildLadderSlotBreakdown`) | `exitPlayToHub()`, `onBack()` on Home |
| `finalLadderShareText` (memo) | `setFinalOverlay(null)`, `exitPlayToHub()` on Review |
| `shareDone` | `setFinalOverlay(null)`, `exitPlayToHub()`, `setLeaderboardOpen(true)` on Leaderboard |

#### Shared across branches

| Symbol | Used by |
|--------|---------|
| `exitPlayToHub` | 2b (Back to Ladder), 2d (Home/Review/Leaderboard via parent actions) |
| `getDailyPuzzleDisplayTitle` | 2b, 2c (presentation helper inside overlay JSX) |

#### Specific to one branch only

| Symbol | Branch |
|--------|--------|
| `submitPending`, `finalizePending` | 2a only |
| `slotOverlay`, `launchSlot`, `setSlotOverlay` | 2b only |
| `practiceOverlay`, `handleStartPractice`, `setPracticeOverlay`, `setRuntimeState`, `setActiveSlot` | 2c only |
| `finalOverlay`, `currentSlotBreakdown`, `finalLadderShareText`, `shareDone`, `handleShareLadderResult`, `setFinalOverlay`, `setLeaderboardOpen`, `onBack` | 2d only |

---

### 5. Discriminated union design and mutual-exclusivity finding

**Finding: overlays are NOT mutually exclusive today.**

Pre-extraction code uses **four independent parallel conditionals** inside a fragment, not `else-if` / first-match-wins:

1. `submitPending || finalizePending`
2. `slotOverlay`
3. `practiceOverlay`
4. `finalOverlay`

**Multiple overlays can render simultaneously** if multiple flags/data are set (e.g. pending + slot). There is no early `return` between them — only fixed **render order**: pending → slot → practice → final.

A single discriminated union like `type ActiveOverlay = 'pending' | 'slot' | 'practice' | 'final' | 'none'` would **change behavior** by forcing at most one layer. Instead, the implemented type is a **parallel flags bundle**:

```tsx
export type LadderSlotOverlayData = {
  response: DailyPuzzleSubmitSlotResponse;
  rawScore: number;
};

export type LadderPracticeOverlayData = {
  slotIndex: number;
  slotTitle: string;
  rawScore: number;
  bestPossible: number | null;
};

export type LadderFinalOverlayData = {
  response: DailyPuzzleCompleteResponse;
};

export type DailyPuzzleLadderOverlayFlags = {
  submitPending: boolean;
  finalizePending: boolean;
  slotOverlay: LadderSlotOverlayData | null;
  practiceOverlay: LadderPracticeOverlayData | null;
  finalOverlay: LadderFinalOverlayData | null;
};

export type DailyPuzzleLadderOverlayActions = {
  exitPlayToHub: () => void;
  onSlotNext: (nextSlot: DailyPuzzleSlot) => void;
  onPracticeReplay: (slotIndex: 1 | 2 | 3) => void;
  onPracticeNext: (slotIndex: 1 | 2 | 3) => void;
  onPracticeExitToHub: () => void;
  onShareResult: (text: string) => void;
  onFinalHome: () => void;
  onFinalReview: () => void;
  onFinalLeaderboard: () => void;
};

export type DailyPuzzleLadderOverlaysProps = {
  flags: DailyPuzzleLadderOverlayFlags;
  currentSlotBreakdown: LadderSlotBreakdownChip[];
  finalLadderShareText: string;
  shareDone: boolean;
  actions: DailyPuzzleLadderOverlayActions;
};
```

The new component preserves the same four parallel checks in the same order.

---

### 6. Frozen-module consumption

| Module | Called directly in overlay JSX? | How data arrives |
|--------|--------------------------------|------------------|
| `useDailyPuzzleLadderGameplay` | **No** | Parent passes `submitPending`; overlay state setters remain in parent/hook wiring |
| `ladderSlotRowViewModel` | **No** | Parent passes `currentSlotBreakdown` from `buildLadderSlotBreakdown` memo |
| `ladderHelpers` | **No** | Not used in overlay JSX |
| `dailyPuzzleLadderIcons` | **No** | Not used in overlay JSX |

Presentation helper `getDailyPuzzleDisplayTitle` from `./presentation` is used inside the extracted component (same as pre-extraction).

---

## Full source — `DailyPuzzleLadderOverlays.tsx`

See file on disk: `client/src/dailyPuzzle/DailyPuzzleLadderOverlays.tsx` (283 lines). Content is a verbatim move of `renderLadderOverlays()` with callbacks routed through `actions`.

---

## Before / after — call sites in `DailyPuzzleLadderScreen.tsx`

### Before

```tsx
        {renderLadderOverlays()}
```

(twice: hub return and in-play return)

### After

Single shared element defined once after `exitPlayToHub`:

```tsx
  const ladderOverlays = (
    <DailyPuzzleLadderOverlays
      flags={{
        submitPending,
        finalizePending,
        slotOverlay,
        practiceOverlay,
        finalOverlay,
      }}
      currentSlotBreakdown={currentSlotBreakdown}
      finalLadderShareText={finalLadderShareText}
      shareDone={shareDone}
      actions={{
        exitPlayToHub,
        onSlotNext: (nextSlot) => {
          setSlotOverlay(null);
          launchSlot(nextSlot, 'scored');
        },
        onPracticeReplay: (idx) => {
          setPracticeOverlay(null);
          handleStartPractice(idx);
        },
        onPracticeNext: (idx) => {
          setPracticeOverlay(null);
          handleStartPractice(idx);
        },
        onPracticeExitToHub: () => {
          setPracticeOverlay(null);
          setRuntimeState(null);
          setActiveSlot(null);
        },
        onShareResult: handleShareLadderResult,
        onFinalHome: () => {
          exitPlayToHub();
          onBack();
        },
        onFinalReview: () => {
          setFinalOverlay(null);
          exitPlayToHub();
        },
        onFinalLeaderboard: () => {
          setFinalOverlay(null);
          exitPlayToHub();
          setLeaderboardOpen(true);
        },
      }}
    />
  );
```

**Hub return:**

```tsx
    return (
      <>
        {ladderOverlays}
        <div
          className="df-page dpl-ladder-hub"
```

**In-play return:**

```tsx
  return (
    <>
      {ladderOverlays}
      <RotateOverlay />
      <div className="screen game-screen walnut-live theme-green daily-puzzle-screen rh-match-live rh-match-solo-hud">
```

---

## Full source — test file

`client/src/dailyPuzzle/DailyPuzzleLadderOverlays.test.tsx` — 6 tests (see file on disk for full source).

### Coverage disclosure

| Covered | Not covered |
|---------|-------------|
| Pending overlay (submit + finalize copy) | Practice P3-only back path vs P1/P2 next-slot branches (partial — replay only) |
| Slot overlay + `exitPlayToHub` / `onSlotNext` | `shareDone` ✓ Shared! label toggle |
| Practice overlay + `onPracticeReplay` | `invokeLadderShareResult` side effects |
| Final overlay + home/review/leaderboard/share | Breakdown chip string formatting edge cases |
| **Parallel render:** pending + slot both visible | `launchSlot` / `handleStartPractice` integration (parent-owned) |

---

## Build and test results

| Metric | Before | After |
|--------|--------|-------|
| Vitest test files | 58 | **59** |
| Vitest tests | 500 | **506** |
| Build | Pass | **Pass** |

---

## Files touched

| File | Change |
|------|--------|
| `client/src/dailyPuzzle/DailyPuzzleLadderOverlays.tsx` | **Created** — extracted overlay stack |
| `client/src/dailyPuzzle/DailyPuzzleLadderOverlays.test.tsx` | **Created** — 6 component tests |
| `client/src/dailyPuzzle/DailyPuzzleLadderScreen.tsx` | Removed `renderLadderOverlays`; added `ladderOverlays` element + import |
| `docs/phase-dailypuzzle-ladder-overlays-report.md` | **Created** — this report |

**Out of scope / frozen:** Not modified. Hub and in-play board JSX unchanged except `{ladderOverlays}` substitution.

---

## Report path confirmation

**This file exists at:** `docs/phase-dailypuzzle-ladder-overlays-report.md`