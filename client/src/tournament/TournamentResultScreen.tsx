import './tournamentResult.css';

export interface TournamentResultScreenProps {
  championName: string | null;
  yourPlacement: string | null;
  nextTournamentCountdown: string;
  onBack: () => void;
}

export default function TournamentResultScreen(props: TournamentResultScreenProps) {
  return (
    <div className="tr-page">
      <div className="tr-shell">
        <span className="tr-kicker">Tournament Complete</span>
        <h1 className="tr-champion-title">Champion</h1>
        <h2 className="tr-champion-name">{props.championName ?? '—'}</h2>
        {props.yourPlacement ? (
          <p className="tr-placement">
            You finished: <strong>{props.yourPlacement}</strong>
          </p>
        ) : null}
        <p className="tr-countdown">
          Next tournament in <strong>{props.nextTournamentCountdown}</strong>
        </p>
        <button className="tr-back" onClick={props.onBack}>Back to Hub</button>
      </div>
    </div>
  );
}
