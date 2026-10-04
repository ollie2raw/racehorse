import { DominoTile } from '../../components/DominoTile';
import type { Tile } from '../../types';

/**
 * Chain [6|2]–[2|4]–[4|6]–[6|0]–[0|4] → open ends 6 + 4. Drawn with the real
 * board tile (not the old baked image, whose 2s had black pips) so pip
 * colours always match the game. `flipped` puts the high pip on the left.
 */
const SCORING_CHAIN: Array<{ tile: Tile; flipped?: boolean; label: string }> = [
  { tile: { low: 2, high: 6 }, flipped: true, label: 'six-two' },
  { tile: { low: 2, high: 4 }, label: 'two-four' },
  { tile: { low: 4, high: 6 }, label: 'four-six' },
  { tile: { low: 0, high: 6 }, flipped: true, label: 'six-blank' },
  { tile: { low: 0, high: 4 }, label: 'blank-four' },
];
const SCORING_LEFT_END = 6;
const SCORING_RIGHT_END = 4;

export function ScoringOpenCountVisual() {
  return (
    <div className="learn-academy__scoring-open-count">
      <div className="learn-academy__scoring-stage">
        <div className="learn-academy__scoring-end learn-academy__scoring-end--active">
          <span className="learn-academy__scoring-end-label">left end</span>
          <span className="learn-academy__scoring-end-value">{SCORING_LEFT_END}</span>
        </div>

        <div className="learn-academy__scoring-chain-wrap">
          <div
            className="learn-academy__scoring-chain"
            role="img"
            aria-label={`Domino chain: ${SCORING_CHAIN.map((entry) => entry.label).join(', ')}`}
          >
            {SCORING_CHAIN.map((entry) => (
              <DominoTile key={entry.label} tile={entry.tile} flipped={entry.flipped} size={60} />
            ))}
          </div>
        </div>

        <div className="learn-academy__scoring-end learn-academy__scoring-end--active">
          <span className="learn-academy__scoring-end-label">right end</span>
          <span className="learn-academy__scoring-end-value">{SCORING_RIGHT_END}</span>
        </div>
      </div>
    </div>
  );
}
