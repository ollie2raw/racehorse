import { Button } from '../../components/primitives';
import type { CircuitDecisionRecord } from '../run/circuitRunEngine';

export type CircuitReviewViewProps = {
  mistakes: readonly CircuitDecisionRecord[];
  onBack: () => void;
  onRunAgain: () => void;
};

const GRADE_LABEL: Record<CircuitDecisionRecord['grade'], string> = {
  optimal: 'Optimal',
  strong: 'Strong',
  inaccurate: 'Inaccurate',
  blunder: 'Blunder',
};

export function CircuitReviewView({ mistakes, onBack, onRunAgain }: CircuitReviewViewProps) {
  return (
    <section className="rh-circuit-review" aria-label="Circuit mistake review">
      <p className="rh-circuit-results__eyebrow">Review</p>
      <h2 className="rh-circuit-results__title">Mistakes</h2>
      {mistakes.length === 0 ? (
        <p className="rh-circuit-review__empty">No mistakes this run.</p>
      ) : (
        <ol className="rh-circuit-review__list">
          {mistakes.map((item, index) => (
            <li key={`${item.scenarioId}-${item.stepId ?? 'g'}-${index}`} className="rh-circuit-review__item">
              <div className="rh-circuit-review__meta">
                <span>Gate {item.gateNumber}</span>
                <span className={`rh-circuit-review__grade rh-circuit-review__grade--${item.grade}`}>
                  {GRADE_LABEL[item.grade]}
                </span>
              </div>
              <strong>{item.title}</strong>
              <p>
                You played [{item.chosenMove.tile.low}|{item.chosenMove.tile.high}] → {item.chosenMove.position}
              </p>
              <p>
                Best was [{item.optimalMove.tile.low}|{item.optimalMove.tile.high}] → {item.optimalMove.position}
              </p>
              <p>{item.explanation}</p>
            </li>
          ))}
        </ol>
      )}
      <div className="rh-circuit-results__actions">
        <Button variant="tier-elite" onClick={onRunAgain} type="button">
          Run Again
        </Button>
        <Button variant="ghost" onClick={onBack} type="button">
          Back to results
        </Button>
      </div>
    </section>
  );
}
