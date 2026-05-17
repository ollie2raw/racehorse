import { tournamentStageShortLabel } from './displayNames';
import './tournamentMatchHud.css';

export interface TournamentMatchHudProps {
  round: 1 | 2 | 3;
  turnLabel?: string | null;
  turnVariant?: 'your-turn' | 'opp-turn';
}

export default function TournamentMatchHud(props: TournamentMatchHudProps) {
  const stage = tournamentStageShortLabel(props.round);
  const hasTurnLabel = Boolean(props.turnLabel);

  return (
    <div className="tmh" role="status" aria-live="polite">
      <div className="daily-fritz-progress-pill" data-has-turn-label={hasTurnLabel}>
        <span className="hud-pill-label">{stage}</span>
      </div>
      {hasTurnLabel ? (
        <span className={`wl-turn-label ${props.turnVariant ?? 'your-turn'}`}>{props.turnLabel}</span>
      ) : null}
    </div>
  );
}
