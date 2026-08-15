export type CircuitHudProps = {
  gateNumber: number;
  totalGates: number;
  score: number;
  personalBest: number;
  strikes: number;
  maxStrikes: number;
  combo: number;
  title: string;
  prompt: string;
  objective: string | null;
  gateKind: 'single_gate' | 'checkpoint_hand' | 'pressure_gate';
  stepIndex: number;
  stepCount: number;
  pressureTitle: string | null;
  stakesLine: string | null;
  transitionIn: string | null;
};

export function CircuitHud({
  gateNumber,
  totalGates,
  score,
  personalBest,
  strikes,
  maxStrikes,
  combo,
  title,
  prompt,
  objective,
  gateKind,
  stepIndex,
  stepCount,
  pressureTitle,
  stakesLine,
  transitionIn,
}: CircuitHudProps) {
  const progressPct = Math.min(100, Math.round(((gateNumber - 1) / Math.max(1, totalGates)) * 100));
  const strikesLeft = Math.max(0, maxStrikes - strikes);
  const isPressure = gateKind === 'pressure_gate' || gateKind === 'checkpoint_hand';

  return (
    <header className="rh-circuit-hud" aria-label="Circuit run status">
      <div className="rh-circuit-hud__brand">
        <p className="rh-circuit-hud__eyebrow">
          {isPressure ? 'Pressure Gate' : 'The Circuit'}
        </p>
        <h1 className="rh-circuit-hud__title">{pressureTitle || title}</h1>
        <p className="rh-circuit-hud__prompt">{prompt}</p>
        {objective || stakesLine ? (
          <p className="rh-circuit-hud__objective">{stakesLine || objective}</p>
        ) : null}
        {isPressure ? (
          <p className="rh-circuit-hud__checkpoint" aria-live="polite">
            Decision {stepIndex + 1} of {stepCount}
          </p>
        ) : null}
        {transitionIn && stepIndex > 0 ? (
          <p className="rh-circuit-hud__transition" aria-live="polite">
            {transitionIn}
          </p>
        ) : null}
      </div>

      <div className="rh-circuit-hud__meters">
        <div className="rh-circuit-meter">
          <span className="rh-circuit-meter__label">Gate</span>
          <strong className="rh-circuit-meter__value">
            {gateNumber}/{totalGates}
          </strong>
        </div>
        <div className="rh-circuit-meter">
          <span className="rh-circuit-meter__label">Score</span>
          <strong className="rh-circuit-meter__value">{score}</strong>
        </div>
        <div className="rh-circuit-meter">
          <span className="rh-circuit-meter__label">Best</span>
          <strong className="rh-circuit-meter__value">{personalBest}</strong>
        </div>
        <div className="rh-circuit-meter" aria-label={`${strikesLeft} of ${maxStrikes} strikes remaining`}>
          <span className="rh-circuit-meter__label">Strikes left</span>
          <strong className="rh-circuit-meter__value rh-circuit-meter__value--strikes">
            <span aria-hidden="true">{'●'.repeat(strikesLeft)}{'○'.repeat(Math.max(0, maxStrikes - strikesLeft))}</span>
            <span className="rh-circuit-meter__strike-text">{strikesLeft}/{maxStrikes}</span>
          </strong>
        </div>
        {combo > 1 ? (
          <div className="rh-circuit-meter">
            <span className="rh-circuit-meter__label">Combo</span>
            <strong className="rh-circuit-meter__value">×{combo}</strong>
          </div>
        ) : null}
      </div>

      <div
        className="rh-circuit-progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progressPct}
        aria-label="Circuit gate progress"
      >
        <div className="rh-circuit-progress__fill" style={{ width: `${progressPct}%` }} />
      </div>
    </header>
  );
}
