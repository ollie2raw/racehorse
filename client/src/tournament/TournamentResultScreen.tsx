import type { TournamentPlayerDisplay } from './displayNames';
import { tournamentStageShortLabel } from './displayNames';
import type { MatchOutcomeCopy } from './tournamentOutcomeCopy';
import { formatCountdown, formatEventWhen } from './tournamentTime';
import { useTournamentNow } from './useTournamentNow';
import './tournamentResult.css';

export interface TournamentResultScreenProps {
  isLoading?: boolean;
  error?: string | null;
  /** The champion via the shared display helper ("Master Fritz" + Fritz chip). */
  champion: TournamentPlayerDisplay | null;
  yourPlacement: string | null;
  /** How the player's own last match was decided, in words (from /my). */
  myOutcome?: MatchOutcomeCopy | null;
  /** The next Live Event, counted down on the server clock. */
  nextEventStart?: string | null;
  /** A ready match of this tournament: Join is a tap, never automatic. */
  nextMatch?: { matchId: string; round: 1 | 2 | 3 } | null;
  joining?: boolean;
  onJoinNextMatch?: (matchId: string) => void;
  timeZone?: string;
  onRetry?: () => void;
  onNextTournament: () => void;
}

/** "Today · 8:00 PM · in 2h 14m" — server time, never the device clock. */
function NextEventValue({ startIso, timeZone }: { startIso: string; timeZone?: string }) {
  const now = useTournamentNow(1000, true);
  const ms = Date.parse(startIso) - now;
  const when = formatEventWhen(startIso, now, { timeZone });
  return (
    <>
      {when}
      {ms > 0 ? <span className="tr-stat__sub">in {formatCountdown(ms)}</span> : null}
    </>
  );
}

export default function TournamentResultScreen(props: TournamentResultScreenProps) {
  const normalizedPlacement = props.yourPlacement?.trim().toLowerCase() ?? '';
  const isChampion = normalizedPlacement === '1st' || normalizedPlacement === 'champion';
  const isRunnerUp = normalizedPlacement === '2nd' || normalizedPlacement === 'runner-up' || normalizedPlacement === 'runner up';
  const resultTitle = isChampion
    ? 'Tournament Champion'
    : isRunnerUp
      ? 'Runner-Up'
      : props.myOutcome?.title ?? 'Tournament Complete';
  const resultCopy = props.myOutcome
    ? props.myOutcome.detail
    : isChampion
      ? 'You finished on top of the bracket.'
      : isRunnerUp
        ? 'You reached the final and finished second.'
        : props.yourPlacement
          ? `You finished ${props.yourPlacement}.`
          : 'The bracket is complete.';
  const champion = props.champion;

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
                <strong>
                  {champion?.label ?? 'TBD'}
                  {champion?.badgeLabel ? <span className="tr-chip">{champion.badgeLabel}</span> : null}
                </strong>
              </div>
              <div className={`tr-stat ${isChampion ? 'tr-stat--gold' : isRunnerUp ? 'tr-stat--blue' : ''}`.trim()}>
                <span>Your Finish</span>
                <strong>{props.yourPlacement ?? '—'}</strong>
              </div>
              <div className="tr-stat tr-stat--blue">
                <span>Next Live Event</span>
                <strong>
                  {props.nextEventStart ? <NextEventValue startIso={props.nextEventStart} timeZone={props.timeZone} /> : 'Not scheduled yet'}
                </strong>
              </div>
            </div>
            {props.nextMatch && props.onJoinNextMatch ? (
              <button
                className="tr-back tr-join"
                type="button"
                disabled={props.joining}
                aria-busy={props.joining}
                onClick={() => props.onJoinNextMatch!(props.nextMatch!.matchId)}
              >
                {props.joining ? 'Joining…' : `Join ${tournamentStageShortLabel(props.nextMatch.round)}`}
              </button>
            ) : null}
            <button className="tr-back" onClick={props.onNextTournament}>Return to Tournament</button>
          </div>
        )}
      </div>
    </div>
  );
}
