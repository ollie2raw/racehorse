# Phase: Daily Puzzle Cleanup — Sub-phase 8b, Target 2: Legacy In-Play Surface Extraction

## Prerequisite confirmation

**Does `docs/phase-dailypuzzle-shared-hand-dock-component-report.md` exist at that exact path?** **YES**

---

## Summary

| Item | Result |
|------|--------|
| New component | `client/src/dailyPuzzle/DailyPuzzleLegacyInPlayView.tsx` (247 LOC) |
| `DailyPuzzleScreen.tsx` LOC | 1147 → **1004** (−143) |
| View-model shape | `viewModel` + `actions` + `confettiCanvasRef` (3 top-level props) |
| Vitest files | 57 → **58** (+1) |
| Vitest tests | 496 → **500** (+4) |
| Build | **Pass** (`✓ built in 5.58s`) |

---

## Investigation

### 1. Current LOC of `DailyPuzzleScreen.tsx` (post Target 1, pre Target 2)

**1147 lines** (measured at task start).

After extraction: **1004 lines**.

---

### 2. Full quoted JSX — branches 13 + 14 (pre-extraction, post Target 1)

Source: `DailyPuzzleScreen.tsx` as it existed immediately before this extraction (`return` at line 979 through line 1146).

```tsx
  return (
    <>
      <RotateOverlay />
      <div className="screen game-screen walnut-live theme-green daily-puzzle-screen rh-match-live rh-match-solo-hud">
      <canvas
        ref={confettiCanvasRef}
        style={{
          position: 'fixed',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: 2100,
          display: status === 'SOLVED' ? 'block' : 'none',
        }}
      />
      <MatchLiveLayout
        hudLeft={
          <div className="wl-player-pill wl-player-pill-btn score-card is-you">
            <div className="wl-player-card-content">
              <div className="wl-player-card-text">
                <span className="wl-player-label">{isArchiveMode ? 'Puzzle Archive' : 'Daily Puzzle'}</span>
              </div>
              <span className="wl-player-score">{runtimeState.players.you.score}</span>
            </div>
          </div>
        }
        hudCenter={
          <div className="wl-center-status" data-ui="turn-status">
            <span className="wl-turn-label your-turn">{isArchiveMode ? 'ARCHIVE PUZZLE' : 'DAILY PUZZLE'}</span>
            <span className="wl-room-code">{formattedPuzzleDate}</span>
          </div>
        }
        hudRight={
          <div className="rh-match-solo-actions">
            <button type="button" className="rh-match-solo-action-btn" onClick={resetAttempt}>
              Play Again
            </button>
            <button type="button" className="rh-match-solo-action-btn rh-back-button" onClick={onBack}>
              ← Back to Home
            </button>
          </div>
        }
        boardInner={
          <>
            {!runtimeState.gameOver ? (
              <div className="rh-board-meta-bar rh-board-meta-bar--count-only" data-ui="board-meta">
                <BoneyardCountPill count={runtimeState.boneyard.length} />
              </div>
            ) : null}
            <Board
              board={runtimeState.board}
              legalMoves={legalMoves}
              selectedTile={selectedTile}
              lastPlayedTile={lastPlayedTile}
              onPositionClick={onPositionClick}
              tileSize={84}
            />
            {solvableWarning && (
              <div className="daily-puzzle-warning-banner">
                Puzzle warning: {validation?.reason} (best score {validation?.bestScore}). You can
                still play this puzzle.
              </div>
            )}
            {import.meta.env.DEV && solvableWarning && (
              <div className="daily-puzzle-dev-warning">
                Dev: puzzle invalid · solvable={String(validation?.solvable)} · bestScore=
                {validation?.bestScore} · hasScoringMove={String(validation?.hasScoringMove)} ·
                explored={validation?.exploredStates}
              </div>
            )}
          </>
        }
        handDock={
          <DailyPuzzleSoloHandDock
            hand={runtimeState.players.you.hand}
            handTileSize={handTileSize}
            handCompactStacked={handCompactStacked}
            selectedTile={selectedTile}
            inProgress={status === 'IN_PROGRESS'}
            isTilePlayable={(tile) => playableTileKeys.has(tileKey(tile))}
            onSelectTile={setSelectedTile}
            handRowKeyPrefix="daily-hand-row"
            tileKeyPrefix="daily-curated"
          />
        }
      />

      {status !== 'IN_PROGRESS' && (
        <div className="rh-modal-overlay" role="dialog" aria-modal="true" style={{ ['--rh-accent-rgb' as string]: '240, 192, 64' }}>
          <div className="rh-result">
            <header className="rh-result__head">
              <div className="claude-mode-hero__eyebrow" style={{ color: '#f0c040' }}>PUZZLE COMPLETE</div>
              <div className="rh-result__score">
                <span>{completedScore}</span>
                <span className="rh-result__score-suffix">PTS</span>
              </div>
              <div className="rh-result__feedback" style={{ color: completionSummary.completionMessage.color }}>
                {completionSummary.completionMessage.text}
              </div>
            </header>

            <div className="rh-result__summary">
              <div>
                <span className="rh-result__summary-label">Best Possible</span>
                <span className="rh-result__summary-value">{bestPossibleScore}</span>
              </div>
              <div>
                <span className="rh-result__summary-label">Moves Used</span>
                <span className="rh-result__summary-value">{movesUsed}</span>
              </div>
              <div>
                <span className="rh-result__summary-label">Current Streak</span>
                <span className="rh-result__summary-value" style={{ color: '#f0c040' }}>{streakDays} DAYS</span>
              </div>
            </div>

            <div className="rh-result__board">
              <div className="rh-result__board-head">
                <div className="claude-mode-section-label">GLOBAL LEADERBOARD</div>
                <div className="claude-mode-topbar__brand" style={{ fontSize: '10px', opacity: 0.4 }}>TODAY</div>
              </div>

              <div className="rh-result__lb">
                <div className="rh-result__lb-head">
                  <span>#</span>
                  <span>PLAYER</span>
                  <span style={{ textAlign: 'right' }}>SCORE</span>
                  <span style={{ textAlign: 'right' }}>MOVES</span>
                  <span style={{ textAlign: 'right' }}>TIME</span>
                </div>
                {completionSummary.modalLeaderboard.map((row, idx) => {
                  const isYou = Boolean(currentUserId) && row.userId === currentUserId;
                  const initials = getDisplayName(row.username).replace(/^@/, '').slice(0, 2).toUpperCase() || 'P';
                  return (
                    <div key={idx} className={`rh-result__lb-row ${isYou ? 'is-you' : ''}`}>
                      <span className={`rh-result__lb-rank ${idx < 3 ? 'is-top-3' : ''}`}>{idx + 1}</span>
                      <span className="rh-result__lb-name">
                        <div className="rh-result__avatar">{initials}</div>
                        <span>@{getDisplayName(row.username)}</span>
                        {isYou && <span className="rh-result-you-pill">YOU</span>}
                      </span>
                      <span className="rh-result__lb-num">{row.bestScore}</span>
                      <span className="rh-result__lb-num">{row.bestMovesUsed}</span>
                      <span className="rh-result__lb-num">{formatPuzzleElapsed(row.bestSeconds)}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <footer className="rh-result__actions">
              <button type="button" className="rh-btn-leave" onClick={resetAttempt}>Play Again</button>
              <button
                type="button"
                className="rh-btn-cancel rh-back-button"
                onClick={onBack}
              >
                ← Back to Home
              </button>
            </footer>
          </div>
        </div>
      )}

      </div>
    </>
  );
```

