import type { CSSProperties, ReactNode } from 'react';
import { DominoTile } from '../DominoTile';
import { HAND_OVER_DEFAULT_ACCENT } from '../../bot/fritzConfig';
import type { Tile } from '../../types';
import type { HandOverTileReveal, HandOverWinnerSide } from './handOverCopy';
import {
  buildRemainingTilesEvidenceNote,
  buildRemainingTilesMetric,
} from './handOverCopy';
import './handOverModal.css';

const HAND_OVER_ACCENT = HAND_OVER_DEFAULT_ACCENT;

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
  /** Extra card class — e.g. daily-fritz portal tone */
  cardClassName?: string;
};

function handOverRewardCardStyle(accentColor: string): CSSProperties {
  return {
    borderColor: accentColor,
    boxShadow: `inset 0 0 20px color-mix(in srgb, ${accentColor} 8%, transparent), 0 0 16px color-mix(in srgb, ${accentColor} 6%, transparent)`,
  };
}

function tileKey(tile: Tile, index: number): string {
  return `${tile.low}-${tile.high}-${index}`;
}

function handOverShowcaseTileSize(tileCount: number): number {
  if (tileCount <= 3) return 56;
  if (tileCount <= 6) return 48;
  if (tileCount <= 10) return 42;
  return 36;
}

const IconCrown = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z" />
  </svg>
);

const IconPips = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
    <line x1="6" y1="20" x2="6" y2="14" />
    <line x1="12" y1="20" x2="12" y2="4" />
    <line x1="18" y1="20" x2="18" y2="10" />
  </svg>
);

const IconTiles = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    <rect x="5" y="2" width="14" height="20" rx="2" />
    <line x1="5" y1="12" x2="19" y2="12" />
    <circle cx="12" cy="7" r="1.2" fill="currentColor" />
    <circle cx="12" cy="17" r="1.2" fill="currentColor" />
  </svg>
);

