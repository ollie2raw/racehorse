import { Button } from '../../components/primitives';
import type { CircuitRunState } from '../run/circuitRunEngine';
import {
  buildImprovementTarget,
  categoryClaimCopy,
  circuitDecisionQuality,
  deepestGateReached,
  mostCostlyDecision,
  personalBestDelta,
} from '../run/circuitRunEngine';

export type CircuitResultsViewProps = {
  run: CircuitRunState;
  onRunAgain: () => void;
  onReviewMistakes: () => void;
  onBackToSolo: () => void;
};

export function CircuitResultsView({
  run,
  onRunAgain,
  onReviewMistakes,
  onBackToSolo,
}: CircuitResultsViewProps) {
  const quality = circuitDecisionQuality(run);
  const deepest = deepestGateReached(run);
  const delta = personalBestDelta(run);
  const costly = mostCostlyDecision(run);
  const improvement = buildImprovementTarget(run);
  const strongClaim = categoryClaimCopy(run, 'strong');
  const weakClaim = categoryClaimCopy(run, 'weak');

  const deltaCopy = run.isNewPersonalBest
    ? delta > 0
      ? `New personal best by ${delta.toLocaleString()}`
      : 'New personal best'
    : delta === 0
      ? 'Matched your personal best'
      : `${Math.abs(delta).toLocaleString()} points from your best`;

  return (
    <section className="rh-circuit-results" aria-label="Circuit results">
      <p className="rh-circuit-results__eyebrow">Run complete</p>
      <h2 className="rh-circuit-results__title">
        {run.endReason === 'strikes' ? 'Three strikes' : 'Circuit cleared'}
      </h2>
      <p
        className={`rh-circuit-results__record${run.isNewPersonalBest ? ' rh-circuit-results__record--pb' : ''}`}
        role="status"
      >
        {deltaCopy}
      </p>

      <div className="rh-circuit-results__score-block">
        <span className="rh-circuit-results__score-label">Final score</span>
        <strong className="rh-circuit-results__score">{run.score.toLocaleString()}</strong>
        <span className="rh-circuit-results__pb">
          Personal best {run.personalBest.toLocaleString()}
        </span>
      </div>

      <dl className="rh-circuit-results__stats" aria-label="Decision quality">
        <div>
          <dt>Deepest gate</dt>
          <dd>{deepest}</dd>
        </div>
        <div>
          <dt>Perfect</dt>
          <dd aria-label={`${quality.perfect} of ${quality.committed} perfect decisions`}>
            {quality.perfectPct}%
          </dd>
        </div>
        <div>
          <dt>Sound</dt>
          <dd aria-label={`${quality.sound} of ${quality.committed} sound decisions`}>
            {quality.soundPct}%
          </dd>
        </div>
        <div>
          <dt>Mistakes</dt>
          <dd>{quality.mistakes}</dd>
        </div>
        <div>
          <dt>Blunders</dt>
          <dd>{quality.blunders}</dd>
        </div>
      </dl>

      {costly ? (
        <p className="rh-circuit-results__costly" role="status">
          Most costly: Gate {costly.gateNumber} · {costly.grade}
          {costly.comboBefore > 0 ? ` · broke ×${costly.comboBefore} combo` : ''}
        </p>
      ) : (
        <p className="rh-circuit-results__costly rh-circuit-results__costly--clean" role="status">
          No mistakes to review — clean decisions throughout
        </p>
      )}

      <p className="rh-circuit-results__target" role="status">
        {improvement.message}
      </p>

      {(strongClaim || weakClaim) && (
        <dl className="rh-circuit-results__cats">
          {strongClaim ? (
            <div>
              <dt>Strongest</dt>
              <dd>{strongClaim}</dd>
            </div>
          ) : null}
          {weakClaim ? (
            <div>
              <dt>Focus</dt>
              <dd>{weakClaim}</dd>
            </div>
          ) : null}
        </dl>
      )}

      <div className="rh-circuit-results__actions">
        <Button variant="tier-elite" size="lg" onClick={onRunAgain} type="button">
          Run Again
        </Button>
        <Button
          variant="secondary"
          onClick={onReviewMistakes}
          type="button"
          disabled={quality.mistakes === 0}
        >
          Review Mistakes
        </Button>
        <Button variant="ghost" onClick={onBackToSolo} type="button">
          Return to Single Player
        </Button>
      </div>
    </section>
  );
}
