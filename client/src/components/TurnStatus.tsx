import './turnStatus.css';

/**
 * One finite handoff cue; ownership stays legible after the motion ends through the label text and the existing
 * your-turn / opp-turn treatment. No extra glyph: anything that adds width to this pill shifts its neighbours on a
 * phone (measured: a leading dot moved the score card 2px at 740/667 wide).
 */
export function TurnStatus({ label, isYourTurn }: { label: string; isYourTurn: boolean }) {
  return (
    <span className={`wl-turn-label rh-hud-turn rh-turn-status ${isYourTurn ? 'your-turn' : 'opp-turn'}`}>
      <span key={`${isYourTurn}-${label}`} className="rh-turn-status__content">{label}</span>
    </span>
  );
}
