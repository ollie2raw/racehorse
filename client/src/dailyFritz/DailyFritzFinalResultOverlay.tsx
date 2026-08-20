import {
  DailyFritzFritzReaction,
  dailyFritzMoodFromMarginTone,
} from './DailyFritzFritzReaction';
import type { DailyFritzSetOverlayViewModel } from './setOverlayViewModel';

export type DailyFritzFinalResultOverlayProps = {
  overlay: DailyFritzSetOverlayViewModel;
  shareDone: boolean;
  onShare: () => void;
};

export function DailyFritzFinalResultOverlay({
  overlay,
  shareDone,
  onShare,
}: DailyFritzFinalResultOverlayProps) {
  const showMargin = Boolean(overlay.marginValue && overlay.marginValue !== '—');
  const isVictory = overlay.marginTone === 'win';
  const isDefeat = overlay.marginTone === 'loss';
  const outcomeClass = isVictory ? 'is-victory' : isDefeat ? 'is-defeat' : 'is-neutral';
  const fritzMood = dailyFritzMoodFromMarginTone(overlay.marginTone);

  return (
    <div className="game-over-overlay df-result-overlay" role="dialog" aria-label="Daily Fritz result">
      <div
        className={`game-over-card df-result-card df-result-card--celebration ${outcomeClass}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="df-result-panel">
          <DailyFritzFritzReaction mood={fritzMood} size="lg" className="df-result-fritz" />
          <header className="df-result-hero">
            <p className="df-result-eyebrow">Daily Fritz</p>
            {overlay.skunkBadge ? (
              <span className="daily-fritz-skunk-badge df-result-badge-glow" aria-label="Skunk result">
                {overlay.skunkBadge}
              </span>
            ) : null}
            <h2 className="df-result-title df-result-title-glow" tabIndex={-1} autoFocus>
              {overlay.headline}
            </h2>
            <p className="df-result-subtitle">{overlay.subheadline}</p>
          </header>

          <div className="df-result-stats" aria-label="Set summary">
            <div className={`df-result-stat${overlay.marginTone === 'win' ? ' is-victory' : overlay.marginTone === 'loss' ? ' is-defeat' : ''}`}>
              <span className="df-result-stat-label">Result</span>
              <strong
                className={`df-result-stat-value${overlay.marginTone === 'win' ? ' is-win' : overlay.marginTone === 'loss' ? ' is-loss' : ''}`}
              >
                {overlay.resultValue ?? '—'}
              </strong>
            </div>
            <div className="df-result-stat">
              <span className="df-result-stat-label">Set</span>
              <strong className="df-result-stat-value">{overlay.setScoreValue || '—'}</strong>
            </div>
            <div className="df-result-stat">
              <span className="df-result-stat-label">{overlay.rankValue ? 'Rank' : 'Margin'}</span>
              <strong
                className={`df-result-stat-value${!overlay.rankValue && overlay.marginTone === 'win' ? ' is-win' : !overlay.rankValue && overlay.marginTone === 'loss' ? ' is-loss' : ''}`}
              >
                {overlay.rankValue ?? overlay.marginValue ?? '—'}
              </strong>
            </div>
          </div>

          {overlay.games.length > 0 ? (
            <div className="df-result-games" aria-label="Per-game scores">
              <div className="df-result-games-head">
                <span className="df-result-games-label">Games</span>
              </div>
              <div className="df-result-games-well">
                {overlay.games.map((game) => (
                  <div key={game.gameNumber} className="df-result-game-row">
                    <span>Game {game.gameNumber}</span>
                    <strong className={game.tone === 'win' ? 'is-win' : 'is-loss'}>
                      {game.skunkLabel ?? game.value}
                    </strong>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {showMargin || overlay.shareRating || !!overlay.shareStreak ? (
            <div className="df-result-meta-row">
              {showMargin ? (
                <div className="df-result-meta-pill">
                  <span className="df-result-meta-label">Margin</span>
                  <span className="df-result-meta-value">{overlay.marginValue}</span>
                </div>
              ) : null}
              {overlay.shareRating ? (
                <div className="df-result-meta-pill">
                  <span className="df-result-meta-label">Rating</span>
                  <span className="df-result-meta-value">{overlay.shareRating}</span>
                </div>
              ) : null}
              {overlay.shareStreak ? (
                <div className="df-result-meta-pill">
                  <span className="df-result-meta-label">Streak</span>
                  <span className="df-result-meta-value">{overlay.shareStreak}</span>
                </div>
              ) : null}
            </div>
          ) : null}

          {overlay.errorMessage ? (
            <div className="hand-over-error-zone" role="alert">
              <span className="hand-over-error-text" title={overlay.errorMessage}>
                {overlay.errorMessage}
              </span>
            </div>
          ) : null}

          {overlay.practiceHint ? (
            <p className="daily-fritz-practice-hint">{overlay.practiceHint}</p>
          ) : null}

          <div className="df-result-actions">
            <button
              type="button"
              className="df-result-primary"
              onClick={overlay.onPrimary}
              disabled={overlay.primaryDisabled}
            >
              {overlay.primaryLabel}
            </button>
            {overlay.secondaryLabel ? (
              <button type="button" className="df-result-secondary" onClick={overlay.onSecondary}>
                {overlay.secondaryLabel}
              </button>
            ) : null}
            {overlay.tertiaryLabel ? (
              <button type="button" className="df-result-secondary" onClick={overlay.onTertiary}>{overlay.tertiaryLabel}</button>
            ) : null}
            <button type="button" className="df-result-share-btn" onClick={onShare}>
              {shareDone ? 'Copied' : 'Share Result'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
