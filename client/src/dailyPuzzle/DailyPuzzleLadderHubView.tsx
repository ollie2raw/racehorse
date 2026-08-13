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
import type { DailyPuzzleSlotIndex } from './types';

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
  onStartPractice: (slotIndex: DailyPuzzleSlotIndex) => void;
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
        className="df-page dpl-ladder-hub daily-puzzle-root"
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
                  Five curated boards in a fixed sequence.
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
                        {shareDone ? 'Copied' : 'Share Result'}
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
                      {ladderSlotRows.map(({ slotIndex: slotIdx, step }) => (
                        <button
                          key={`practice-${slotIdx}`}
                          type="button"
                          className="dpl-ladder-practice-chip"
                          onClick={() => onStartPractice(slotIdx)}
                        >
                          {step.title}
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
