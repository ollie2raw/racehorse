import { tournamentStageShortLabel } from './displayNames';
import './tournamentMatchHud.css';

export interface TournamentMatchHudProps {
  round: 1 | 2 | 3;
  opponentName: string;
  winTarget?: number;
}

export default function TournamentMatchHud(props: TournamentMatchHudProps) {
  const stage = tournamentStageShortLabel(props.round);
  const target = props.winTarget ?? 30;

  return (
    <div className="tmh" role="status" aria-live="polite">
      <div className="tmh__pill">
        <span className="tmh__pill-kicker">Tournament</span>
        <span className="tmh__pill-dot" aria-hidden>
          ·
        </span>
        <span className="tmh__pill-stage">{stage}</span>
      </div>
      <p className="tmh__meta">
        <span>vs {props.opponentName}</span>
        <span className="tmh__meta-sep" aria-hidden>
          ·
        </span>
        <span>First to {target}</span>
      </p>
    </div>
  );
}
