import './tournamentResult.css';

export interface TournamentResultScreenProps {
  isLoading?: boolean;
  error?: string | null;
  championName: string | null;
  yourPlacement: string | null;
  nextTournamentCountdown: string;
  onRetry?: () => void;
  onNextTournament: () => void;
}

export default function TournamentResultScreen(props: TournamentResultScreenProps) {
  return (
    <div className="tr-page">
      <div className="tr-shell">
        <span className="tr-kicker">Tournament Complete</span>
        {props.isLoading ? (
          <div className="tr-card tr-card--loading" role="status" aria-live="polite">
            <div className="tr-spinner" aria-hidden />
            <span>Loading final result…</span>
          </div>
        ) : props.error ? (
          <div className="tr-card tr-card--error">
            <h1 className="tr-champion-title">Result unavailable</h1>
            <p className="tr-subcopy">{props.error}</p>
            {props.onRetry ? (
              <button className="tr-back" onClick={props.onRetry}>Retry</button>
            ) : null}
          </div>
        ) : (
          <div className="tr-card">
            <h1 className="tr-champion-title">Champion</h1>
            <h2 className="tr-champion-name">{props.championName ?? '—'}</h2>
            {props.yourPlacement ? (
              <p className="tr-placement">
                You finished: <strong>{props.yourPlacement}</strong>
              </p>
            ) : (
              <p className="tr-subcopy">The bracket is complete.</p>
            )}
            <p className="tr-countdown">
              Next tournament in <strong>{props.nextTournamentCountdown}</strong>
            </p>
            <button className="tr-back" onClick={props.onNextTournament}>Next Tournament</button>
          </div>
        )}
      </div>
    </div>
  );
}
