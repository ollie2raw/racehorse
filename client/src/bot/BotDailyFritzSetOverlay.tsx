import React from 'react';
import { GameOverlayPortal } from '../components/GameOverlayPortal';
import { DailyFritzFinalResultOverlay } from '../dailyFritz/DailyFritzFinalResultOverlay';
import type { DailyFritzSetOverlayViewModel } from '../dailyFritz/setOverlayViewModel';
import '../dailyFritz/dailyFritzModalDossier.css';

export interface BotDailyFritzSetOverlayProps {
  overlay: DailyFritzSetOverlayViewModel | null;
  shareCopied: boolean;
  onShare: () => void;
  showPostGameOverlays: boolean;
}

/**
 * Between-games interstitial, in the same dossier language as the result card
 * but landscape: the game just finished on the left, where the set stands on
 * the right, so the decision and the standing are read together.
 */
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

  const marginTone =
    overlay.marginTone === 'win' ? 'is-win' : overlay.marginTone === 'loss' ? 'is-loss' : '';

  return (
    <GameOverlayPortal>
      <div
        className="game-over-overlay daily-fritz-set-overlay"
        role="dialog"
        aria-label="Daily Fritz set interstitial"
      >
        <div className="dfd dfd--wide" onClick={(event) => event.stopPropagation()}>
          <div className="dfd__split">
            <div>
              <span className="dfd__eyebrow">{overlay.gameScoreLabel || 'This game'} · Final</span>
              <h2 className="dfd__headline" tabIndex={-1} autoFocus>
                {overlay.headline}
              </h2>
              <p className="dfd__sub">{overlay.subheadline}</p>

              <dl className="dfd__pair">
                <div>
                  <dt>{overlay.gameScoreLabel || 'This game'}</dt>
                  <dd className={marginTone}>{overlay.gameScoreValue || '—'}</dd>
                </div>
                <div>
                  <dt>Set margin</dt>
                  <dd className={marginTone}>{overlay.marginValue || '—'}</dd>
                </div>
              </dl>

              {overlay.errorMessage ? (
                <p className="dfd__note" role="alert">
                  {overlay.errorMessage}
                </p>
              ) : null}
              {overlay.practiceHint ? <p className="dfd__note">{overlay.practiceHint}</p> : null}
            </div>

            <div>
              <span className="dfd__progress-label">Set progress</span>
              {overlay.tracker.map((step) => (
                <div key={step.gameNumber} className="dfd__step">
                  <span className="dfd__step-no">G{step.gameNumber}</span>
                  <span className="dfd__step-track">
                    <span className={`dfd__step-fill is-${step.tone}`} />
                  </span>
                  <span className={`dfd__step-state is-${step.tone}`}>{step.label}</span>
                </div>
              ))}

              <div className="dfd__actions">
                <button
                  type="button"
                  className="dfd__btn dfd__btn--primary"
                  onClick={overlay.onPrimary}
                  disabled={overlay.primaryDisabled}
                >
                  {overlay.primaryLabel}
                </button>
                {overlay.secondaryLabel ? (
                  <button type="button" className="dfd__btn" onClick={overlay.onSecondary}>
                    {overlay.secondaryLabel}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </GameOverlayPortal>
  );
};
