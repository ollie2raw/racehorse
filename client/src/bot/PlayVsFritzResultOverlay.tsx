import type { ReactNode } from 'react';
import { GameOverlayPortal } from '../components/GameOverlayPortal';
import type { PostGameReviewView } from './postGameReviewView';
import '../styles/dossierRecord.css';
import './playVsFritzResult.css';

export type PlayVsFritzResultOverlayProps = {
  won: boolean;
  opponentLabel: string;
  youScore: number;
  botScore: number;
  /** A confirmed rating change, when there is one. Nothing is shown for a pending or missing update. */
  ratingSlot?: ReactNode;
  onRematch: () => void;
  onChangeSetup: () => void;
  onHome?: () => void;
  showHome?: boolean;
  /** When set, replaces default rematch/setup/home actions (e.g. Journey trial return). */
  customActions?: Array<{
    label: string;
    onClick: () => void;
    variant: 'primary' | 'secondary';
  }>;
  /** The review for this game; null when the game has none (Journey trial, ineligible). */
  review?: PostGameReviewView | null;
  onReviewGame?: () => void;
  onRetryReview?: () => void;
  /** Shown to a guest: this game is saved to the guest session, and an account keeps it. */
  savePrompt?: { text: string; actionLabel: string; onAction: () => void };
};

function ReviewPanel({ review, onRetryReview }: { review: PostGameReviewView; onRetryReview?: () => void }) {
  const percent = review.progress && review.progress.total > 0
    ? Math.min(100, Math.round((review.progress.done / review.progress.total) * 100))
    : 0;

  return (
    <section className="pvr-review" aria-label="Game review">
      <div className="pvr-review__head">
        <span className="pvr-review__label">Game review</span>
        {review.status === 'ready' && review.accuracyText ? (
          <span className="pvr-review__result">
            {review.accuracyText}
            {review.gradeText && review.gradeText !== '—' ? <span className="pvr-review__grade">{review.gradeText}</span> : null}
          </span>
        ) : null}
      </div>
      <p className="pvr-review__status" role="status">{review.statusText}</p>
      {(review.status === 'running' || review.status === 'quick' || review.status === 'stalled') && review.progress ? (
        <div
          className="pvr-review__track"
          role="progressbar"
          aria-label="Analysis progress"
          aria-valuemin={0}
          aria-valuemax={review.progress.total}
          aria-valuenow={review.progress.done}
        >
          <span className="pvr-review__fill" style={{ width: `${percent}%` }} />
        </div>
      ) : null}
      {review.note ? <p className="pvr-review__note" role="status">{review.note}</p> : null}
      {review.canRetry && onRetryReview ? (
        <button type="button" className="dfd__btn pvr-review__retry" onClick={onRetryReview} disabled={review.retrying}>
          {review.retryLabel}
        </button>
      ) : null}
    </section>
  );
}

export function PlayVsFritzResultOverlay({
  won,
  opponentLabel,
  youScore,
  botScore,
  ratingSlot,
  onRematch,
  onChangeSetup,
  onHome,
  showHome = false,
  customActions,
  review = null,
  onReviewGame,
  onRetryReview,
  savePrompt,
}: PlayVsFritzResultOverlayProps) {
  return (
    <GameOverlayPortal>
      <div className="game-over-overlay df-result-overlay" role="dialog" aria-label="Play vs Fritz result">
        <div className="dfd pvr-card" onClick={(event) => event.stopPropagation()}>
          <div className="dfd__body pvr-body">
            <header>
              <span className="dfd__eyebrow">Play vs Fritz</span>
              <h2 className="dfd__headline">{won ? 'Victory' : 'Defeat'}</h2>
              <p className="dfd__sub">
                {won
                  ? `You beat ${opponentLabel}, ${youScore}–${botScore}.`
                  : `${opponentLabel} won, ${botScore}–${youScore}.`}
              </p>
            </header>

            {review ? <ReviewPanel review={review} onRetryReview={onRetryReview} /> : null}

            {ratingSlot ? <div className="pvr-rating">{ratingSlot}</div> : null}

            {savePrompt ? (
              <>
                <p className="dfd__note">{savePrompt.text}</p>
                <button type="button" className="dfd__link" onClick={savePrompt.onAction}>
                  {savePrompt.actionLabel} ↗
                </button>
              </>
            ) : null}

            <div className="dfd__actions">
              {customActions ? (
                <>
                  {customActions
                    .filter((action) => action.variant === 'primary')
                    .map((action) => (
                      <button
                        key={action.label}
                        type="button"
                        className="dfd__btn dfd__btn--primary"
                        onClick={action.onClick}
                      >
                        {action.label}
                      </button>
                    ))}
                  <div className="dfd__row">
                    {customActions
                      .filter((action) => action.variant !== 'primary')
                      .map((action) => (
                        <button key={action.label} type="button" className="dfd__btn" onClick={action.onClick}>
                          {action.label}
                        </button>
                      ))}
                  </div>
                </>
              ) : (
                <>
                  {review && onReviewGame ? (
                    <button
                      type="button"
                      className="dfd__btn dfd__btn--primary pvr-action"
                      onClick={onReviewGame}
                      disabled={!review.canOpen}
                    >
                      Review game
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={`dfd__btn pvr-action${review && onReviewGame ? '' : ' dfd__btn--primary'}`}
                    onClick={onRematch}
                  >
                    Rematch
                  </button>
                  <div className="pvr-quiet-row">
                    <button type="button" className="pvr-quiet" onClick={onChangeSetup}>
                      Change setup
                    </button>
                    {showHome && onHome ? (
                      <button type="button" className="pvr-quiet" onClick={onHome}>
                        Home
                      </button>
                    ) : null}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </GameOverlayPortal>
  );
}
