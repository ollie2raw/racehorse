import type { HandAnalysis } from '../../analyzer/analysisTypes';
import { formatHandOutcome, handAccuracyLabel } from './handReviewFormat';
import './handTimeline.css';

export type HandTimelineProps = {
  hands: HandAnalysis[];
  worstHandNumber: number | null;
  opponentLabel: string;
  onSelectHand: (handNumber: number) => void;
};

export function HandTimeline({
  hands,
  worstHandNumber,
  opponentLabel,
  onSelectHand,
}: HandTimelineProps) {
  if (hands.length === 0) return null;

  return (
    <div className="htimeline" aria-label="Hand-by-hand review">
      <span className="dfd__meta-label">Review by hand</span>
      <div className="dfd__games htimeline__list">
        {hands.map((hand) => {
          const isWorst = hand.handNumber === worstHandNumber;
          const accuracyPct = Math.max(0, Math.min(100, hand.handAccuracy));
          return (
            <button
              key={hand.handNumber}
              type="button"
              className={`htimeline__row${isWorst ? ' is-worst' : ''}`}
              onClick={() => onSelectHand(hand.handNumber)}
            >
              <div className="dfd__game">
                <span className="dfd__game-no">H{hand.handNumber}</span>
                <span className="dfd__track pgr-dossier-track" aria-hidden="true">
                  <span className="pgr-dossier-track__fill" style={{ width: `${accuracyPct}%` }} />
                </span>
                <span className="dfd__game-score dfd__game-score--win">{handAccuracyLabel(hand)}</span>
                {isWorst ? <span className="dfd__game-tag">Worst</span> : null}
              </div>
              <p className="htimeline__outcome">{formatHandOutcome(hand.verdict, opponentLabel)}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
