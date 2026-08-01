import React from 'react';
import { GameOverlayPortal } from '../components/GameOverlayPortal';
import { DailyFritzFinalResultOverlay } from '../dailyFritz/DailyFritzFinalResultOverlay';
import type { DailyFritzSetOverlayViewModel } from '../dailyFritz/setOverlayViewModel';

export interface BotDailyFritzSetOverlayProps {
  overlay: DailyFritzSetOverlayViewModel | null;
  shareCopied: boolean;
  onShare: () => void;
  showPostGameOverlays: boolean;
}

export const BotDailyFritzSetOverlay: React.FC<BotDailyFritzSetOverlayProps> = ({
  overlay,
  shareCopied,
  onShare,
  showPostGameOverlays,
}) => {
  if (!showPostGameOverlays || !overlay) return null;

  if (overlay.kind === 'final') {
    return (
      <GameOverlayPortal>
        <DailyFritzFinalResultOverlay
          overlay={overlay}
          shareDone={shareCopied}
          onShare={onShare}
        />
      </GameOverlayPortal>
    );
  }

  return (
    <GameOverlayPortal>
      <div className="game-over-overlay daily-fritz-set-overlay" role="dialog" aria-label="Daily Fritz set interstitial">
        <div className="game-over-card daily-fritz-set-overlay-card" onClick={(event) => event.stopPropagation()}>
          <div className="daily-fritz-set-overlay-hero">
            <span className="daily-fritz-set-overlay-kicker">{overlay.eyebrow}</span>
            {overlay.skunkBadge ? (
              <span className="daily-fritz-skunk-badge" aria-label="Skunk result">
                {overlay.skunkBadge}
              </span>
            ) : null}
            <h2 className="daily-fritz-set-overlay-title" tabIndex={-1} autoFocus>{overlay.headline}</h2>
            <p className="daily-fritz-set-overlay-copy">{overlay.subheadline}</p>
          </div>

          <div className="daily-fritz-set-overlay-stats" aria-label="Daily Fritz set summary">
            <div className="daily-fritz-set-overlay-stat">
              <span>{overlay.gameScoreLabel || 'This game'}</span>
              <strong>{overlay.gameScoreValue || '—'}</strong>
            </div>
            <div className={`daily-fritz-set-overlay-stat${overlay.statsPending ? ' is-pending' : ''}`}>
              <span>Set Score</span>
              <strong className={overlay.statsPending ? 'is-pending' : undefined}>
                {overlay.setScoreValue || '—'}
              </strong>
            </div>
            <div className={`daily-fritz-set-overlay-stat${overlay.statsPending ? ' is-pending' : ''}`}>
              <span>Set Margin</span>
              <strong className={`is-${overlay.marginTone}${overlay.statsPending ? ' is-pending' : ''}`}>
                {overlay.marginValue || '—'}
              </strong>
            </div>
          </div>

          <div className="daily-fritz-set-overlay-tracker" aria-label="Best of three tracker">
            {overlay.tracker.map((item) => (
              <div key={item.gameNumber} className={`daily-fritz-set-overlay-step is-${item.tone}`}>
                <span>Game {item.gameNumber}</span>
                <strong>{item.label}</strong>
              </div>
            ))}
          </div>

          {overlay.objective ? (
            <div className="daily-fritz-set-overlay-objective">
              {overlay.nextLabel ? <span>{overlay.nextLabel}</span> : null}
              <p>{overlay.objective}</p>
            </div>
          ) : null}

          {overlay.errorMessage ? (
            <div className="hand-over-error-zone">
              <span className="hand-over-error-text" title={overlay.errorMessage}>
                {overlay.errorMessage}
              </span>
            </div>
          ) : null}

          <div className="daily-fritz-set-overlay-actions">
            <button
              type="button"
              className={`daily-fritz-set-overlay-primary is-${overlay.primaryTone}`}
              onClick={overlay.onPrimary}
              disabled={overlay.primaryDisabled}
            >
              {overlay.primaryLabel}
            </button>
            {overlay.secondaryLabel ? (
              <button
                type="button"
                className="daily-fritz-set-overlay-secondary"
                onClick={overlay.onSecondary}
              >
                {overlay.secondaryLabel}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </GameOverlayPortal>
  );
};
