# Phase: Daily Puzzle Cleanup — Sub-phase 8b, Target 4 (FINAL): Ladder Hub View Extraction

## Prerequisite confirmation

**Does `docs/phase-dailypuzzle-ladder-overlays-report.md` exist at that exact path?** **YES**

---

## 1. Investigation

### 1.1 Current LOC (pre-extraction, post targets 1 and 3)

**874** lines in `client/src/dailyPuzzle/DailyPuzzleLadderScreen.tsx`.

### 1.2 Full quoted hub JSX (pre-extraction)

The entire `!inActivePlay` return block as it existed before this target (including `{ladderOverlays}` from target 3):

```tsx
  if (!inActivePlay) {
    const showNav = Boolean(onNavigate && onOpenAuth);
    const isLadderComplete = attempt?.status === 'completed';
    const needsFinalize = finalizeReady && !isLadderComplete;
    const ladderStateLabel = isLadderComplete
      ? 'Completed'
      : needsFinalize
        ? 'Finalize run'
        : attempt
          ? `Live · Puzzle ${attempt.currentSlotIndex}`
          : 'Ready to start';
    const primaryLabel = isLadderComplete
      ? 'Practice Mode'
      : needsFinalize
        ? finalizePending
          ? 'Finalizing…'
          : 'Finalize Run'
        : attempt
          ? 'Resume Daily Ladder'
          : 'Start Daily Ladder';
    const trustLine = isLadderComplete
      ? 'Practice any puzzle after your scored run.'
      : needsFinalize
        ? 'All three puzzles are scored. Finalize to unlock review and the leaderboard.'
        : 'Leaderboard updates after a scored run.';

    return (
      <>
        {ladderOverlays}
        <div
          className="df-page dpl-ladder-hub"
          style={{ '--pvf-dynamic-color': 'var(--tier-standard)' } as React.CSSProperties}
        >
          <div className="home-bg" aria-hidden="true">
            <div className="home-bg__halo" />
            <div className="home-bg__domino home-bg__domino--tl" />
            <div className="home-bg__domino home-bg__domino--tr" />
            <div className="home-bg__line home-bg__line--1" />
            <div className="home-bg__line home-bg__line--2" />
            <div className="home-bg__line home-bg__line--3" />
            <div className="home-bg__texture" />
          </div>

          {showNav ? (
            <GlobalNav
              currentMode="daily"
              onNavigate={onNavigate}
              onOpenAuth={onOpenAuth}
              onOpenAccount={onOpenAccount}
              activeColor="var(--tier-standard)"
              compactChrome
            />
          ) : null}

          <div className="df-shell df-shell--daily-fritz">
            <div className="df-layout df-pvf-layout">
              <div className="df-pvf-left-col">
                <button type="button" className="df-back-btn df-pvf-back-btn rh-back-button" onClick={onBack}>
                  <span aria-hidden>←</span> Back to home
                </button>

                <div className="df-pvf-header">
                  <div className="df-pvf-label">DAILY PUZZLE</div>
                  <h1 className="df-pvf-title">Daily Ladder</h1>
                  <p className="df-pvf-subtitle">
                    Three curated boards in a fixed sequence.
                    <br />
                    One scored run posts to the global ladder — practice stays open after you lock it in.
                  </p>
                </div>

                <article className="df-pvf-opponent-card" aria-label="Daily Ladder overview">
                  {heroSrc ? (
                    <img
                      src={heroSrc}
                      className="df-pvf-card-bg-img dpl-ladder-hero-img"
                      alt="Daily Ladder puzzle boards"
                      decoding="async"
                    />
                  ) : null}
                  <div className="df-pvf-card-overlay" aria-hidden />

                  <div className="df-pvf-card-content">
                    <div className="df-pvf-card-header">
                      <div className="df-pvf-card-eyebrow">TODAY&apos;S DAILY</div>
                      <h2 className="df-pvf-card-name">Ladder</h2>
                    </div>

                    <div className="df-pvf-card-badges">
                      <div className="df-pvf-card-badge">
                        <div className="df-pvf-card-badge-header">
                          <span className="dpl-ladder-badge-icon" aria-hidden>
                            <LadderIconSameBoard />
                          </span>
                          <span className="df-pvf-card-badge-title">Same boards</span>
                        </div>
                        <div className="df-pvf-card-badge-desc">One daily deal for everyone.</div>
                      </div>

                      <div className="df-pvf-card-badge">
                        <div className="df-pvf-card-badge-header">
                          <span className="dpl-ladder-badge-icon" aria-hidden>
                            <LadderIconOrdered />
                          </span>
                          <span className="df-pvf-card-badge-title">Sequenced run</span>
                        </div>
                        <div className="df-pvf-card-badge-desc">Solve in order — no skipping slots.</div>
                      </div>

                      <div className="df-pvf-card-badge">
                        <div className="df-pvf-card-badge-header">
                          <span className="dpl-ladder-badge-icon" aria-hidden>
                            <LadderIconLeaderboard />
                          </span>
                          <span className="df-pvf-card-badge-title">Live ladder</span>
                        </div>
                        <div className="df-pvf-card-badge-desc">Points lock on a single scored attempt.</div>
                      </div>
                    </div>
                  </div>
                </article>
              </div>

              <section className="pvf-control-panel df-pvf-control-panel" aria-label="Daily Ladder">
                <div className="df-pvf-section">
                  <div className="fritz-section-label">1. TODAY&apos;S LADDER</div>
                  <div className="df-pvf-overview-grid" role="list" aria-label="Ladder details">
                    <div className="df-pvf-overview-card" role="listitem">
                      <div className="df-pvf-overview-icon" aria-hidden>
                        <DplIconCalendar />
                      </div>
                      <div className="df-pvf-overview-body">
                        <div className="df-pvf-overview-value">{formatDateLabel(today.runDate)}</div>
                        <div className="df-pvf-overview-key">Date</div>
                      </div>
                    </div>
                    <div className="df-pvf-overview-card df-pvf-overview-card--active" role="listitem">
                      <div className="df-pvf-overview-icon" aria-hidden>
                        <LadderIconLeaderboard />
                      </div>
                      <div className="df-pvf-overview-body">
                        <div className="df-pvf-overview-value">{attempt?.totalScore ?? 0}</div>
                        <div className="df-pvf-overview-key">Ladder pts</div>
                      </div>
                    </div>
                    <div className="df-pvf-overview-card" role="listitem">
                      <div className="df-pvf-overview-icon" aria-hidden>
                        <DplIconFlame />
                      </div>
                      <div className="df-pvf-overview-body">
                        <div className="df-pvf-overview-value">{streakDisplay} days</div>
                        <div className="df-pvf-overview-key">Streak</div>
                      </div>
                    </div>
                    <div className="df-pvf-overview-card" role="listitem">
                      <div className="df-pvf-overview-icon" aria-hidden>
                        <DplIconLayers />
                      </div>
                      <div className="df-pvf-overview-body">
                        <div className="df-pvf-overview-value">{ladderTotalPoints} pts</div>
                        <div className="df-pvf-overview-key">Available</div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="df-pvf-section">
                  <div className="fritz-section-label">2. LADDER PROGRESS</div>
                  <div className="df-pvf-progress-grid" role="list" aria-label="Ladder progress">
                    {ladderSlotRows.map((row) => {
                      const cardState = getLadderPuzzleCardState(row);
                      const cardClass =
                        cardState === 'done'
                          ? 'dpl-puzzle-card--done'
                          : cardState === 'idle'
                            ? 'dpl-puzzle-card--idle'
                            : `df-game-card--${cardState}`;
                      const hintLine = row.slotResult
                        ? `${row.slotResult.awardedPoints} pts awarded`
                        : row.unlockHint ??
                          (row.slot?.slotMaxPoints != null ? `Up to ${row.slot.slotMaxPoints} pts` : null);

                      return (
                        <article
                          key={row.slotIndex}
                          role="listitem"
                          className={['df-pvf-progress-card', 'df-game-card', cardClass].filter(Boolean).join(' ')}
                        >
                          <div className="df-pvf-progress-index" aria-hidden>
                            {row.slotIndex}
                          </div>
                          <div className="df-pvf-progress-body">
                            <span className="df-pvf-progress-eyebrow">{row.step.subtitle}</span>
                            <h3 className="df-pvf-progress-title">{row.step.title}</h3>
                            <p className="df-pvf-progress-status">{row.statusSub}</p>
                            {hintLine ? <p className="df-pvf-progress-hint">{hintLine}</p> : null}
                            <div className="df-pvf-progress-footer">
                              <span className="df-pvf-progress-meta">
                                {cardState === 'locked'
                                  ? 'Locked'
                                  : cardState === 'done'
                                    ? 'Completed'
                                    : cardState === 'active'
                                      ? 'Available now'
                                      : 'Up next'}
                              </span>
                              {cardState === 'locked' ? (
                                <span className="df-pvf-progress-lock" aria-hidden>
                                  <DplIconLock />
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </div>

                <div className="df-pvf-section">
                  <div className="fritz-section-label">3. RUN SUMMARY</div>
                  <div className="df-pvf-summary-strip" aria-label="Run summary">
                    <div className="df-pvf-summary-item">
                      <div className="df-pvf-summary-icon" aria-hidden>
                        <DplIconLayers />
                      </div>
                      <div>
                        <div className="df-pvf-summary-value">Daily Ladder</div>
                        <div className="df-pvf-summary-key">Mode</div>
                      </div>
                    </div>
                    <div className="df-pvf-summary-divider" aria-hidden />
                    <div className="df-pvf-summary-item">
                      <div className="df-pvf-summary-icon" aria-hidden>
                        <DplIconTrophy />
                      </div>
                      <div>
                        <div className="df-pvf-summary-value">{ladderStateLabel}</div>
                        <div className="df-pvf-summary-key">State</div>
                      </div>
                    </div>
                    <div className="df-pvf-summary-divider" aria-hidden />
                    <div className="df-pvf-summary-item">
                      <div className="df-pvf-summary-icon" aria-hidden>
                        <LadderIconLeaderboard />
                      </div>
                      <div>
                        <div className="df-pvf-summary-value">{ladderTotalPoints} pts</div>
                        <div className="df-pvf-summary-key">Available</div>
                      </div>
                    </div>
                    <div className="df-pvf-summary-divider" aria-hidden />
                    <div className="df-pvf-summary-item">
                      <div className="df-pvf-summary-icon" aria-hidden>
                        <DplIconFlame color="var(--tier-standard)" />
                      </div>
                      <div>
                        <div className="df-pvf-summary-value">
                          {isLadderComplete ? 'Unlocked' : 'One attempt'}
                        </div>
                        <div className="df-pvf-summary-key">Run</div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="df-pvf-actions">
                  {hubError ? (
                    <p className="df-hub-error dpl-ladder-hub-error" role="alert">
                      {hubError}
                    </p>
                  ) : null}
                  {isLadderComplete ? (
                    <Button
                      variant="tier-standard"
                      size="lg"
                      type="button"
                      className="df-start-match-btn df-pvf-start-btn dpl-pvf-start-btn"
                      onClick={() => handleStartPractice(1)}
                    >
                      {primaryLabel}
                      <span className="df-start-match-chevron" aria-hidden>
                        {' '}
                        ›
                      </span>
                    </Button>
                  ) : (
                    <Button
                      variant="tier-standard"
                      size="lg"
                      type="button"
                      className="df-start-match-btn df-pvf-start-btn dpl-pvf-start-btn"
                      disabled={startPending || finalizePending}
                      onClick={() => {
                        void handleStartScored();
                      }}
                    >
                      {primaryLabel}
                      {!startPending ? (
                        <span className="df-start-match-chevron" aria-hidden>
                          {' '}
                          ›
                        </span>
                      ) : null}
                    </Button>
                  )}
                  <div className="df-pvf-footer dpl-ladder-footer">
                    <div className="dpl-ladder-footer-actions">
                      {isLadderComplete && hubLadderShareText ? (
                        <button
                          type="button"
                          className="dpl-share-result-btn"
                          onClick={() => handleShareLadderResult(hubLadderShareText)}
                        >
                          {shareDone ? '✓ Shared!' : 'Share Result'}
                        </button>
                      ) : null}
                      <Button
                        type="button"
                        variant="ghost"
                        className="df-pvf-leaderboard-link"
                        onClick={() => setLeaderboardOpen(true)}
                      >
                        View Leaderboard →
                      </Button>
                    </div>
                    <p className="dpl-ladder-trust-line">{trustLine}</p>
                  </div>
                  {isLadderComplete ? (
                    <div className="dpl-ladder-practice">
                      <div className="dpl-ladder-practice-row">
                        {([1, 2, 3] as const).map((slotIdx) => (
                          <button
                            key={`practice-${slotIdx}`}
                            type="button"
                            className="dpl-ladder-practice-chip"
                            onClick={() => handleStartPractice(slotIdx)}
                          >
                            P{slotIdx}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </section>
            </div>
          </div>
        </div>
      </>
    );
  }
```

