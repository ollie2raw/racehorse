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
  const normalizedPlacement = props.yourPlacement?.trim().toLowerCase() ?? '';
  const isChampion = normalizedPlacement === '1st' || normalizedPlacement === 'champion';
  const isRunnerUp = normalizedPlacement === '2nd' || normalizedPlacement === 'runner-up' || normalizedPlacement === 'runner up';
  const resultTitle = isChampion
    ? 'Tournament Champion'
    : isRunnerUp
      ? 'Runner-Up'
      : 'Tournament Complete';
  const resultCopy = isChampion
    ? 'You finished on top of the bracket.'
    : isRunnerUp
      ? 'You reached the final and finished second.'
      : props.yourPlacement
        ? `You finished ${props.yourPlacement}.`
        : 'The bracket is complete.';

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
            <h1 className="tr-champion-title">{resultTitle}</h1>
            <p className="tr-subcopy">{resultCopy}</p>
            <div className="tr-stats" aria-label="Tournament result summary">
              <div className="tr-stat tr-stat--gold">
                <span>Champion</span>
                <strong>{props.championName ?? '—'}</strong>
              </div>
              <div className={`tr-stat ${isChampion ? 'tr-stat--gold' : isRunnerUp ? 'tr-stat--blue' : ''}`.trim()}>
                <span>Your Finish</span>
                <strong>{props.yourPlacement ?? '—'}</strong>
              </div>
              <div className="tr-stat tr-stat--blue">
                <span>Next Tournament</span>
                <strong>{props.nextTournamentCountdown}</strong>
              </div>
            </div>
            <button className="tr-back" onClick={props.onNextTournament}>Return to Tournament</button>
          </div>
        )}
      </div>
    </div>
  );
}