function RemainingTileTableau({ tiles }: { tiles: Tile[] }) {
  const size = handOverShowcaseTileSize(tiles.length);
  const compact = tiles.length <= 3;

  return (
    <div
      className={`hand-over-modal__tile-tableau${compact ? ' hand-over-modal__tile-tableau--compact' : ''}`}
      aria-label={`${tiles.length} remaining tiles`}
    >
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

function RemainingTilesSection({ reveal }: { reveal: HandOverTileReveal }) {
  if (reveal.tiles.length === 0) return null;

  return (
    <div className="hand-over-modal__tiles-section">
      <div className="hand-over-modal__tiles-head">
        <div className="fritz-section-label hand-over-modal__tiles-label">Remaining Tiles</div>
        <span className="hand-over-modal__tiles-metric">{buildRemainingTilesMetric(reveal)}</span>
      </div>
      <p className="fritz-summary-note hand-over-modal__tiles-note">
        {buildRemainingTilesEvidenceNote(reveal)}
      </p>
      <div className="hand-over-modal__tiles-well">
        <RemainingTileTableau tiles={reveal.tiles} />
      </div>
    </div>
  );
}

export function HandOverModal({
  variant,
  pointsAwarded,
  reasonCopy,
  winnerLabel,
  loserLabel: _loserLabel,
  winnerSide,
  tileReveals,
  loserPips,
  nextHandLabel = 'Next hand starting...',
  nextHandHint = 'Dealing automatically',
  progress,
  progressTransitionMs,
  footer,
  learningRecap,
  cardClassName,
}: HandOverModalProps) {
  const panelStyle = { '--pvf-dynamic-color': HAND_OVER_ACCENT } as CSSProperties;
  const showAutoAdvance = typeof progress === 'number';
  const clampedProgress = showAutoAdvance ? Math.max(0, Math.min(1, progress)) : 0;
  const scoredReveal = tileReveals.find((reveal) => reveal.isScoredHand && reveal.tiles.length > 0) ?? null;
  const secondaryReveal = tileReveals.find(
    (reveal) => reveal !== scoredReveal && reveal.tiles.length > 0,
  ) ?? null;
  const outcomeKicker =
    winnerSide === 'you'
      ? 'You Won This Hand'
      : winnerSide === 'tie'
        ? 'Hand Tied'
        : winnerSide === 'opponent' || winnerSide === 'bot'
          ? `${winnerLabel} Won This Hand`
          : 'Hand Complete';
  const leftoverPipsValue =
    typeof loserPips === 'number'
      ? `${loserPips}`
      : scoredReveal != null
        ? `${scoredReveal.pipTotal}`
        : '—';
  const tilesLeftValue = scoredReveal != null ? `${scoredReveal.tiles.length}` : '—';
  const pointsOwnerLabel = winnerLabel.toUpperCase();
  const showTilesSection = scoredReveal != null || secondaryReveal != null;
  const summaryIconColor =
    winnerSide === 'you' ? HAND_OVER_ACCENT : 'rgba(255, 255, 255, 0.72)';

  return (
    <div
      className="game-over-overlay hand-over-modal-overlay"
      data-testid="hand-over-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="hand-over-modal-title"
    >
      <div
        className={`game-over-card hand-over-modal hand-over-modal--${variant} hand-over-modal--winner-${winnerSide} tier-elite${cardClassName ? ` ${cardClassName}` : ''}`}
        style={panelStyle}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="hand-over-modal__panel">
          <header className="hand-over-modal__hero" aria-label="Hand result">
            <div className="pvf-header hand-over-modal__intro">
              <div className="pvf-label">{outcomeKicker}</div>
              <h3 id="hand-over-modal-title" className="pvf-title hand-over-modal__title">
                Hand Over
              </h3>
              <p className="pvf-subtitle hand-over-modal__subtitle">{reasonCopy}</p>
            </div>

            <div
              className="hand-over-modal__reward-card"
              aria-label="Points awarded this hand"
              style={handOverRewardCardStyle(HAND_OVER_ACCENT)}
            >
              <span className="hand-over-modal__reward-label">Points Awarded</span>
              <div
                className={`hand-over-modal__reward-value${pointsAwarded === 0 ? ' is-zero' : ''}`}
              >
                +{pointsAwarded}
              </div>
              <span className="hand-over-modal__reward-owner">{pointsOwnerLabel}</span>
            </div>
          </header>

          <div className="fritz-summary-strip fritz-summary-strip--mb-lg" aria-label="Hand summary">
            <div
              className={`fritz-summary-item${
                winnerSide === 'you' ? ' hand-over-modal__summary-item--winner' : ''
              }`}
            >
              <div className="fritz-summary-icon" style={{ color: summaryIconColor }}>
                <IconCrown />
              </div>
              <div>
                <div className="fritz-summary-value">{winnerLabel}</div>
                <div className="fritz-summary-key">Winner</div>
              </div>
            </div>
            <div className="fritz-summary-divider" aria-hidden />
            <div className="fritz-summary-item">
              <div className="fritz-summary-icon fritz-summary-icon--tile">
                <IconPips />
              </div>
              <div>
                <div className="fritz-summary-value">{leftoverPipsValue}</div>
                <div className="fritz-summary-key">Leftover Pips</div>
              </div>
            </div>
            <div className="fritz-summary-divider" aria-hidden />
            <div className="fritz-summary-item">
              <div className="fritz-summary-icon fritz-summary-icon--tile">
                <IconTiles />
              </div>
              <div>
                <div className="fritz-summary-value">{tilesLeftValue}</div>
                <div className="fritz-summary-key">Tiles Left</div>
              </div>
            </div>
          </div>

          {showTilesSection ? (
            <div className="hand-over-modal__tiles-block" aria-label="Remaining tiles">
              {scoredReveal ? <RemainingTilesSection reveal={scoredReveal} /> : null}
              {secondaryReveal ? (
                <div className="hand-over-modal__tiles-section hand-over-modal__tiles-section--secondary">
                  <div className="hand-over-modal__tiles-head">
                    <div className="fritz-section-label hand-over-modal__tiles-label">Also Revealed</div>
                    <span className="hand-over-modal__tiles-metric">
                      {buildRemainingTilesMetric(secondaryReveal)}
                    </span>
                  </div>
                  <p className="fritz-summary-note hand-over-modal__tiles-note">
                    {buildRemainingTilesEvidenceNote(secondaryReveal)}
                  </p>
                  <div className="hand-over-modal__tiles-well">
                    <RemainingTileTableau tiles={secondaryReveal.tiles} />
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {learningRecap}

          <div className="hand-over-modal__actions">
            {footer ??
              (showAutoAdvance ? (
                <footer className="hand-over-modal__footer">
                  <div className="hand-over-modal__auto-advance">
                    <div className="hand-over-modal__next-row">
                      <div className="hand-over-modal__next-copy">
                        <span className="fritz-section-label hand-over-modal__next-label">
                          {nextHandLabel}
                        </span>
                        <span className="fritz-summary-note">{nextHandHint}</span>
                      </div>
                      <span className="hand-over-modal__status-pill">Auto-Advancing</span>
                    </div>
                    <div
                      className="hand-over-modal__progress-track"
                      data-testid="hand-over-progress-track"
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
      </div>
    </div>
  );
}

export default HandOverModal;