**Local variables used immediately above this block (still in parent):**

```tsx
  const solvableWarning = Boolean(validation && !validation.solvable);
  const formattedPuzzleDate = formatPuzzleDateLabel(puzzle.puzzleDate);
  const completedScore = completedScoreForSummary;
```

These are now inlined into the `viewModel` object at the call site (`solvableWarning` computed inline; `formattedPuzzleDate` and `completedScore` passed from existing memos).

---

### 3. State / prop / memo / callback inventory (re-derived from actual pre-extraction code)

| Category | Name | Source in parent |
|----------|------|------------------|
| **State** | `status` | `useState<PlayStatus>` |
| **State** | `isArchiveMode` | `useDailyPuzzleArchiveLeaderboard` |
| **State** | `runtimeState` | `useState<BotMatchState \| null>` (non-null at render site) |
| **State** | `selectedTile` | `useState<Tile \| null>` |
| **State** | `lastPlayedTile` | `useState<Tile \| null>` |
| **State** | `validation` | `useState<PuzzleValidationResult \| null>` |
| **State** | `bestPossibleScore` | `useState` |
| **State** | `movesUsed` | `useState` |
| **State** | `streakDays` | `useState` |
| **State** | `finalScore` | `useState` — feeds `completedScoreForSummary` memo only |
| **Ref** | `confettiCanvasRef` | `useRef<HTMLCanvasElement>(null)` |
| **Memo** | `legalMoves` | `useMemo` from `runtimeState` + `status` |
| **Memo** | `playableTileKeys` | `useMemo` from `legalMoves` + `tileKey` |
| **Memo** | `completedScoreForSummary` | `useMemo` from puzzle type, `finalScore`, runtime score |
| **Memo** | `completionSummary` | `useMemo` — message + `modalLeaderboardPreview` |
| **Derived** | `solvableWarning` | `Boolean(validation && !validation.solvable)` |
| **Derived** | `formattedPuzzleDate` | `formatPuzzleDateLabel(puzzle.puzzleDate)` |
| **Derived** | `completedScore` | alias of `completedScoreForSummary` |
| **Derived** | `currentUserId` | `user?.id ?? null` |
| **Hook output** | `handTileSize`, `handCompactStacked` | `useResponsiveHandTileSize(runtimeState?.players.you.hand.length)` |
| **Hook output** | `modalLeaderboardPreview` | via `completionSummary.modalLeaderboard` |
| **Callback** | `onPositionClick` | handler function |
| **Callback** | `setSelectedTile` | state setter (hand dock + board selection) |
| **Callback** | `resetAttempt` | function |
| **Callback** | `onBack` | prop from `DailyPuzzleScreenProps` |
| **Helper (in JSX)** | `tileKey` | inside `isTilePlayable` for `DailyPuzzleSoloHandDock` |
| **Helper (in overlay JSX)** | `getDisplayName`, `formatPuzzleElapsed` | moved into view component (presentation helpers) |