### 1.3 Clustered prop/state inventory (re-derived from pre-extraction code)

| Cluster | Symbols |
|---------|---------|
| **Run / attempt state** | `attempt` (status, currentSlotIndex, totalScore), `finalizeReady`, `finalizePending`, `startPending`, derived `isLadderComplete`, `needsFinalize` |
| **Derived hub labels** | `showNav`, `ladderStateLabel`, `primaryLabel`, `trustLine` |
| **Today / stats** | `today.runDate`, `streakDisplay` (memo), `ladderTotalPoints` (memo), `attempt?.totalScore` |
| **Slot row data** | `ladderSlotRows` (memo from `buildLadderSlotRows`) |
| **Share flow** | `hubLadderShareText` (memo), `shareDone`, `handleShareLadderResult` |
| **Errors** | `hubError` |
| **Assets** | `heroSrc` (deferred asset) |
| **Overlays (target 3)** | `ladderOverlays` pre-built JSX |
| **Navigation pass-through** | `onBack`, `onNavigate`, `onOpenAuth`, `onOpenAccount`, `showNav` |
| **Callbacks** | `handleStartScored`, `handleStartPractice`, `setLeaderboardOpen` |

### 1.4 LadderHubViewModel + actions TypeScript types (design)

```typescript
import type { ReactNode } from 'react';
import type { AppMode } from '../types';
import type { LadderSlotRowViewModel } from './ladderSlotRowViewModel';

export type LadderHubLabels = {
  showNav: boolean;
  isLadderComplete: boolean;
  ladderStateLabel: string;
  primaryLabel: string;
  trustLine: string;
};

export type LadderHubViewModel = {
  labels: LadderHubLabels;
  runDate: string;
  attemptTotalScore: number;
  streakDisplay: number;
  ladderTotalPoints: number;
  ladderSlotRows: LadderSlotRowViewModel[];
  heroSrc: string | null;
  hubError: string | null;
  hubLadderShareText: string;
  shareDone: boolean;
  startPending: boolean;
  finalizePending: boolean;
};

export type LadderHubActions = {
  onBack: () => void;
  onNavigate?: (mode: AppMode) => void;
  onOpenAuth?: () => void;
  onOpenAccount?: () => void;
  onStartScored: () => void;
  onStartPractice: (slotIndex: 1 | 2 | 3) => void;
  onOpenLeaderboard: () => void;
  onShareResult: (text: string) => void;
};

export type DailyPuzzleLadderHubViewProps = {
  overlays: ReactNode;
  viewModel: LadderHubViewModel;
  actions: LadderHubActions;
};
```

