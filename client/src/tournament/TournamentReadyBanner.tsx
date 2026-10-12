import { tournamentStageShortLabel } from './displayNames';
import type { ReadyBannerMatch, ReadyBannerMode } from './readyBanner';
import './tournamentReadyBanner.css';

/**
 * "Your Semifinal is ready" — shown app-wide for the player's ready
 * tournament match (Phase 3D). Join is a tap; over another game there is no
 * Join (the player finishes or leaves that game first, through its own
 * controls). Dismissing hides this banner for this match only; the Hub still
 * offers Join.
 */
export default function TournamentReadyBanner(props: {
  match: ReadyBannerMatch;
  mode: Exclude<ReadyBannerMode, 'hidden'>;
  joining: boolean;
  onJoin: (matchId: string) => void;
  onDismiss: (matchId: string) => void;
}) {
  const stage = tournamentStageShortLabel(props.match.round);
  const inGame = props.mode === 'in_game';
  return (
    <aside
      className={`trb${inGame ? ' trb--in-game' : ''}`}
      role="status"
      aria-live="polite"
      aria-label={`Your ${stage} is ready`}
      data-match-id={props.match.matchId}
    >
      <div className="trb__text">
        <span className="trb__kicker">Tournament</span>
        <span className="trb__title">Your {stage} is ready</span>
        {inGame ? <span className="trb__sub">Finish or leave this game to join.</span> : null}
      </div>
      {!inGame ? (
        <button
          type="button"
          className="trb__join"
          disabled={props.joining}
          aria-busy={props.joining}
          aria-label={props.joining ? `Joining your ${stage}` : `Join your ${stage}`}
          onClick={() => props.onJoin(props.match.matchId)}
        >
          {props.joining ? 'Joining…' : 'Join'}
        </button>
      ) : null}
      <button
        type="button"
        className="trb__dismiss"
        aria-label="Dismiss match ready notice"
        onClick={() => props.onDismiss(props.match.matchId)}
      >
        <span aria-hidden>✕</span>
      </button>
    </aside>
  );
}