**Not read directly by branches 13/14 JSX:**

- `useDailyPuzzleLegacyGameplay` (`finalizeResult`, `resetSubmissionGuard`) — gameplay handlers only
- `dailyPuzzlePlayMoveCompletion` — `onPositionClick` / effects only
- `useDailyPuzzleValidatorWorker` — load/validation effects only
- `useDailyPuzzleArchiveLeaderboard` — beyond `isArchiveMode` and `modalLeaderboardPreview` (via `completionSummary`), lobby/leaderboard branches only

---

### 4. Proposed view-model shape (implemented)

Three top-level props — not 15+ flat props:

```tsx
export type DailyPuzzleLegacyInPlayCompletionSummary = {
  completionMessage: { text: string; color: string };
  modalLeaderboard: DailyPuzzleLeaderboardEntry[];
};

export type DailyPuzzleLegacyInPlayViewModel = {
  status: PlayStatus;
  isArchiveMode: boolean;
  formattedPuzzleDate: string;
  runtimeState: BotMatchState;
  legalMoves: Move[];
  selectedTile: Tile | null;
  lastPlayedTile: Tile | null;
  handTileSize: number;
  handCompactStacked: boolean;
  playableTileKeys: Set<string>;
  solvableWarning: boolean;
  validation: PuzzleValidationResult | null;
  completedScore: number;
  completionSummary: DailyPuzzleLegacyInPlayCompletionSummary;
  bestPossibleScore: number;
  movesUsed: number;
  streakDays: number;
  currentUserId: string | null;
};

export type DailyPuzzleLegacyInPlayActions = {
  onPositionClick: (position: Move['position']) => void;
  onSelectTile: (tile: Tile) => void;
  onResetAttempt: () => void;
  onBack: () => void;
};

export type DailyPuzzleLegacyInPlayViewProps = {
  confettiCanvasRef: RefObject<HTMLCanvasElement | null>;
  viewModel: DailyPuzzleLegacyInPlayViewModel;
  actions: DailyPuzzleLegacyInPlayActions;
};
```

**Grouping rationale:**

- **`viewModel`** — all read-only render inputs (gameplay snapshot + overlay summary data)
- **`actions`** — all callbacks the JSX invokes
- **`confettiCanvasRef`** — ref attachment for confetti canvas (owned by parent confetti effect)

---

### 5. Frozen-module consumption in branches 13/14

| Module | Called directly in extracted JSX? | How data arrives |
|--------|-----------------------------------|------------------|
| `useDailyPuzzleArchiveLeaderboard` | **No** | Parent passes `isArchiveMode`; `completionSummary.modalLeaderboard` ← `modalLeaderboardPreview` from hook |
| `useDailyPuzzleLegacyGameplay` | **No** | Not used in render tree |
| `dailyPuzzlePlayMoveCompletion` | **No** | Not used in render tree |
| `DailyPuzzleSoloHandDock` | **Yes (child component)** | Consumed inside `DailyPuzzleLegacyInPlayView` with **identical props** to Target 1 |
| `useResponsiveHandTileSize` | **No** | Parent passes `handTileSize` / `handCompactStacked` |

---

## Full source — `DailyPuzzleLegacyInPlayView.tsx`

See file on disk: `client/src/dailyPuzzle/DailyPuzzleLegacyInPlayView.tsx` (247 lines). Full content matches the extracted JSX verbatim; types exported at top of file.

