import type { ReactNode } from 'react';
import { GameOverlayPortal } from '../components/GameOverlayPortal';
import '../styles/dossierRecord.css';

export type PlayVsFritzResultOverlayProps = {
  won: boolean;
  opponentLabel: string;
  dealSize: number;
  youScore: number;
  botScore: number;
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
  /** Shown below stats while deferred post-game analysis runs. */
  statusNote?: ReactNode;
  /** Re-open post-game review prompt after dismissal or reviewer close. */
  showReviewGame?: boolean;
  onReviewGame?: () => void;
};

export function PlayVsFritzResultOverlay({
  won,
  opponentLabel,
  dealSize,
  youScore,
  botScore,
  ratingSlot,
  onRematch,
  onChangeSetup,
  onHome,
  showHome = false,
  customActions,
  statusNote,
  showReviewGame = false,
  onReviewGame,
}: PlayVsFritzResultOverlayProps) {
  const margin = Math.abs(youScore - botScore);
  const marginTone = won ? 'is-win' : 'is-loss';

  return (
    <GameOverlayPortal>
      <div className="game-over-overlay df-result-overlay" role="dialog" aria-label="Play vs Fritz result">
        <div className="dfd" onClick={(event) => event.stopPropagation()}>
          <div className="dfd__body">
            <header>
              <span className="dfd__eyebrow">Play vs Fritz</span>
              <h2 className="dfd__headline">{won ? 'Victory' : 'Defeat'}</h2>
              <p className="dfd__sub">
                {won
                  ? `You beat ${opponentLabel} in ${dealSize}-tile play.`
                  : `${opponentLabel} took the match in ${dealSize}-tile play.`}
              </p>
            </header>

            <dl className="dfd__stats" aria-label="Match summary">
              <div className="dfd__stat">
                <dt>Final score</dt>
                <dd className={marginTone}>
                  {youScore}-{botScore}
                </dd>
              </div>
              <div className="dfd__stat">
                <dt>Margin</dt>
                <dd className={marginTone}>
                  {won ? '+' : '-'}
                  {margin}
                </dd>
              </div>
              <div className="dfd__stat">
                <dt>Deal</dt>
                <dd>{dealSize}-Tile</dd>
              </div>
              <div className="dfd__stat">
                <dt>Result</dt>
                <dd className={won ? 'is-accent' : 'is-loss'}>{won ? 'Win' : 'Loss'}</dd>
              </div>
            </dl>

            <div className="dfd__standings" aria-label="Final standings">
              <div className="dfd__standing">
                <span>
                  You
                  {won ? <span className="dfd__tag">Winner</span> : null}
                </span>
                <span className={`dfd__standing-score${won ? ' is-win' : ' is-loss'}`}>{youScore}</span>
              </div>
              <div className="dfd__standing">
                <span>
                  {opponentLabel}
                  {!won ? <span className="dfd__tag">Winner</span> : null}
                </span>
                <span className={`dfd__standing-score${!won ? ' is-win' : ' is-loss'}`}>{botScore}</span>
              </div>
            </div>

            {ratingSlot ? (
              <div className="dfd__meta">
                <span className="dfd__meta-label">Rating</span>
                {ratingSlot}
              </div>
            ) : null}

            {statusNote ? <p className="dfd__note">{statusNote}</p> : null}

            {showReviewGame && onReviewGame ? (
              <button type="button" className="dfd__link" onClick={onReviewGame}>
                Review game ↗
              </button>
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
                  <button type="button" className="dfd__btn dfd__btn--primary" onClick={onRematch}>
                    Rematch
                  </button>
                  <div className="dfd__row">
                    <button type="button" className="dfd__btn" onClick={onChangeSetup}>
                      Change Setup
                    </button>
                    {showHome && onHome ? (
                      <button type="button" className="dfd__btn" onClick={onHome}>
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
