import type { HandAnalysis } from '../../analyzer/analysisTypes';
import { filledBlockCount, formatHandOutcome, handAccuracyLabel } from './handReviewFormat';
import './handTimeline.css';

export type HandTimelineProps = {
  hands: HandAnalysis[];
  worstHandNumber: number | null;
  opponentLabel: string;
  onSelectHand: (handNumber: number) => void;
};

function HandAccuracyBar({ accuracy }: { accuracy: number }) {
  const filled = filledBlockCount(accuracy);
  return (
    <div className="pgr-hand-bar" aria-hidden="true">
      {Array.from({ length: 10 }, (_, index) => (
        <span key={index} className={`pgr-hand-bar__seg${index < filled ? ' is-filled' : ''}`} />
      ))}
    </div>
  );
}

export function HandTimeline({
  hands,
  worstHandNumber,
  opponentLabel,
  onSelectHand,
}: HandTimelineProps) {
  if (hands.length === 0) return null;

  return (
    <div className="htimeline" aria-label="Hand-by-hand review">
      <span className="htimeline__label">Review by hand</span>
      <ul className="pgr-hand-list htimeline__list">
        {hands.map((hand) => {
          const isWorst = hand.handNumber === worstHandNumber;
          return (
            <li key={hand.handNumber}>
              <button
                type="button"
                className={`pgr-hand-row htimeline__row${isWorst ? ' is-worst' : ''}`}
                onClick={() => onSelectHand(hand.handNumber)}
              >
                <div className="pgr-hand-row__main">
                  <span className="pgr-hand-row__label">Hand {hand.handNumber}</span>
                  <HandAccuracyBar accuracy={hand.handAccuracy} />
                  <span className="pgr-hand-row__accuracy">{handAccuracyLabel(hand)}</span>
                </div>
                <p className="pgr-hand-row__outcome">
                  {formatHandOutcome(hand.verdict, opponentLabel)}
                  {isWorst ? <span className="pgr-hand-row__worst-tag">← worst hand</span> : null}
                </p>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