`DailyPuzzleSoloHandDock` usage (unchanged from Target 1):

```tsx
          handDock={
            <DailyPuzzleSoloHandDock
              hand={runtimeState.players.you.hand}
              handTileSize={handTileSize}
              handCompactStacked={handCompactStacked}
              selectedTile={selectedTile}
              inProgress={status === 'IN_PROGRESS'}
              isTilePlayable={(tile) => playableTileKeys.has(tileKey(tile))}
              onSelectTile={actions.onSelectTile}
              handRowKeyPrefix="daily-hand-row"
              tileKeyPrefix="daily-curated"
            />
          }
```

---

## Before / after — `DailyPuzzleScreen.tsx` relevant section

### Before

Full branches 13+14 block quoted in investigation §2 above, plus local derivations:

```tsx
  const solvableWarning = Boolean(validation && !validation.solvable);
  const formattedPuzzleDate = formatPuzzleDateLabel(puzzle.puzzleDate);
  const completedScore = completedScoreForSummary;

  if (!runtimeState) { ... }

  return ( <> ... entire in-play JSX ... </> );
```

### After (current)

```tsx
  if (!runtimeState) {
    return (
      <LayoutScreen
        className="screen lobby-screen mode-home-screen"
        title={stableDailyTitle}
        subtitle="Preparing puzzle board..."
        contentClassName="screen-shell"
      />
    );
  }

  return (
    <DailyPuzzleLegacyInPlayView
      confettiCanvasRef={confettiCanvasRef}
      viewModel={{
        status,
        isArchiveMode,
        formattedPuzzleDate: formatPuzzleDateLabel(puzzle.puzzleDate),
        runtimeState,
        legalMoves,
        selectedTile,
        lastPlayedTile,
        handTileSize,
        handCompactStacked,
        playableTileKeys,
        solvableWarning: Boolean(validation && !validation.solvable),
        validation,
        completedScore: completedScoreForSummary,
        completionSummary,
        bestPossibleScore,
        movesUsed,
        streakDays,
        currentUserId,
      }}
      actions={{
        onPositionClick,
        onSelectTile: setSelectedTile,
        onResetAttempt: resetAttempt,
        onBack,
      }}
    />
  );
}
```

**Imports removed from screen:** `Board`, `BoneyardCountPill`, `RotateOverlay`, `MatchLiveLayout`, `DailyPuzzleSoloHandDock`  
**Import added:** `DailyPuzzleLegacyInPlayView`  
**Retained:** `import '../match/match-live.css'` (global styles for match layout)

---

## Full source — test file

`client/src/dailyPuzzle/DailyPuzzleLegacyInPlayView.test.tsx`:

