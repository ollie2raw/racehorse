import { useCallback } from 'react';
import type { CSSProperties } from 'react';
import { Button } from '../components/primitives';
import { GlobalNav } from '../components/GlobalNav';
import type { AppMode } from '../types';
import { useDeferredAsset } from '../ui/useDeferredAsset';
import {
  DplIconCalendar,
  DplIconFlame,
  DplIconLayers,
  DplIconTrophy,
  LadderIconLeaderboard,
  LadderIconOrdered,
  LadderIconSameBoard,
} from '../dailyPuzzle/dailyPuzzleLadderIcons';
import type { PuzzleRushStage } from './types';
import '../dailyFritz/dailyFritz.css';
import './puzzleRush.css';

/**
 * Puzzle Rush entry hub.
 *
 * Wears the retired Daily Ladder hub's chrome deliberately — same `df-pvf-*`
 * layout, hero card, overview grid, summary strip, and primary CTA treatment.
 * The classes come from `dailyFritz.css` / `dailyPuzzle.css`; nothing here
 * invents new visual language. Only the *content* is Rush's.
 *
 * Structural differences from the ladder, driven by the mechanic:
 *  - the ladder's 5 lock/unlock progress tiles become a 3-stage preview strip,
 *    because Rush has no per-puzzle unlock;
 *  - "Available points" becomes personal best, since Rush's ceiling is the
 *    player's own record rather than a fixed daily total.
 */

export type PuzzleRushHubViewModel = {
  runDate: string;
  /** All-time best total, or null when the player has never finished a run. */
  personalBest: number | null;
  streakDays: number;
  /** Whether today's official run has already been played. */
  playedToday: boolean;
  stages: PuzzleRushStage[];
  baseSeconds: number;
  startPending: boolean;
  error: string | null;
  showNav?: boolean;
};

export type PuzzleRushHubActions = {
  onBack: () => void;
  onStart: () => void;
  onNavigate?: (mode: AppMode) => void;
  onOpenAuth?: () => void;
  onSignOut?: () => void;
  /** Omitted entirely when no leaderboard screen exists to link to. */
  onOpenLeaderboard?: () => void;
};

