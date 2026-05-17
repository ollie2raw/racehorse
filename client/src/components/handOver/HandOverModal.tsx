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
  const summaryBits = [
    `Winner: ${winnerLabel}`,
    `${loserLabel} · ${loserPipsLabel}`,
    clearedReveal ? `${clearedReveal.ownerLabel} cleared hand` : null,
  ].filter(Boolean) as string[];

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
            <div className="hand-over-modal__award-value">+{pointsAwarded}</div>
            <div className="hand-over-modal__award-label">{pointsLabel}</div>
          </section>
        </div>

        <section className="hand-over-modal__middle" aria-label="Hand outcome and remaining tiles">
          <div className="hand-over-modal__summary">
            <div className="hand-over-modal__summary-row">
              <span className="hand-over-modal__summary-label">Winner</span>
              <span className="hand-over-modal__summary-value">{winnerLabel}</span>
            </div>
            <div className="hand-over-modal__summary-row">
              <span className="hand-over-modal__summary-label">Remaining pips</span>
              <span className="hand-over-modal__summary-value">
                {loserLabel} <span className="hand-over-modal__summary-sep">·</span> {loserPipsLabel}
              </span>
            </div>
            {clearedReveal ? (
              <div className="hand-over-modal__summary-row hand-over-modal__summary-row--muted">
                <span className="hand-over-modal__summary-label">Cleared hand</span>
                <span className="hand-over-modal__summary-value">{clearedReveal.ownerLabel}</span>
              </div>
            ) : null}
            {secondaryReveal && !clearedReveal ? (
              <div className="hand-over-modal__summary-note">
                {secondaryReveal.ownerLabel} also shows {secondaryReveal.tiles.length} tile
                {secondaryReveal.tiles.length === 1 ? '' : 's'}.
              </div>
            ) : null}
          </div>

          <section className="hand-over-modal__tiles-section" aria-label="Remaining tiles">
            <div className="hand-over-modal__tiles-header">
              <span className="hand-over-modal__section-kicker">Remaining tiles</span>
              <span className="hand-over-modal__section-note">{summaryBits.join('  •  ')}</span>
            </div>
            {scoredReveal ? (
              <article className="hand-over-modal__tiles-panel is-scored">
                <div className="hand-over-modal__tiles-head">
                  <h4 className="hand-over-modal__tiles-owner">{scoredReveal.ownerLabel}</h4>
                  <span className="hand-over-modal__tiles-meta">
                    Scored hand · {scoredReveal.tiles.length} tile{scoredReveal.tiles.length === 1 ? '' : 's'} ·{' '}
                    {scoredReveal.pipTotal} pip{scoredReveal.pipTotal === 1 ? '' : 's'}
                  </span>
                </div>
                <RemainingTileGrid tiles={scoredReveal.tiles} />
              </article>
            ) : null}
            {secondaryReveal ? (
              <article className="hand-over-modal__tiles-panel hand-over-modal__tiles-panel--secondary">
                <div className="hand-over-modal__tiles-head">
                  <h4 className="hand-over-modal__tiles-owner">{secondaryReveal.ownerLabel}</h4>
                  <span className="hand-over-modal__tiles-meta">
                    {secondaryReveal.isScoredHand ? 'Scored hand' : 'Also revealed'} · {secondaryReveal.tiles.length} tile
                    {secondaryReveal.tiles.length === 1 ? '' : 's'} · {secondaryReveal.pipTotal} pip
                    {secondaryReveal.pipTotal === 1 ? '' : 's'}
                  </span>
                </div>
                <RemainingTileGrid tiles={secondaryReveal.tiles} />
              </article>
            ) : null}
          </section>
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