**Grouping rationale:** 3 top-level props (`overlays`, `viewModel`, `actions`) instead of 22–28 flat props. `viewModel` holds 11 scalar/array fields plus a 5-field `labels` cluster. `actions` holds 8 callbacks including optional nav/auth pass-through.

### 1.5 Per-symbol consumption in hub JSX

| Symbol | Consumption |
|--------|-------------|
| `ladderSlotRows` | Parent pre-computes via `buildLadderSlotRows`; hub **maps** rows directly |
| `ladderTotalPoints` | Parent pre-computes via `computeLadderTotalPoints`; hub **renders** value |
| `formatDateLabel` | Called **inside hub JSX** on `runDate` — new component **imports** `ladderHelpers` |
| `getLadderPuzzleCardState` | Called **inside hub row map** — new component **imports** `ladderHelpers` |
| `DplIconCalendar`, `DplIconFlame`, `DplIconLayers`, `DplIconLock`, `DplIconTrophy` | Rendered **directly in hub JSX** — new component **imports** `dailyPuzzleLadderIcons` |
| `LadderIconLeaderboard`, `LadderIconOrdered`, `LadderIconSameBoard` | Rendered **directly in hub JSX** — new component **imports** `dailyPuzzleLadderIcons` |
| `buildLadderSlotRows` / `LadderSlotRowViewModel` | Parent only; hub receives resolved `ladderSlotRows` array |