function formatDateLabel(dateKey: string): string {
  const parsed = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return dateKey;
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Stage tiles replace the ladder's locked/unlocked slots — Rush has no unlocks.
 * Content is kept to Daily Fritz's card scale: a short eyebrow, a title, one
 * terse status line and one hint. Prose here overflows the card.
 */
const STAGE_STATUS: Record<string, string> = {
  warm_up: 'Short hands',
  building: 'Bigger boards',
  master: 'Full hands',
};

export function PuzzleRushHubView({
  viewModel,
  actions,
}: {
  viewModel: PuzzleRushHubViewModel;
  actions: PuzzleRushHubActions;
}) {
  const {
    runDate,
    personalBest,
    streakDays,
    playedToday,
    stages,
    baseSeconds,
    startPending,
    error,
    showNav = true,
  } = viewModel;
  const { onBack, onStart, onNavigate, onOpenAuth, onSignOut, onOpenLeaderboard } = actions;

  const loadHeroAsset = useCallback(
    () => import('../assets/dailyPuzzle/newnewladderfinal.webp'),
    [],
  );
  const heroSrc = useDeferredAsset('puzzle-rush-hero', loadHeroAsset);

  const totalPuzzles = stages.reduce(
    (sum, stage) => sum + Math.max(0, stage.toOrdinal - stage.fromOrdinal + 1),
    0,
  );

  return (
    <div
      // `df-page` only, exactly like DailyFritzHubView. The ladder's
      // `dpl-ladder-hub` carried 63 slot-specific overrides — including
      // `grid-template-columns: repeat(5, ...)` for its five ladder slots,
      // which squeezed Rush's three stage cards into 3 of 5 columns and
      // shrank their padding. Matching Fritz's root gives the 3-column grid
      // and card spacing for free.
      className="df-page"
      // `--df-pvf-accent` re-colors the borrowed Fritz hub chrome (eyebrow,
      // hero name, active tile, icons, start button, leaderboard link) from
      // Fritz's gold to Daily Puzzle's blue. Fritz's own default is untouched.
      style={
        {
          '--pvf-dynamic-color': 'var(--tier-standard)',
          '--df-pvf-accent': 'var(--tier-standard)',
          // Dark ink on the solid blue CTA, matching how the gold CTA reads.
          '--df-pvf-accent-ink': 'var(--bg-obsidian)',
        } as CSSProperties
      }
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
          currentMode="puzzleRush"
          onNavigate={onNavigate}
          onOpenAuth={onOpenAuth}
          onSignOut={onSignOut}
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
              <h1 className="df-pvf-title">Puzzle Rush</h1>
              <p className="df-pvf-subtitle">
                Solve as many as you can before the clock runs out.
              </p>
            </div>

            <article className="df-pvf-opponent-card" aria-label="Puzzle Rush overview">
              {heroSrc ? (
                <img
                  src={heroSrc}
                  className="df-pvf-card-bg-img"
                  alt=""
                  decoding="async"
                  loading="lazy"
                />
              ) : null}
              <div className="df-pvf-card-overlay" aria-hidden />

              <div className="df-pvf-card-content">
                <div className="df-pvf-card-header">
                  <div className="df-pvf-card-eyebrow">TODAY&apos;S DAILY</div>
                  <h2 className="df-pvf-card-name">Rush</h2>
                </div>

                <div className="df-pvf-card-badges">
                  <div className="df-pvf-card-badge">
                    <div className="df-pvf-card-badge-header">
                      <DplIconFlame />
                      <span className="df-pvf-card-badge-title">Beat the clock</span>
                    </div>
                    <div className="df-pvf-card-badge-desc">{baseSeconds}s to start. Solve well, bank more.</div>
                  </div>

                  <div className="df-pvf-card-badge">
                    <div className="df-pvf-card-badge-header">
                      <LadderIconOrdered />
                      <span className="df-pvf-card-badge-title">Three stages</span>
                    </div>
                    <div className="df-pvf-card-badge-desc">It gets harder the deeper you get.</div>
                  </div>

                  <div className="df-pvf-card-badge">
                    <div className="df-pvf-card-badge-header">
                      <LadderIconSameBoard />
                      <span className="df-pvf-card-badge-title">Play again free</span>
                    </div>
                    <div className="df-pvf-card-badge-desc">Only the first run counts for the streak.</div>
                  </div>
                </div>
              </div>
            </article>
          </div>

          <section className="pvf-control-panel df-pvf-control-panel" aria-label="Puzzle Rush">
            {/* 1. Same four-tile overview grid as the ladder, Rush's data. */}
            <div className="df-pvf-section">
              <div className="fritz-section-label">1. TODAY</div>
              <div className="df-pvf-overview-grid" role="list" aria-label="Rush details">
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
                    <DplIconTrophy />
                  </div>
                  <div className="df-pvf-overview-body">
                    <div className="df-pvf-overview-value" data-ui="rush-hub-personal-best">
                      {personalBest == null ? '—' : personalBest}
                    </div>
                    <div className="df-pvf-overview-key">Personal best</div>
                  </div>
                </div>
                <div className="df-pvf-overview-card" role="listitem">
                  <div className="df-pvf-overview-icon" aria-hidden>
                    <DplIconFlame />
                  </div>
                  <div className="df-pvf-overview-body">
                    <div className="df-pvf-overview-value">{streakDays} days</div>
                    <div className="df-pvf-overview-key">Streak</div>
                  </div>
                </div>
                <div className="df-pvf-overview-card" role="listitem">
                  <div className="df-pvf-overview-icon" aria-hidden>
                    <LadderIconLeaderboard />
                  </div>
                  <div className="df-pvf-overview-body">
                    <div className="df-pvf-overview-value" data-ui="rush-hub-today-status">
                      {playedToday ? 'Played' : 'Not yet'}
                    </div>
                    <div className="df-pvf-overview-key">Today</div>
                  </div>
                </div>
              </div>
            </div>

            {/* 2. Stage preview replaces the ladder's lock/unlock slots. */}
            <div className="df-pvf-section">
              <div className="fritz-section-label">2. STAGES</div>
              <div className="df-pvf-progress-grid" role="list" aria-label="Rush stages">
                {stages.map((stage, index) => (
                  <article
                    key={stage.key}
                    role="listitem"
                    // No per-card state class on purpose. Fritz's grid dims
                    // every sibling of a `--active` card to 0.5 opacity, which
                    // is right mid-set but wrong for a preview — it made
                    // Building and Master read washed out next to Warm-Up.
                    // All three stages carry equal weight here, matching the
                    // Fritz hub's own cards.
                    className="df-pvf-progress-card df-game-card"
                    data-stage={stage.key}
                  >
                    <div className="df-pvf-progress-index" aria-hidden>
                      {index + 1}
                    </div>
                    <div className="df-pvf-progress-body">
                      <span className="df-pvf-progress-eyebrow">{`STAGE ${index + 1}`}</span>
                      <h3 className="df-pvf-progress-title">{stage.label}</h3>
                      <p className="df-pvf-progress-status">{STAGE_STATUS[stage.key] ?? ''}</p>
                      <p className="df-pvf-progress-hint">
                        Puzzles {stage.fromOrdinal}–{stage.toOrdinal}
                      </p>
                      <div className="df-pvf-progress-footer">
                        <span className="df-pvf-progress-meta">
                          {index === 0 ? 'Starts here' : `${stage.maxPointsPerPuzzle} pts each`}
                        </span>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </div>

            {/* 3. Same summary strip, Rush's run facts. */}
            <div className="df-pvf-section">
              <div className="fritz-section-label">3. RUN SUMMARY</div>
              <div className="df-pvf-summary-strip" aria-label="Run summary">
                <div className="df-pvf-summary-item">
                  <div className="df-pvf-summary-icon" aria-hidden>
                    <DplIconLayers />
                  </div>
                  <div>
                    <div className="df-pvf-summary-value">Puzzle Rush</div>
                    <div className="df-pvf-summary-key">Mode</div>
                  </div>
                </div>
                <div className="df-pvf-summary-divider" aria-hidden />
                <div className="df-pvf-summary-item">
                  <div className="df-pvf-summary-icon" aria-hidden>
                    <DplIconTrophy />
                  </div>
                  <div>
                    <div className="df-pvf-summary-value" data-ui="rush-hub-state">
                      {playedToday ? 'Played today' : 'Ready to start'}
                    </div>
                    <div className="df-pvf-summary-key">State</div>
                  </div>
                </div>
                <div className="df-pvf-summary-divider" aria-hidden />
                <div className="df-pvf-summary-item">
                  <div className="df-pvf-summary-icon" aria-hidden>
                    <LadderIconOrdered />
                  </div>
                  <div>
                    <div className="df-pvf-summary-value">{totalPuzzles}</div>
                    <div className="df-pvf-summary-key">Puzzles queued</div>
                  </div>
                </div>
                <div className="df-pvf-summary-divider" aria-hidden />
                <div className="df-pvf-summary-item">
                  <div className="df-pvf-summary-icon" aria-hidden>
                    <DplIconFlame color="var(--tier-standard)" />
                  </div>
                  <div>
                    <div className="df-pvf-summary-value">
                      {playedToday ? 'Unlimited' : 'Counts today'}
                    </div>
                    <div className="df-pvf-summary-key">Attempts</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="df-pvf-actions">
              {error ? (
                <p className="df-hub-error" role="alert" data-ui="rush-start-error">
                  {error}
                </p>
              ) : null}
              <Button
                variant="tier-standard"
                size="lg"
                type="button"
                className="df-start-match-btn df-pvf-start-btn"
                disabled={startPending}
                onClick={onStart}
                data-ui="rush-start-button"
              >
                {startPending ? 'Starting…' : playedToday ? 'Play Again' : 'Start Puzzle Rush'}
                {!startPending ? (
                  <span className="df-start-match-chevron" aria-hidden>
                    {' '}
                    ›
                  </span>
                ) : null}
              </Button>
              <div className="df-pvf-footer">
                {/* Rendered only when a leaderboard screen exists to open —
                    no button that links to nothing. */}
                {onOpenLeaderboard ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="df-pvf-leaderboard-link"
                    onClick={onOpenLeaderboard}
                  >
                    View Leaderboard →
                  </Button>
                ) : null}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default PuzzleRushHubView;
