import { Button } from '../components/primitives';
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
  /** The finished bracket, every match and score. Omitted where there is no bracket to open. */
  onViewBracket?: () => void;
}

/** "Today · 8:00 PM" and, while it is ahead, "in 2h 14m" — server time, never the device clock. */
function useNextEvent(startIso: string | null | undefined, timeZone?: string): { when: string; countdown: string | null } | null {
  const now = useTournamentNow(1000, Boolean(startIso));
  if (!startIso) return null;
  const ms = Date.parse(startIso) - now;
  return { when: formatEventWhen(startIso, now, { timeZone }), countdown: ms > 0 ? `in ${formatCountdown(ms)}` : null };
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
  const nextEvent = useNextEvent(props.nextEventStart, props.timeZone);
  const canJoin = Boolean(props.nextMatch && props.onJoinNextMatch);

  return (
    <div className="tr-page">
      <div className="tr-shell">
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
              <Button variant="tier-elite" size="lg" className="tr-action" onClick={props.onRetry}>Retry</Button>
            ) : null}
          </div>
        ) : (
          <main className="tr-layout">
            <section className="tr-hero" aria-labelledby="tr-result-title">
              <span className="tr-kicker">Tournament Complete</span>
              <h1 className="tr-champion-title" id="tr-result-title">{resultTitle}</h1>
              <p className="tr-subcopy">{resultCopy}</p>
              <div className="tr-actions">
                {canJoin ? (
                  <Button
                    variant="tier-standard"
                    size="lg"
                    className="tr-action"
                    disabled={props.joining}
                    aria-busy={props.joining}
                    onClick={() => props.onJoinNextMatch!(props.nextMatch!.matchId)}
                  >
                    {props.joining ? 'Joining…' : `Join ${tournamentStageShortLabel(props.nextMatch!.round)}`}
                  </Button>
                ) : null}
                <Button variant={canJoin ? 'outline' : 'tier-elite'} size="lg" className="tr-action" onClick={props.onNextTournament}>
                  Return to Tournament
                </Button>
                {props.onViewBracket ? (
                  <Button variant="outline" size="lg" className="tr-action" onClick={props.onViewBracket}>
                    View Bracket
                  </Button>
                ) : null}
              </div>
            </section>

            <div className="tr-stats" aria-label="Tournament result summary">
              <div className="tr-stat tr-stat--gold">
                <span className="tr-stat__label">Champion</span>
                <strong className="tr-stat__value">
                  {champion?.label ?? 'TBD'}
                  {champion?.badgeLabel ? <span className="tr-chip">{champion.badgeLabel}</span> : null}
                </strong>
                <span className="tr-stat__sub" />
              </div>
              <div className={`tr-stat ${isChampion ? 'tr-stat--gold' : isRunnerUp ? 'tr-stat--blue' : ''}`.trim()}>
                <span className="tr-stat__label">Your Finish</span>
                <strong className="tr-stat__value">{props.yourPlacement ?? '—'}</strong>
                <span className="tr-stat__sub" />
              </div>
              <div className="tr-stat tr-stat--blue">
                <span className="tr-stat__label">Next Live Event</span>
                <strong className="tr-stat__value">{nextEvent ? nextEvent.when : 'Not scheduled yet'}</strong>
                <span className="tr-stat__sub">{nextEvent?.countdown ?? ''}</span>
              </div>
            </div>
          </main>
        )}
      </div>
    </div>
  );
}