### 1.6 `ladderOverlays` placement decision

**Approach:** Pass `ladderOverlays` as an `overlays: ReactNode` prop to `DailyPuzzleLadderHubView`.

**Why:** Preserves the exact pre-extraction DOM structure (`<> {overlays} <div className="df-page dpl-ladder-hub">…</div> </>`). Parent continues to own overlay state/wiring (`DailyPuzzleLadderOverlays` + gameplay callbacks). Hub component renders overlays as first fragment child, identical to before. Alternative (parent renders overlays as sibling outside hub) would split the fragment ownership and risk DOM-order drift between hub and in-play branches.

---

## 2. Implementation

### 2.1 New component — full source

`client/src/dailyPuzzle/DailyPuzzleLadderHubView.tsx` (419 LOC):

```tsx
import type { ReactNode } from 'react';
import type { AppMode } from '../types';
import { GlobalNav } from '../components';
import { Button } from '../components/primitives';
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
import type { LadderSlotRowViewModel } from './ladderSlotRowViewModel';

export type LadderHubLabels = {
  showNav: boolean;
  isLadderComplete: boolean;
  ladderStateLabel: string;
  primaryLabel: string;
  trustLine: string;
};

export type LadderHubViewModel = {
  labels: LadderHubLabels;
  runDate: string;
  attemptTotalScore: number;
  streakDisplay: number;
  ladderTotalPoints: number;
  ladderSlotRows: LadderSlotRowViewModel[];
  heroSrc: string | null;
  hubError: string | null;
  hubLadderShareText: string;
  shareDone: boolean;
  startPending: boolean;
  finalizePending: boolean;
};

export type LadderHubActions = {
  onBack: () => void;
  onNavigate?: (mode: AppMode) => void;
  onOpenAuth?: () => void;
  onOpenAccount?: () => void;
  onStartScored: () => void;
  onStartPractice: (slotIndex: 1 | 2 | 3) => void;
  onOpenLeaderboard: () => void;
  onShareResult: (text: string) => void;
};

export type DailyPuzzleLadderHubViewProps = {
  overlays: ReactNode;
  viewModel: LadderHubViewModel;
  actions: LadderHubActions;
};

export function DailyPuzzleLadderHubView({
  overlays,
  viewModel,
  actions,
}: DailyPuzzleLadderHubViewProps) {
  const {
    labels,
    runDate,
    attemptTotalScore,
    streakDisplay,
    ladderTotalPoints,
    ladderSlotRows,
    heroSrc,
    hubError,
    hubLadderShareText,
    shareDone,
    startPending,
    finalizePending,
  } = viewModel;
  const {
    showNav,
    isLadderComplete,
    ladderStateLabel,
    primaryLabel,
    trustLine,
  } = labels;
  const {
    onBack,
    onNavigate,
    onOpenAuth,
    onOpenAccount,
    onStartScored,
    onStartPractice,
    onOpenLeaderboard,
    onShareResult,
  } = actions;

  return (
    <>
      {overlays}
      <div
        className="df-page dpl-ladder-hub"
        style={{ '--pvf-dynamic-color': 'var(--tier-standard)' } as React.CSSProperties}
      >
        <div className="home-bg" aria-hidden="true">
          <div className="home-bg__halo" />
          <div className="home-bg__domino home-bg__domino--tl" />
          <div className="home-bg__domino home-bg__domino--tr" />
          <div className="home-bg__line home-bg__line--1" />
          <div className="home-bg__line home-bg__line--2" />
          <div className="home-bg__line home-bg__line--3" />
          <div className="home-bg__texture" />
        </div>

        {showNav ? (
          <GlobalNav
            currentMode="daily"
            onNavigate={onNavigate}
            onOpenAuth={onOpenAuth}
            onOpenAccount={onOpenAccount}
            activeColor="var(--tier-standard)"
            compactChrome
          />
        ) : null}

        <div className="df-shell df-shell--daily-fritz">
          <div className="df-layout df-pvf-layout">
            <div className="df-pvf-left-col">
              <button type="button" className="df-back-btn df-pvf-back-btn rh-back-button" onClick={onBack}>
                <span aria-hidden>←</span> Back to home
              </button>

              <div className="df-pvf-header">
                <div className="df-pvf-label">DAILY PUZZLE</div>
                <h1 className="df-pvf-title">Daily Ladder</h1>
                <p className="df-pvf-subtitle">
                  Three curated boards in a fixed sequence.
                  <br />
                  One scored run posts to the global ladder — practice stays open after you lock it in.
                </p>
              </div>

              <article className="df-pvf-opponent-card" aria-label="Daily Ladder overview">
                {heroSrc ? (
                  <img
                    src={heroSrc}
                    className="df-pvf-card-bg-img dpl-ladder-hero-img"
                    alt="Daily Ladder puzzle boards"
                    decoding="async"
                  />
                ) : null}
                <div className="df-pvf-card-overlay" aria-hidden />

                <div className="df-pvf-card-content">
                  <div className="df-pvf-card-header">
                    <div className="df-pvf-card-eyebrow">TODAY&apos;S DAILY</div>
                    <h2 className="df-pvf-card-name">Ladder</h2>
                  </div>

                  <div className="df-pvf-card-badges">
                    <div className="df-pvf-card-badge">
                      <div className="df-pvf-card-badge-header">
                        <span className="dpl-ladder-badge-icon" aria-hidden>
                          <LadderIconSameBoard />
                        </span>
                        <span className="df-pvf-card-badge-title">Same boards</span>
                      </div>
                      <div className="df-pvf-card-badge-desc">One daily deal for everyone.</div>
                    </div>

                    <div className="df-pvf-card-badge">
                      <div className="df-pvf-card-badge-header">
                        <span className="dpl-ladder-badge-icon" aria-hidden>
                          <LadderIconOrdered />
                        </span>
                        <span className="df-pvf-card-badge-title">Sequenced run</span>
                      </div>
                      <div className="df-pvf-card-badge-desc">Solve in order — no skipping slots.</div>
                    </div>

                    <div className="df-pvf-card-badge">
                      <div className="df-pvf-card-badge-header">
                        <span className="dpl-ladder-badge-icon" aria-hidden>
                          <LadderIconLeaderboard />
                        </span>
                        <span className="df-pvf-card-badge-title">Live ladder</span>
                      </div>
                      <div className="df-pvf-card-badge-desc">Points lock on a single scored attempt.</div>
                    </div>
                  </div>
                </div>
              </article>
            </div>

            <section className="pvf-control-panel df-pvf-control-panel" aria-label="Daily Ladder">
              <div className="df-pvf-section">
                <div className="fritz-section-label">1. TODAY&apos;S LADDER</div>
                <div className="df-pvf-overview-grid" role="list" aria-label="Ladder details">
                  <div className="df-pvf-overview-card" role="listitem">
                    <div className="df-pvf-overview-icon" aria-hidden>
                      <DplIconCalendar />
                    </div>
                    <div className="df-pvf-overview-body">
                      <div className="df-pvf-overview-value">{formatDateLabel(runDate)}</div>
                      <div className="df-pvf-overview-key">Date</div>
                    </div>
                  </div>
                  <div className="df-pvf-overview-card df-pvf-overview-card--active" role="listitem">
                    <div className="df-pvf-overview-icon" aria-hidden>
                      <LadderIconLeaderboard />
                    </div>
                    <div className="df-pvf-overview-body">
                      <div className="df-pvf-overview-value">{attemptTotalScore}</div>
                      <div className="df-pvf-overview-key">Ladder pts</div>
                    </div>
                  </div>
                  <div className="df-pvf-overview-card" role="listitem">
                    <div className="df-pvf-overview-icon" aria-hidden>
                      <DplIconFlame />
                    </div>
                    <div className="df-pvf-overview-body">
                      <div className="df-pvf-overview-value">{streakDisplay} days</div>
                      <div className="df-pvf-overview-key">Streak</div>
                    </div>
                  </div>
                  <div className="df-pvf-overview-card" role="listitem">
                    <div className="df-pvf-overview-icon" aria-hidden>
                      <DplIconLayers />
                    </div>
                    <div className="df-pvf-overview-body">
                      <div className="df-pvf-overview-value">{ladderTotalPoints} pts</div>
                      <div className="df-pvf-overview-key">Available</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="df-pvf-section">
                <div className="fritz-section-label">2. LADDER PROGRESS</div>
                <div className="df-pvf-progress-grid" role="list" aria-label="Ladder progress">
                  {ladderSlotRows.map((row) => {
                    const cardState = getLadderPuzzleCardState(row);
                    const cardClass =
                      cardState === 'done'
                        ? 'dpl-puzzle-card--done'
                        : cardState === 'idle'
                          ? 'dpl-puzzle-card--idle'
                          : `df-game-card--${cardState}`;
                    const hintLine = row.slotResult
                      ? `${row.slotResult.awardedPoints} pts awarded`
                      : row.unlockHint ??
                        (row.slot?.slotMaxPoints != null ? `Up to ${row.slot.slotMaxPoints} pts` : null);

                    return (
                      <article
                        key={row.slotIndex}
                        role="listitem"
                        className={['df-pvf-progress-card', 'df-game-card', cardClass].filter(Boolean).join(' ')}
                      >
                        <div className="df-pvf-progress-index" aria-hidden>
                          {row.slotIndex}
                        </div>
                        <div className="df-pvf-progress-body">
                          <span className="df-pvf-progress-eyebrow">{row.step.subtitle}</span>
                          <h3 className="df-pvf-progress-title">{row.step.title}</h3>
                          <p className="df-pvf-progress-status">{row.statusSub}</p>
                          {hintLine ? <p className="df-pvf-progress-hint">{hintLine}</p> : null}
                          <div className="df-pvf-progress-footer">
                            <span className="df-pvf-progress-meta">
                              {cardState === 'locked'
                                ? 'Locked'
                                : cardState === 'done'
                                  ? 'Completed'
                                  : cardState === 'active'
                                    ? 'Available now'
                                    : 'Up next'}
                            </span>
                            {cardState === 'locked' ? (
                              <span className="df-pvf-progress-lock" aria-hidden>
                                <DplIconLock />
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>

              <div className="df-pvf-section">
                <div className="fritz-section-label">3. RUN SUMMARY</div>
                <div className="df-pvf-summary-strip" aria-label="Run summary">
                  <div className="df-pvf-summary-item">
                    <div className="df-pvf-summary-icon" aria-hidden>
                      <DplIconLayers />
                    </div>
                    <div>
                      <div className="df-pvf-summary-value">Daily Ladder</div>
                      <div className="df-pvf-summary-key">Mode</div>
                    </div>
                  </div>
                  <div className="df-pvf-summary-divider" aria-hidden />
                  <div className="df-pvf-summary-item">
                    <div className="df-pvf-summary-icon" aria-hidden>
                      <DplIconTrophy />
                    </div>
                    <div>
                      <div className="df-pvf-summary-value">{ladderStateLabel}</div>
                      <div className="df-pvf-summary-key">State</div>
                    </div>
                  </div>
                  <div className="df-pvf-summary-divider" aria-hidden />
                  <div className="df-pvf-summary-item">
                    <div className="df-pvf-summary-icon" aria-hidden>
                      <LadderIconLeaderboard />
                    </div>
                    <div>
                      <div className="df-pvf-summary-value">{ladderTotalPoints} pts</div>
                      <div className="df-pvf-summary-key">Available</div>
                    </div>
                  </div>
                  <div className="df-pvf-summary-divider" aria-hidden />
                  <div className="df-pvf-summary-item">
                    <div className="df-pvf-summary-icon" aria-hidden>
                      <DplIconFlame color="var(--tier-standard)" />
                    </div>
                    <div>
                      <div className="df-pvf-summary-value">
                        {isLadderComplete ? 'Unlocked' : 'One attempt'}
                      </div>
                      <div className="df-pvf-summary-key">Run</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="df-pvf-actions">
                {hubError ? (
                  <p className="df-hub-error dpl-ladder-hub-error" role="alert">
                    {hubError}
                  </p>
                ) : null}
                {isLadderComplete ? (
                  <Button
                    variant="tier-standard"
                    size="lg"
                    type="button"
                    className="df-start-match-btn df-pvf-start-btn dpl-pvf-start-btn"
                    onClick={() => onStartPractice(1)}
                  >
                    {primaryLabel}
                    <span className="df-start-match-chevron" aria-hidden>
                      {' '}
                      ›
                    </span>
                  </Button>
                ) : (
                  <Button
                    variant="tier-standard"
                    size="lg"
                    type="button"
                    className="df-start-match-btn df-pvf-start-btn dpl-pvf-start-btn"
                    disabled={startPending || finalizePending}
                    onClick={() => {
                      void onStartScored();
                    }}
                  >
                    {primaryLabel}
                    {!startPending ? (
                      <span className="df-start-match-chevron" aria-hidden>
                        {' '}
                        ›
                      </span>
                    ) : null}
                  </Button>
                )}
                <div className="df-pvf-footer dpl-ladder-footer">
                  <div className="dpl-ladder-footer-actions">
                    {isLadderComplete && hubLadderShareText ? (
                      <button
                        type="button"
                        className="dpl-share-result-btn"
                        onClick={() => onShareResult(hubLadderShareText)}
                      >
                        {shareDone ? '✓ Shared!' : 'Share Result'}
                      </button>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      className="df-pvf-leaderboard-link"
                      onClick={onOpenLeaderboard}
                    >
                      View Leaderboard →
                    </Button>
                  </div>
                  <p className="dpl-ladder-trust-line">{trustLine}</p>
                </div>
                {isLadderComplete ? (
                  <div className="dpl-ladder-practice">
                    <div className="dpl-ladder-practice-row">
                      {([1, 2, 3] as const).map((slotIdx) => (
                        <button
                          key={`practice-${slotIdx}`}
                          type="button"
                          className="dpl-ladder-practice-chip"
                          onClick={() => onStartPractice(slotIdx)}
                        >
                          P{slotIdx}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
```

