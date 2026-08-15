import { Button } from '../../components/primitives';
import type { CircuitDecisionRecord } from '../run/circuitRunEngine';

export type CircuitFeedbackProps = {
  outcome: CircuitDecisionRecord;
  onContinue: () => void;
  pressureCompletionLine?: string | null;
  isPressureStepComplete?: boolean;
};

const GRADE_LABEL: Record<CircuitDecisionRecord['grade'], string> = {
  optimal: 'Optimal',
  strong: 'Strong',
  inaccurate: 'Inaccurate',
  blunder: 'Blunder',
};

function formatMove(move: CircuitDecisionRecord['chosenMove']): string {
  return `[${move.tile.low}|${move.tile.high}] → ${move.position}`;
}

export function CircuitFeedbackBanner({
  outcome,
  onContinue,
  pressureCompletionLine = null,
  isPressureStepComplete = false,
}: CircuitFeedbackProps) {
  const choseOptimal =
    outcome.chosenMove.tile.low === outcome.optimalMove.tile.low &&
    outcome.chosenMove.tile.high === outcome.optimalMove.tile.high &&
    outcome.chosenMove.position === outcome.optimalMove.position;

  return (
    <div
      className={`rh-circuit-feedback rh-circuit-feedback--${outcome.grade}`}
      role="status"
      aria-live="polite"
    >
      <div className="rh-circuit-feedback__copy">
        <p className="rh-circuit-feedback__grade">
          {GRADE_LABEL[outcome.grade]}
          {outcome.strike ? ' · Strike' : ''}
        </p>
        <p className="rh-circuit-feedback__points">
          +{outcome.pointsAwarded} points
          {outcome.comboAfter > outcome.comboBefore
            ? ` · Combo ×${outcome.comboAfter}`
            : outcome.comboBefore > 0 && outcome.comboAfter === 0
              ? ' · Combo broken'
              : ''}
        </p>
        <p className="rh-circuit-feedback__moves">
          You played {formatMove(outcome.chosenMove)}
          {!choseOptimal ? ` · Best was ${formatMove(outcome.optimalMove)}` : ''}
        </p>
        <p className="rh-circuit-feedback__explain">{outcome.explanation}</p>
        {outcome.impact ? <p className="rh-circuit-feedback__impact">{outcome.impact}</p> : null}
        {isPressureStepComplete && pressureCompletionLine ? (
          <p className="rh-circuit-feedback__pressure">{pressureCompletionLine}</p>
        ) : null}
      </div>
      <Button variant="tier-elite" onClick={onContinue} type="button">
        Continue
      </Button>
    </div>
  );
}