```tsx
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { BotMatchState } from '../bot/botEngine';
import type { PlayStatus } from './dailyPuzzleScreenTypes';
import {
  DailyPuzzleLegacyInPlayView,
  type DailyPuzzleLegacyInPlayActions,
  type DailyPuzzleLegacyInPlayViewModel,
} from './DailyPuzzleLegacyInPlayView';

function makeRuntimeState(): BotMatchState {
  return {
    players: {
      bot: { hand: [], score: 0 },
      you: { hand: [{ low: 1, high: 2 }, { low: 3, high: 4 }], score: 12 },
    },
    board: {
      mainLine: [],
      leftEnd: 3,
      rightEnd: 5,
      leftEndIsDouble: false,
      rightEndIsDouble: false,
      hubDoubles: [],
    },
    boneyard: [{ low: 0, high: 1 }],
    deadTiles: [],
    handOpen: true,
    currentPlayer: 'you',
    consecutivePasses: 0,
    handNumber: 1,
    turnIndex: 0,
    handOver: false,
    gameOver: false,
    winnerId: null,
    winningScore: 60,
    lastHandWinner: null,
    lastHandReason: null,
    dealSize: 7,
    opponentPassedOnEnds: [],
    opponentDrawCount: 0,
    opponentKnownMissing: [],
    opponentMissingEvidence: [],
  };
}

function makeViewModel(status: PlayStatus): DailyPuzzleLegacyInPlayViewModel {
  return {
    status,
    isArchiveMode: false,
    formattedPuzzleDate: 'Jul 5, 2026',
    runtimeState: makeRuntimeState(),
    legalMoves: [],
    selectedTile: null,
    lastPlayedTile: null,
    handTileSize: 56,
    handCompactStacked: false,
    playableTileKeys: new Set<string>(),
    solvableWarning: false,
    validation: null,
    completedScore: 12,
    completionSummary: {
      completionMessage: { text: 'Keep practicing!', color: 'rgba(232,245,240,0.85)' },
      modalLeaderboard: [],
    },
    bestPossibleScore: 20,
    movesUsed: 2,
    streakDays: 1,
    currentUserId: null,
  };
}

function makeActions(): DailyPuzzleLegacyInPlayActions {
  return {
    onPositionClick: vi.fn(),
    onSelectTile: vi.fn(),
    onResetAttempt: vi.fn(),
    onBack: vi.fn(),
  };
}

describe('DailyPuzzleLegacyInPlayView', () => {
  it('renders live board shell without post-game overlay while IN_PROGRESS', () => {
    const { container } = render(
      <DailyPuzzleLegacyInPlayView
        confettiCanvasRef={createRef<HTMLCanvasElement>()}
        viewModel={makeViewModel('IN_PROGRESS')}
        actions={makeActions()}
      />,
    );

    expect(container.querySelector('.daily-puzzle-screen')).toBeTruthy();
    expect(container.querySelector('.tray-rail')).toBeTruthy();
    expect(screen.queryByText('PUZZLE COMPLETE')).toBeNull();
  });

  it('renders post-game overlay when status is SOLVED', () => {
    render(
      <DailyPuzzleLegacyInPlayView
        confettiCanvasRef={createRef<HTMLCanvasElement>()}
        viewModel={makeViewModel('SOLVED')}
        actions={makeActions()}
      />,
    );

    expect(screen.getByText('PUZZLE COMPLETE')).toBeTruthy();
    expect(screen.getByText('Keep practicing!')).toBeTruthy();
  });

  it('renders post-game overlay when status is FAILED', () => {
    render(
      <DailyPuzzleLegacyInPlayView
        confettiCanvasRef={createRef<HTMLCanvasElement>()}
        viewModel={makeViewModel('FAILED')}
        actions={makeActions()}
      />,
    );

    expect(screen.getByText('PUZZLE COMPLETE')).toBeTruthy();
  });

  it('wires overlay and HUD reset/back callbacks', () => {
    const actions = makeActions();
    render(
      <DailyPuzzleLegacyInPlayView
        confettiCanvasRef={createRef<HTMLCanvasElement>()}
        viewModel={makeViewModel('SOLVED')}
        actions={actions}
      />,
    );

    const overlayActions = document.querySelector('.rh-result__actions');
    expect(overlayActions).toBeTruthy();
    fireEvent.click(
      overlayActions!.querySelector('.rh-btn-leave') as HTMLButtonElement,
    );
    fireEvent.click(
      overlayActions!.querySelector('.rh-btn-cancel') as HTMLButtonElement,
    );
    expect(actions.onResetAttempt).toHaveBeenCalledTimes(1);
    expect(actions.onBack).toHaveBeenCalledTimes(1);
  });
});
```

### Test coverage notes

| Covered | Not covered (and why) |
|---------|------------------------|
| Board shell + hand dock present when `IN_PROGRESS` | `onPositionClick` / board tile clicks — requires full `Board` interaction harness |
| Overlay visible on `SOLVED` and `FAILED` | Solvable warning / dev warning banners — env-dependent (`import.meta.env.DEV`) |
| Overlay footer `Play Again` / `Back` callbacks | HUD duplicate buttons (same labels) — overlay scoped intentionally |
| | Leaderboard row rendering / YOU pill |
| | Confetti canvas `display` toggle on SOLVED |
| | Archive mode label strings |

Precedent: Target 1 established `@testing-library/react` component tests; this file follows the same pattern.

---

## Build and test results

| Metric | Before | After |
|--------|--------|-------|
| Vitest test files | 57 | **58** |
| Vitest tests | 496 | **500** |
| Build | Pass | **Pass** |

---

## Files touched

| File | Change |
|------|--------|
| `client/src/dailyPuzzle/DailyPuzzleLegacyInPlayView.tsx` | **Created** — legacy in-play board + post-game overlay view |
| `client/src/dailyPuzzle/DailyPuzzleLegacyInPlayView.test.tsx` | **Created** — 4 component tests |
| `client/src/dailyPuzzle/DailyPuzzleScreen.tsx` | Replaced inline branches 13/14 with view component call |
| `docs/phase-dailypuzzle-legacy-inplay-view-report.md` | **Created** — this report |

**Frozen / out-of-scope files:** Not modified. `DailyPuzzleLadderScreen.tsx` not touched. `DailyPuzzleSoloHandDock.tsx` consumed unchanged.

---

## Report path confirmation

**This file exists at:** `docs/phase-dailypuzzle-legacy-inplay-view-report.md`