### 2.2 DailyPuzzleLadderScreen.tsx — hub return before

See §1.2 (full quoted block).

### 2.3 DailyPuzzleLadderScreen.tsx — hub return after

```tsx
  if (!inActivePlay) {
    const showNav = Boolean(onNavigate && onOpenAuth);
    const isLadderComplete = attempt?.status === 'completed';
    const needsFinalize = finalizeReady && !isLadderComplete;
    const ladderStateLabel = isLadderComplete
      ? 'Completed'
      : needsFinalize
        ? 'Finalize run'
        : attempt
          ? `Live · Puzzle ${attempt.currentSlotIndex}`
          : 'Ready to start';
    const primaryLabel = isLadderComplete
      ? 'Practice Mode'
      : needsFinalize
        ? finalizePending
          ? 'Finalizing…'
          : 'Finalize Run'
        : attempt
          ? 'Resume Daily Ladder'
          : 'Start Daily Ladder';
    const trustLine = isLadderComplete
      ? 'Practice any puzzle after your scored run.'
      : needsFinalize
        ? 'All three puzzles are scored. Finalize to unlock review and the leaderboard.'
        : 'Leaderboard updates after a scored run.';

    return (
      <DailyPuzzleLadderHubView
        overlays={ladderOverlays}
        viewModel={{
          labels: {
            showNav,
            isLadderComplete,
            ladderStateLabel,
            primaryLabel,
            trustLine,
          },
          runDate: today.runDate,
          attemptTotalScore: attempt?.totalScore ?? 0,
          streakDisplay,
          ladderTotalPoints,
          ladderSlotRows,
          heroSrc,
          hubError,
          hubLadderShareText,
          shareDone,
          startPending,
          finalizePending,
        }}
        actions={{
          onBack,
          onNavigate,
          onOpenAuth,
          onOpenAccount,
          onStartScored: handleStartScored,
          onStartPractice: handleStartPractice,
          onOpenLeaderboard: () => setLeaderboardOpen(true),
          onShareResult: handleShareLadderResult,
        }}
      />
    );
  }
```

