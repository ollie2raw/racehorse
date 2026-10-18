import './turnStatus.css';

/** One finite handoff cue; ownership remains legible after the motion ends. */
export function TurnStatus({ label, isYourTurn }: { label: string; isYourTurn: boolean }) {
  return (
    <span className={`wl-turn-label rh-hud-turn rh-turn-status ${isYourTurn ? 'your-turn' : 'opp-turn'}`}>
      <span key={`${isYourTurn}-${label}`} className="rh-turn-status__content">
        <span className="rh-turn-status__mark" aria-hidden="true" />
        {label}
      </span>
    </span>
  );
}
