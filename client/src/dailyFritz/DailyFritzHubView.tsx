import { BoneyardStackIcon, GlobalNav } from '../components';
import { Button } from '../components/primitives';
import type { AppMode } from '../types';
import {
  DfIconCalendar,
  DfIconFlame,
  DfIconGlobe,
  DfIconLock,
  DfIconStar,
  DfIconSwords,
  DfIconTrophy,
  DfPvfIconCrown,
  DfPvfIconRobotNav,
} from './DailyFritzIcons';
import type { DailyFritzHubViewModel } from './dailyFritzHubViewModel';
import type { DailyFritzHistoryEntry } from './api';

export type DailyFritzHubViewProps = {
  hub: DailyFritzHubViewModel;
  heroSrc: string | null;
  hubError: string | null;
  startActionPending: boolean;
  onBack: () => void;
  onNavigate?: (mode: AppMode) => void;
  onOpenAuth: () => void;
  onOpenAccount?: () => void;
  onSetAction: () => void;
  onOpenLeaderboard: () => void;
  history: DailyFritzHistoryEntry[];
  onPractice: () => void;
};

export function DailyFritzHubView({
  hub,
  heroSrc,
  hubError,
  startActionPending,
  onBack,
  onNavigate,
  onOpenAuth,
  onOpenAccount,
  onSetAction,
  onOpenLeaderboard,
  history,
  onPractice,
}: DailyFritzHubViewProps) {
  const {
    dateLabel,
    tierLabel,
    formatLabel,
    streakLabel,
    winTarget,
    isComplete,
    isStarted,
    primaryCtaLabel,
    games,
    fritzTierShort,
    leaderboardSupportLine,
    setStatusLabel,
    setStakesLabel,
    opponentBadgeLabel,
    resetCountdownLabel,
  } = hub;

  return (
    <div className="df-page">
      <div className="home-bg" aria-hidden="true">
        <div className="home-bg__halo" />
        <div className="home-bg__domino home-bg__domino--tl" />
        <div className="home-bg__domino home-bg__domino--tr" />
        <div className="home-bg__line home-bg__line--1" />
        <div className="home-bg__line home-bg__line--2" />
        <div className="home-bg__line home-bg__line--3" />
        <div className="home-bg__texture" />
      </div>

      <GlobalNav
        currentMode="dailyFritz"
        onNavigate={onNavigate}
        onOpenAuth={onOpenAuth}
        onOpenAccount={onOpenAccount}
        activeColor="var(--tier-elite)"
      />

      <div className="df-shell df-shell--daily-fritz">
        <div className="df-layout df-pvf-layout">
          <div className="df-pvf-left-col">
            <button type="button" className="df-back-btn df-pvf-back-btn rh-back-button" onClick={onBack}>
              <span aria-hidden>←</span> Back to Home
            </button>

            <div className="df-pvf-header">
              <div className="df-pvf-label">DAILY FRITZ</div>
              <h1 className="df-pvf-title">Daily Fritz</h1>
              <p className="df-pvf-subtitle">Win two games before Fritz. Each game is first to {winTarget}.</p>
            </div>

            <article className="df-pvf-opponent-card" aria-label="Daily Fritz overview">
              {heroSrc ? (
                <img
                  src={heroSrc}
                  className="df-pvf-card-bg-img"
                  alt="Fritz waiting at the domino table"
                  decoding="async"
                />
              ) : null}
              <div className="df-pvf-card-overlay" aria-hidden />

              <div className="df-pvf-card-content">
                <div className="df-pvf-card-header">
                  <div className="df-pvf-card-eyebrow">TODAY&apos;S OPPONENT</div>
                  <h2 className="df-pvf-card-name">Fritz</h2>
                  <p className="df-pvf-card-description">Same set for everyone.</p>
                </div>

                <div className="df-pvf-card-badges">
                  <div className="df-pvf-card-badge">
                    <div className="df-pvf-card-badge-header">
                      <DfIconFlame color="var(--tier-elite)" />
                      <span className="df-pvf-card-badge-title">Daily Streak</span>
                    </div>
                    <div className="df-pvf-card-badge-desc">{streakLabel}</div>
                  </div>

                  <div className="df-pvf-card-badge">
                    <div className="df-pvf-card-badge-header">
                      <DfIconGlobe color="var(--tier-elite)" />
                      <span className="df-pvf-card-badge-title">Same Deal</span>
                    </div>
                    <div className="df-pvf-card-badge-desc">Every player gets the same hand.</div>
                  </div>

                  <div className="df-pvf-card-badge">
                    <div className="df-pvf-card-badge-header">
                      <DfPvfIconRobotNav color="var(--tier-elite)" />
                      <span className="df-pvf-card-badge-title">{opponentBadgeLabel}</span>
                    </div>
                    <div className="df-pvf-card-badge-desc">{isComplete ? leaderboardSupportLine : 'Fair, consistent, leaderboard eligible.'}</div>
                  </div>
                </div>
              </div>
            </article>
          </div>

          <section className="pvf-control-panel df-pvf-control-panel" aria-label="Today's Set">
            <div className="df-pvf-section">
              <div className="fritz-section-label">1. TODAY&apos;S SET</div>
              <div className="df-pvf-overview-grid" role="list" aria-label="Set details">
                <div className="df-pvf-overview-card" role="listitem">
                  <div className="df-pvf-overview-icon" aria-hidden>
                    <DfIconCalendar />
                  </div>
                  <div className="df-pvf-overview-body">
                    <div className="df-pvf-overview-value">{dateLabel}</div>
                    <div className="df-pvf-overview-key">Date</div>
                  </div>
                </div>
                <div className="df-pvf-overview-card df-pvf-overview-card--active" role="listitem">
                  <div className="df-pvf-overview-icon" aria-hidden>
                    <DfPvfIconCrown color="var(--tier-elite)" />
                  </div>
                  <div className="df-pvf-overview-body">
                    <div className="df-pvf-overview-value">{tierLabel}</div>
                    <div className="df-pvf-overview-key">Tier</div>
                  </div>
                </div>
                <div className="df-pvf-overview-card" role="listitem">
                  <div className="df-pvf-overview-icon" aria-hidden>
                    <DfIconSwords />
                  </div>
                  <div className="df-pvf-overview-body">
                    <div className="df-pvf-overview-value">{formatLabel}</div>
                    <div className="df-pvf-overview-key">Format</div>
                  </div>
                </div>
                <div className="df-pvf-overview-card" role="listitem">
                  <div className="df-pvf-overview-icon" aria-hidden>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                      <circle cx="12" cy="12" r="9" />
                      <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <div className="df-pvf-overview-body">
                    <div className="df-pvf-overview-value">{resetCountdownLabel}</div>
                    <div className="df-pvf-overview-key">Resets In</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="df-pvf-section">
              <div className="fritz-section-label">2. BEST OF 3</div>
              <div className="df-pvf-progress-grid" role="list" aria-label="Set progress">
                {games.map((game) => (
                  <article
                    key={game.n}
                    role="listitem"
                    className={[
                      'df-pvf-progress-card',
                      'df-game-card',
                      `df-game-card--${game.gameState}`,
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <div className="df-pvf-progress-index" aria-hidden>{game.n}</div>
                    <div className="df-pvf-progress-body">
                      <span className="df-pvf-progress-eyebrow">{`GAME ${game.n}`}</span>
                      <h3 className="df-pvf-progress-title">{`Game ${game.n}`}</h3>
                      <p className="df-pvf-progress-status">{game.statusSub}</p>
                      <p className="df-pvf-progress-hint">
                        {game.isDone ? (game.scoreLine ?? 'Complete') : (game.unlockHint ?? `First to ${winTarget}`)}
                      </p>
                      <div className="df-pvf-progress-footer">
                        <span className="df-pvf-progress-meta">
                          {game.isLocked
                            ? 'Locked'
                            : game.isNotNeeded
                              ? 'Not needed'
                              : game.isDone
                                ? 'Complete'
                                : `First to ${winTarget}`}
                        </span>
                        {game.isLocked ? (
                          <span className="df-pvf-progress-lock" aria-hidden>
                            <DfIconLock />
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </div>

            <div className="df-pvf-section">
              <div className="fritz-section-label">3. SET SUMMARY</div>
              <div className="df-pvf-summary-strip">
                <div className="df-pvf-summary-item">
                  <div className="df-pvf-summary-icon" aria-hidden>
                    <DfPvfIconRobotNav color="var(--tier-elite)" />
                  </div>
                  <div>
                    <div className="df-pvf-summary-value">Fritz {fritzTierShort}</div>
                    <div className="df-pvf-summary-key">Opponent</div>
                  </div>
                </div>
                <div className="df-pvf-summary-divider" aria-hidden />
                <div className="df-pvf-summary-item">
                  <div className="df-pvf-summary-icon" aria-hidden>
                    <BoneyardStackIcon size={22} />
                  </div>
                  <div>
                    <div className="df-pvf-summary-value">First to {winTarget}</div>
                    <div className="df-pvf-summary-key">Scoring</div>
                  </div>
                </div>
                <div className="df-pvf-summary-divider" aria-hidden />
                <div className="df-pvf-summary-item">
                  <div className="df-pvf-summary-icon" aria-hidden>
                    <DfIconTrophy />
                  </div>
                  <div>
                    <div className="df-pvf-summary-value">{setStatusLabel}</div>
                    <div className="df-pvf-summary-key">Status</div>
                  </div>
                </div>
                <div className="df-pvf-summary-divider" aria-hidden />
                <div className="df-pvf-summary-item">
                  <div className="df-pvf-summary-icon" aria-hidden>
                    <DfIconStar />
                  </div>
                  <div>
                    <div className="df-pvf-summary-value">{setStakesLabel}</div>
                    <div className="df-pvf-summary-key">Stakes</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="df-pvf-actions">
              {hubError ? (
                <p className="df-hub-error" role="alert">
                  {hubError}
                </p>
              ) : null}
              <Button
                variant="tier-elite"
                size="lg"
                type="button"
                className={[
                  'df-start-match-btn',
                  'df-pvf-start-btn',
                  !isComplete && !startActionPending && !isStarted ? 'df-start-match-btn--ready-pulse' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => void onSetAction()}
                disabled={startActionPending}
              >
                {primaryCtaLabel}
                {!isComplete ? <span className="df-start-match-chevron" aria-hidden> ›</span> : null}
              </Button>
              <div className="df-pvf-footer">
                <Button type="button" variant="ghost" className="df-pvf-leaderboard-link" onClick={() => void onOpenLeaderboard()}>
                  View Leaderboard →
                </Button>
              </div>
              {isComplete ? <Button type="button" variant="ghost" onClick={onPractice}>Practice vs Fritz</Button> : null}
              {history.length > 0 ? <section className="df-history-preview" aria-label="Recent Daily Fritz results"><h3>Recent results</h3><ul>{history.slice(0,3).map((entry)=><li key={`${entry.challenge_date}:${entry.completed_at}`}><span>{entry.challenge_date}</span><strong>{entry.won?'Win':'Loss'} · {entry.player_score}–{entry.fritz_score}{entry.verification_status === 'verified' ? '' : ' · Unranked'}</strong></li>)}</ul></section> : null}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