Removed from screen imports (hub-only): `GlobalNav`, `Button`, all `dailyPuzzleLadderIcons`, `formatDateLabel`, `getLadderPuzzleCardState`.

---

## 3. Tests

### 3.1 Full source — `DailyPuzzleLadderHubView.test.tsx`

```tsx
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  DailyPuzzleLadderHubView,
  type LadderHubActions,
  type LadderHubViewModel,
} from './DailyPuzzleLadderHubView';
import { buildLadderSlotRows } from './ladderSlotRowViewModel';
import type { DailyPuzzleSlot } from './types';

const hubSlots: DailyPuzzleSlot[] = [
  {
    id: 'slot-1',
    puzzleDate: '2026-07-05',
    slotIndex: 1,
    slotTitle: 'Quick Line',
    tier: 'quick_line',
    puzzleType: 'reach_target',
    maxMoves: 3,
    targetScore: 20,
    dealSize: 7,
    slotMaxPoints: 10,
    bestPossibleScore: 20,
    startingBoard: {
      mainLine: [],
      leftEnd: 0,
      rightEnd: 0,
      leftEndIsDouble: false,
      rightEndIsDouble: false,
      hubDoubles: [],
    },
    startingHand: [{ low: 1, high: 2 }],
    objectiveType: 'reach_target',
    objectivePayload: {},
  },
  {
    id: 'slot-2',
    puzzleDate: '2026-07-05',
    slotIndex: 2,
    slotTitle: 'Tactical Setup',
    tier: 'tactical_setup',
    puzzleType: 'reach_target',
    maxMoves: 3,
    targetScore: 30,
    dealSize: 7,
    slotMaxPoints: 15,
    bestPossibleScore: 30,
    startingBoard: {
      mainLine: [],
      leftEnd: 0,
      rightEnd: 0,
      leftEndIsDouble: false,
      rightEndIsDouble: false,
      hubDoubles: [],
    },
    startingHand: [{ low: 3, high: 4 }],
    objectiveType: 'reach_target',
    objectivePayload: {},
  },
  {
    id: 'slot-3',
    puzzleDate: '2026-07-05',
    slotIndex: 3,
    slotTitle: 'Master Chain',
    tier: 'master_chain',
    puzzleType: 'one_turn_high_score',
    maxMoves: 1,
    targetScore: 0,
    dealSize: 7,
    slotMaxPoints: 20,
    bestPossibleScore: 40,
    startingBoard: {
      mainLine: [],
      leftEnd: 0,
      rightEnd: 0,
      leftEndIsDouble: false,
      rightEndIsDouble: false,
      hubDoubles: [],
    },
    startingHand: [{ low: 5, high: 6 }],
    objectiveType: 'one_turn_high_score',
    objectivePayload: {},
  },
];

function makeViewModel(overrides: Partial<LadderHubViewModel> = {}): LadderHubViewModel {
  return {
    labels: {
      showNav: true,
      isLadderComplete: false,
      ladderStateLabel: 'Ready to start',
      primaryLabel: 'Start Daily Ladder',
      trustLine: 'Leaderboard updates after a scored run.',
    },
    runDate: '2026-07-05',
    attemptTotalScore: 0,
    streakDisplay: 3,
    ladderTotalPoints: 45,
    ladderSlotRows: buildLadderSlotRows({
      hubSlots,
      completedSlots: [],
      attemptStatus: undefined,
      nextSlotIndex: null,
    }),
    heroSrc: null,
    hubError: null,
    hubLadderShareText: '',
    shareDone: false,
    startPending: false,
    finalizePending: false,
    ...overrides,
  };
}

function makeActions(): LadderHubActions {
  return {
    onBack: vi.fn(),
    onNavigate: vi.fn(),
    onOpenAuth: vi.fn(),
    onOpenAccount: vi.fn(),
    onStartScored: vi.fn(),
    onStartPractice: vi.fn(),
    onOpenLeaderboard: vi.fn(),
    onShareResult: vi.fn(),
  };
}

describe('DailyPuzzleLadderHubView', () => {
  it('renders hub shell with progress overview and slot rows', () => {
    const { container } = render(
      <DailyPuzzleLadderHubView
        overlays={<div data-testid="overlays-stub" />}
        viewModel={makeViewModel()}
        actions={makeActions()}
      />,
    );

    expect(container.querySelector('.dpl-ladder-hub')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Daily Ladder', level: 1 })).toBeTruthy();
    expect(screen.getAllByText('45 pts').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('3 days')).toBeTruthy();
    expect(screen.getByLabelText('Ladder progress')).toBeTruthy();
    expect(screen.getByTestId('overlays-stub')).toBeTruthy();
  });

  it('wires start scored and back callbacks', () => {
    const actions = makeActions();
    render(
      <DailyPuzzleLadderHubView
        overlays={null}
        viewModel={makeViewModel()}
        actions={actions}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Start Daily Ladder/i }));
    fireEvent.click(screen.getByRole('button', { name: /Back to home/i }));
    expect(actions.onStartScored).toHaveBeenCalledTimes(1);
    expect(actions.onBack).toHaveBeenCalledTimes(1);
  });

  it('wires leaderboard and practice callbacks when ladder is complete', () => {
    const actions = makeActions();
    render(
      <DailyPuzzleLadderHubView
        overlays={null}
        viewModel={makeViewModel({
          labels: {
            showNav: false,
            isLadderComplete: true,
            ladderStateLabel: 'Completed',
            primaryLabel: 'Practice Mode',
            trustLine: 'Practice any puzzle after your scored run.',
          },
          hubLadderShareText: 'Share me',
        })}
        actions={actions}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Practice Mode/i }));
    fireEvent.click(screen.getByRole('button', { name: 'View Leaderboard →' }));
    fireEvent.click(screen.getByRole('button', { name: 'Share Result' }));
    fireEvent.click(screen.getByRole('button', { name: 'P2' }));

    expect(actions.onStartPractice).toHaveBeenCalledWith(1);
    expect(actions.onOpenLeaderboard).toHaveBeenCalledTimes(1);
    expect(actions.onShareResult).toHaveBeenCalledWith('Share me');
    expect(actions.onStartPractice).toHaveBeenCalledWith(2);
  });

  it('shows hub error and share-done state', () => {
    render(
      <DailyPuzzleLadderHubView
        overlays={null}
        viewModel={makeViewModel({
          labels: {
            showNav: false,
            isLadderComplete: true,
            ladderStateLabel: 'Completed',
            primaryLabel: 'Practice Mode',
            trustLine: 'Practice any puzzle after your scored run.',
          },
          hubError: 'Unable to start today’s ladder.',
          hubLadderShareText: 'Share me',
          shareDone: true,
        })}
        actions={makeActions()}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Unable to start today’s ladder.');
    expect(screen.getByRole('button', { name: '✓ Shared!' })).toBeTruthy();
  });
});
```

