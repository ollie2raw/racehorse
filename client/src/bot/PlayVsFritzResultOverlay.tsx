import type { ReactNode } from 'react';
import { GameOverlayPortal } from '../components/GameOverlayPortal';

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

  return (
    <GameOverlayPortal>
      <div className="game-over-overlay df-result-overlay" role="dialog" aria-label="Play vs Fritz result">
        <div className="game-over-card df-result-card" onClick={(event) => event.stopPropagation()}>
          <div className="df-result-panel">
            <header className="df-result-hero">
              <p className="df-result-eyebrow">Play vs Fritz</p>
              <h2 className="df-result-title">{won ? 'Victory' : 'Defeat'}</h2>
              <p className="df-result-subtitle">
                {won
                  ? `You beat ${opponentLabel} in ${dealSize}-tile play.`
                  : `${opponentLabel} took the match in ${dealSize}-tile play.`}
              </p>
            </header>

            <div className="df-result-stats" aria-label="Match summary">
              <div className={`df-result-stat${won ? ' is-victory' : ' is-defeat'}`}>
                <span className="df-result-stat-label">Final Score</span>
                <strong className={`df-result-stat-value${won ? ' is-win' : ' is-loss'}`}>
                  {youScore}-{botScore}
                </strong>
              </div>
              <div className="df-result-stat">
                <span className="df-result-stat-label">Margin</span>
                <strong className={`df-result-stat-value${won ? ' is-win' : ' is-loss'}`}>
                  {won ? '+' : '-'}{margin}
                </strong>
              </div>
              <div className="df-result-stat">
                <span className="df-result-stat-label">Deal</span>
                <strong className="df-result-stat-value">{dealSize}-Tile</strong>
              </div>
            </div>

            <div className="df-result-games" aria-label="Final standings">
              <div className="df-result-games-head">
                <span className="df-result-games-label">Final Standings</span>
              </div>
              <div className="df-result-games-well">
                <div className="df-result-game-row">
                  <span>
                    You{won ? ' 👑' : ''}
                  </span>
                  <strong className={won ? 'is-win' : ''}>{youScore}</strong>
                </div>
                <div className="df-result-game-row">
                  <span>
                    {opponentLabel}{!won ? ' 👑' : ''}
                  </span>
                  <strong className={!won ? 'is-win' : 'is-loss'}>{botScore}</strong>
                </div>
              </div>
            </div>

            {ratingSlot ? <div className="df-result-meta-row">{ratingSlot}</div> : null}

            {statusNote ? <p className="df-result-status-note">{statusNote}</p> : null}

            {showReviewGame && onReviewGame ? (
              <button type="button" className="df-result-review-link" onClick={onReviewGame}>
                Review game ↗
              </button>
            ) : null}

            <div className="df-result-actions">
              {customActions ? (
                customActions.map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    className={action.variant === 'primary' ? 'df-result-primary' : 'df-result-secondary'}
                    onClick={action.onClick}
                  >
                    {action.label}
                  </button>
                ))
              ) : (
                <>
                  <button type="button" className="df-result-primary" onClick={onRematch}>
                    Rematch
                  </button>
                  <button type="button" className="df-result-secondary" onClick={onChangeSetup}>
                    Change Setup
                  </button>
                  {showHome && onHome ? (
                    <button type="button" className="df-result-secondary" onClick={onHome}>
                      Home
                    </button>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </GameOverlayPortal>
  );
}
