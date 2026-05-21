import scoringChainArt from '../../assets/learn/scoring-open-count-chain.png';
import { OpenCountCalc } from '../LearnHowToPlayDiagrams';

/** Image 2 chain: [6|2]–[2|4]–[4|6]–[6|0]–[0|4] → open ends 6 + 4 = 10 */
const SCORING_LEFT_END = 6;
const SCORING_RIGHT_END = 4;
const SCORING_OPEN_COUNT_TOTAL = SCORING_LEFT_END + SCORING_RIGHT_END;

export function ScoringOpenCountVisual() {
  return (
    <div className="learn-academy__scoring-open-count">
      <p className="learn-academy__section-label">Board + open count</p>

      <div className="learn-academy__board-frame learn-academy__board-frame--scoring">
        <div className="learn-academy__scoring-board-wrap">
          <img
            className="learn-academy__scoring-chain-art"
            src={scoringChainArt}
            alt="Domino chain: six-two, two-four, four-six, six-blank, blank-four"
            draggable={false}
          />
        </div>
        <div className="learn-academy__scoring-ends-row">
          <div className="learn-academy__scoring-end learn-academy__scoring-end--active">
            <span className="learn-academy__scoring-end-label">left end</span>
            <span className="learn-academy__scoring-end-value">{SCORING_LEFT_END}</span>
          </div>
          <p className="learn-academy__scoring-ends-caption">Active scoring ends set your open count.</p>
          <div className="learn-academy__scoring-end learn-academy__scoring-end--active">
            <span className="learn-academy__scoring-end-label">right end</span>
            <span className="learn-academy__scoring-end-value">{SCORING_RIGHT_END}</span>
          </div>
        </div>
      </div>

      <div className="learn-academy__calc-frame">
        <OpenCountCalc
          parts={[
            { label: 'left', value: SCORING_LEFT_END },
            { label: 'right', value: SCORING_RIGHT_END },
          ]}
          total={SCORING_OPEN_COUNT_TOTAL}
          scores
          stacked
          scoreLine="2 race points"
        />
      </div>
    </div>
  );
}