### 3.2 Coverage disclosure

**Covered:**
- Hub shell renders (`.dpl-ladder-hub`, h1, overview stats, slot progress list)
- `overlays` ReactNode renders before hub content
- `onStartScored`, `onBack`
- Complete-run path: `onStartPractice(1)`, `onOpenLeaderboard`, `onShareResult`, practice chip `P2`
- Hub error alert and share-done button label

**Not covered (honest gaps, same spirit as targets 2–3):**
- `GlobalNav` navigation/auth callback wiring (`onNavigate`, `onOpenAuth`, `onOpenAccount`) — nav renders when `showNav: true` but clicks not asserted
- Hero image conditional (`heroSrc` non-null)
- Per-slot card state CSS classes (`locked` / `active` / `done` / `idle`) and lock icon
- `startPending` / `finalizePending` disabled primary button and chevron suppression
- `needsFinalize` label variants (`Finalize Run`, `Finalizing…`, trust line)
- In-progress attempt labels (`Resume Daily Ladder`, `Live · Puzzle N`)
- `formatDateLabel` locale output (implicit via render only)
- Integration with real `DailyPuzzleLadderOverlays` (stub used instead)
- End-to-end `DailyPuzzleLadderScreen` hub branch

### 3.3 Test counts

| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| Test files | 59 | 60 | +1 |
| Tests | 506 | 510 | +4 |

