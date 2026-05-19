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
  const pointsLabel = `Point${pointsAwarded === 1 ? '' : 's'} awarded`;
  const loserPipsLabel =
    typeof loserPips === 'number'
      ? `${loserPips} pip${loserPips === 1 ? '' : 's'} left`
      : 'Hand complete';
  const scoredReveal = tileReveals.find((reveal) => reveal.isScoredHand && reveal.tiles.length > 0) ?? null;
  const secondaryReveal = tileReveals.find(
    (reveal) => reveal !== scoredReveal && reveal.tiles.length > 0,
  ) ?? null;
  const clearedReveal = tileReveals.find((reveal) => reveal.tiles.length === 0) ?? null;
  const leftoverPipsValue =
    typeof loserPips === 'number' ? `${loserPips}` : '—';
  const tilesStageNote = secondaryReveal && !clearedReveal
    ? `${secondaryReveal.ownerLabel} also reveals ${secondaryReveal.tiles.length} tile${
        secondaryReveal.tiles.length === 1 ? '' : 's'
      } after the scoring hand.`
    : winnerSide === 'tie'
      ? 'Both hands are shown because the block was resolved on combined pips.'
      : `${winnerLabel} takes ${pointsAwarded} point${
          pointsAwarded === 1 ? '' : 's'
        } from ${loserLabel}'s leftover pips.`;

  return (
    <div
      className="game-over-overlay hand-over-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="hand-over-modal-title"
    >
      <div
        className={`game-over-card hand-over-modal hand-over-modal--${variant} hand-over-modal--winner-${winnerSide}`}
        onClick={(event) => event.stopPropagation()}
      >
        <section className="hand-over-modal__hero-shell" aria-label="Hand result">
          <div className="hand-over-modal__hero">
            <header className="hand-over-modal__top">
              <div className="hand-over-modal__title-block">
                <p className="hand-over-modal__kicker">Hand Complete</p>
                <h3 id="hand-over-modal-title" className="hand-over-modal__title">
                  Hand Over
                </h3>
                <p className="hand-over-modal__reason">{reasonCopy}</p>
              </div>
            </header>

            <section className="hand-over-modal__award" aria-label="Points awarded this hand">
              <div className={`hand-over-modal__award-shell${pointsAwarded === 0 ? ' is-zero' : ''}`}>
                <span className="hand-over-modal__award-kicker">Points Awarded</span>
                <div className="hand-over-modal__award-value">+{pointsAwarded}</div>
                <div className="hand-over-modal__award-label">{winnerLabel}</div>
              </div>
            </section>
          </div>
        </section>

        <section className="hand-over-modal__cards" aria-label="Result summary">
          <article className="hand-over-modal__result-card">
            <span className="hand-over-modal__result-card-label">Winner</span>
            <strong className="hand-over-modal__result-card-value">{winnerLabel}</strong>
          </article>
          <article className="hand-over-modal__result-card">
            <span className="hand-over-modal__result-card-label">Scored From</span>
            <strong className="hand-over-modal__result-card-value">{loserLabel}</strong>
          </article>
          <article className="hand-over-modal__result-card">
            <span className="hand-over-modal__result-card-label">Leftover Pips</span>
            <strong className="hand-over-modal__result-card-value">{leftoverPipsValue}</strong>
          </article>
        </section>

        <section className="hand-over-modal__section hand-over-modal__section--tiles" aria-label="Remaining tiles">
          <div className="hand-over-modal__section-head">
            <div className="fritz-section-label">Remaining Tiles</div>
            {scoredReveal ? (
              <span className="hand-over-modal__tiles-chip">
                {scoredReveal.pipTotal} pip{scoredReveal.pipTotal === 1 ? '' : 's'} across {scoredReveal.tiles.length} tile
                {scoredReveal.tiles.length === 1 ? '' : 's'}
              </span>
            ) : null}
          </div>
          <div className="hand-over-modal__tiles-stage">
            <p className="hand-over-modal__tiles-stage-note">{tilesStageNote}</p>
            {scoredReveal ? (
              <article className="hand-over-modal__tiles-panel is-scored">
                <div className="hand-over-modal__tile-tray">
                  <RemainingTileGrid tiles={scoredReveal.tiles} />
                </div>
              </article>
            ) : null}
            {secondaryReveal ? (
              <article className="hand-over-modal__tiles-panel hand-over-modal__tiles-panel--secondary">
                <div className="hand-over-modal__tiles-head">
                  <div className="hand-over-modal__tiles-copy">
                    <h4 className="hand-over-modal__tiles-owner">{secondaryReveal.ownerLabel}</h4>
                    <span className="hand-over-modal__tiles-meta">
                      {secondaryReveal.isScoredHand ? 'Scored hand' : 'Also revealed'} · {secondaryReveal.pipTotal} pip
                      {secondaryReveal.pipTotal === 1 ? '' : 's'}
                    </span>
                  </div>
                </div>
                <div className="hand-over-modal__tile-tray hand-over-modal__tile-tray--secondary">
                  <RemainingTileGrid tiles={secondaryReveal.tiles} />
                </div>
              </article>
            ) : null}
          </div>
        </section>

        {learningRecap}

        {footer ??
          (showAutoAdvance ? (
            <footer className="hand-over-modal__section hand-over-modal__section--footer hand-over-modal__footer">
              <div className="hand-over-modal__footer-card">
                <div className="hand-over-modal__next-row">
                  <div className="hand-over-modal__next-copy">
                    <span className="hand-over-modal__next-label">{nextHandLabel}</span>
                    <span className="hand-over-modal__next-hint">{nextHandHint}</span>
                  </div>
                  <span className="hand-over-modal__status-pill">Auto-Advancing</span>
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
              </div>
            </footer>
          ) : null)}
      </div>
    </div>
  );
}

export default HandOverModal;
