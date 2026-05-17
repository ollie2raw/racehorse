import type { ReactNode } from 'react';
import { DominoTile } from '../DominoTile';
import type { Tile } from '../../types';
import {
  handOverTileSize,
  type HandOverTileReveal,
  type HandOverWinnerSide,
} from './handOverCopy';
import './handOverModal.css';

export type HandOverModalVariant = 'sp' | 'mp';

export type HandOverModalProps = {
  variant: HandOverModalVariant;
  pointsAwarded: number;
  reasonCopy: string;
  winnerLabel: string;
  loserLabel: string;
  winnerSide: HandOverWinnerSide;
  tileReveals: HandOverTileReveal[];
  loserPips?: number | null;
  nextHandLabel?: string;
  nextHandHint?: string;
  progress?: number;
  progressTransitionMs?: number;
  footer?: ReactNode;
  learningRecap?: ReactNode;
};

function tileKey(tile: Tile, index: number): string {
  return `${tile.low}-${tile.high}-${index}`;
}

function RemainingTileGrid({ tiles }: { tiles: Tile[] }) {
  if (tiles.length === 0) {
    return <p className="hand-over-modal__tile-empty">No tiles remaining</p>;
  }

  const size = handOverTileSize(tiles.length);

  return (
    <div className="hand-over-modal__tile-grid" aria-label={`${tiles.length} remaining tiles`}>
      {tiles.map((tile, index) => (
        <DominoTile
          key={tileKey(tile, index)}
          tile={tile}
          size={size}
          className="hand-over-modal-tile"
        />
      ))}
    </div>
  );
}


export function HandOverModal({
  variant,
  pointsAwarded,
  reasonCopy,
  winnerLabel,
  loserLabel,
  winnerSide,
  tileReveals,
  loserPips,
  nextHandLabel = 'Next hand starting...',
  nextHandHint = 'Dealing automatically',
  progress,
  progressTransitionMs,
  footer,
  learningRecap,
}: HandOverModalProps) {
  const showAutoAdvance = typeof progress === 'number';
  const clampedProgress = showAutoAdvance ? Math.max(0, Math.min(1, progress)) : 0;
  const isTie = winnerSide === 'tie' || winnerSide === 'none';
  const pointsLabel = `Point${pointsAwarded === 1 ? '' : 's'} awarded`;
  const loserPipsLabel =
    typeof loserPips === 'number'
      ? `${loserPips} pip${loserPips === 1 ? '' : 's'} left`
      : 'Hand complete';

  return (
    <div
      className="game-over-overlay hand-over-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="hand-over-modal-title"
    >
      <div
        className={`game-over-card hand-over-modal hand-over-modal--${variant}`}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="hand-over-modal__top">
          <div className="hand-over-modal__title-block">
            <p className="hand-over-modal__kicker">Hand Complete</p>
            <h3 id="hand-over-modal-title" className="hand-over-modal__title">
              Hand Over
            </h3>
          </div>
        </header>

        <section className="hand-over-modal__award" aria-label="Points awarded this hand">
          <div className="hand-over-modal__award-badge">{pointsLabel}</div>
          <div className="hand-over-modal__award-value">+{pointsAwarded}</div>
          <div className="hand-over-modal__award-label">{pointsLabel}</div>
        </section>

        <p className="hand-over-modal__reason">{reasonCopy}</p>

        <section className="hand-over-modal__outcome" aria-label="Hand outcome">
          <div className={`hand-over-modal__outcome-card ${!isTie ? 'is-winner' : ''}`}>
            <span className="hand-over-modal__outcome-label">Winner</span>
            <span className="hand-over-modal__outcome-name">{winnerLabel}</span>
            <span className="hand-over-modal__outcome-note">Takes +{pointsAwarded}</span>
          </div>
          <div className={`hand-over-modal__outcome-card ${!isTie ? 'is-loser' : ''}`}>
            <span className="hand-over-modal__outcome-label">Remaining pips</span>
            <span className="hand-over-modal__outcome-name">{loserLabel}</span>
            <span className="hand-over-modal__outcome-note">{loserPipsLabel}</span>
          </div>
        </section>

        <section className="hand-over-modal__tiles-section" aria-label="Remaining tiles">
          <div className="hand-over-modal__tiles-header">
            <span className="hand-over-modal__section-kicker">Remaining tiles</span>
            <span className="hand-over-modal__section-note">All hands revealed</span>
          </div>
          {tileReveals.map((reveal, revealIndex) => (
            <article
              key={`${reveal.ownerLabel}-${revealIndex}`}
              className={`hand-over-modal__tiles-panel ${reveal.isScoredHand ? 'is-scored' : ''}`}
            >
              <div className="hand-over-modal__tiles-head">
                <h4 className="hand-over-modal__tiles-owner">
                  {reveal.ownerLabel}
                </h4>
                <span className="hand-over-modal__tiles-meta">
                  {reveal.isScoredHand ? 'Scored hand' : 'Cleared hand'} · {reveal.tiles.length} tile
                  {reveal.tiles.length === 1 ? '' : 's'} · {reveal.pipTotal} pip
                  {reveal.pipTotal === 1 ? '' : 's'}
                </span>
              </div>
              <RemainingTileGrid tiles={reveal.tiles} />
            </article>
          ))}
        </section>

        {learningRecap}

        {footer ??
          (showAutoAdvance ? (
            <footer className="hand-over-modal__footer">
              <div className="hand-over-modal__next-row">
                <span className="hand-over-modal__next-label">{nextHandLabel}</span>
                <span className="hand-over-modal__next-hint">{nextHandHint}</span>
              </div>
              <div
                className="hand-over-modal__progress-track"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(clampedProgress * 100)}
                aria-label="Time until next hand"
              >
                <div
                  className="hand-over-modal__progress-fill"
                  style={{
                    width: `${clampedProgress * 100}%`,
                    transition: progressTransitionMs
                      ? `width ${progressTransitionMs}ms linear`
                      : undefined,
                  }}
                />
              </div>
            </footer>
          ) : null)}
      </div>
    </div>
  );
}

export default HandOverModal;