---

## 4. Build and LOC

| Check | Result |
|-------|--------|
| `npm test` (client) | **PASS** — 60 files, 510 tests |
| `npm run build --prefix client` | **PASS** — built in 5.47s |

| File | LOC |
|------|-----|
| `DailyPuzzleLadderScreen.tsx` before | 874 |
| `DailyPuzzleLadderScreen.tsx` after | **573** (−301) |
| `DailyPuzzleLadderHubView.tsx` (new) | 419 |
| `DailyPuzzleLadderHubView.test.tsx` (new) | 214 |

### 4.1 Ladder session controller assessment

**Yes — `DailyPuzzleLadderScreen.tsx` now reads as a cohesive ladder session controller.**

Remaining structure:
1. **State + hooks** (~lines 74–377): attempt/today, gameplay, share memos, slot rows, overlays wiring
2. **Branch 1 — leaderboard delegate** (~lines 428–442): `leaderboardOpen` early return
3. **Branch 3 — hub** (~lines 444–505): label derivation + `<DailyPuzzleLadderHubView />` delegate (no inline hub JSX)
4. **Branch 4 — in-play board** (~lines 507–572): sole remaining large inline render block (~65 LOC)

No other large inline render blocks remain beyond in-play. Matches sizing report expectation: controller + in-play board only; sub-phase 8b render-tree decomposition is complete pending a new sizing pass.

---

## 5. Files touched

| File | Action |
|------|--------|
| `client/src/dailyPuzzle/DailyPuzzleLadderHubView.tsx` | **Created** — hub view component + viewModel/actions types |
| `client/src/dailyPuzzle/DailyPuzzleLadderHubView.test.tsx` | **Created** — 4 unit tests |
| `client/src/dailyPuzzle/DailyPuzzleLadderScreen.tsx` | **Modified** — hub branch delegates to `DailyPuzzleLadderHubView`; hub-only imports removed |
| `docs/phase-dailypuzzle-ladder-hub-view-report.md` | **Created** — this report |

**Frozen / untouched:** All files listed in task scope (overlays, helpers, icons, gameplay hooks, in-play board, leaderboard delegate, `DailyPuzzleScreen.tsx`, etc.).

---

## 6. Sub-phase 8b completion

Targets 1–4 of sub-phase 8b are now complete:

| Target | Component | Screen LOC impact |
|--------|-----------|-------------------|
| 1 | `DailyPuzzleSoloHandDock` | shared hand dock |
| 2 | `DailyPuzzleLegacyInPlayView` | `DailyPuzzleScreen` 1147→1004 |
| 3 | `DailyPuzzleLadderOverlays` | `DailyPuzzleLadderScreen` 1070→874 |
| 4 | `DailyPuzzleLadderHubView` | `DailyPuzzleLadderScreen` 874→573 |

No further render-tree extraction targets for `DailyPuzzleLadderScreen.tsx` without a new sizing pass.