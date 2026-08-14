import scoringChainArt from '../../assets/learn/scoring-open-count-chain.webp';

/** Image 2 chain: [6|2]–[2|4]–[4|6]–[6|0]–[0|4] → open ends 6 + 4 */
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
          <img
            className="learn-academy__scoring-chain-art"
            src={scoringChainArt}
            alt="Domino chain: six-two, two-four, four-six, six-blank, blank-four"
            draggable={false}
          />
        </div>

        <div className="learn-academy__scoring-end learn-academy__scoring-end--active">
          <span className="learn-academy__scoring-end-label">right end</span>
          <span className="learn-academy__scoring-end-value">{SCORING_RIGHT_END}</span>
        </div>
      </div>
    </div>
  );
}
