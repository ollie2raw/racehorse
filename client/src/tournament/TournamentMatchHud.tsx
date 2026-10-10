import { tournamentStageShortLabel, type TournamentPlayerDisplay } from './displayNames';
import {
  deriveTournamentClockView,
  missedTurnWarning,
  tournamentClockLabel,
  useTournamentMatchClock,
} from './tournamentMatchClock';
import { useTournamentNow } from './useTournamentNow';
import './tournamentMatchHud.css';

export interface TournamentMatchHudProps {
  round: 1 | 2 | 3;
  /** The tournament room; only its clock is shown. */
  roomCode: string | null;
  /** The local player's seat id (the clock names seats). */
  you: string;
  isHandActive: boolean;
  isMyTurn: boolean;
  gameOver: boolean;
  opponent: TournamentPlayerDisplay | null;
}

/**
 * Tournament match HUD (Phase 3D): the stage pill, then the server's turn
 * clock when it is timing a decision — "Your turn · 32s", "Opponent's turn ·
 * 32s", "Next hand in 18s" — with the player's own missed-turn warning. When
 * the countdown reaches zero it shows "Resolving turn…" and waits for the
 * server; nothing is played, passed or forfeited here. A Fritz turn is not
 * timed by the server, so Fritz is shown thinking, never on a deadline.
 */
export default function TournamentMatchHud(props: TournamentMatchHudProps) {
  const stage = tournamentStageShortLabel(props.round);
  const snapshot = useTournamentMatchClock(props.roomCode);
  const ticking = Boolean(snapshot?.clock) && !props.gameOver;
  const nowServerMs = useTournamentNow(250, ticking);
  const view = deriveTournamentClockView({ snapshot, you: props.you, nowServerMs, gameOver: props.gameOver });
  const clockLabel = tournamentClockLabel(view);
  const warning = missedTurnWarning(view);

  let label: string | null = clockLabel;
  let tone: 'your-turn' | 'opp-turn' = view.kind === 'turn' && view.mine ? 'your-turn' : 'opp-turn';
  if (!label && props.isHandActive && !props.gameOver) {
    if (props.isMyTurn) {
      label = 'Your move';
      tone = 'your-turn';
    } else {
      label = props.opponent?.isFritz ? `${props.opponent.label} is thinking` : 'Opponent thinking';
      tone = 'opp-turn';
    }
  }
  const showBar = (view.kind === 'turn' || view.kind === 'next_hand') && !view.resolving;
  // Announced on change only (whose turn, resolving, warnings) — never every tick.
  const spoken = [
    view.kind === 'turn'
      ? view.resolving ? 'Resolving turn' : view.mine ? 'Your turn' : "Opponent's turn"
      : view.kind === 'next_hand' ? 'Next hand starting soon' : label,
    warning?.text,
  ].filter(Boolean).join('. ');

  return (
    <div className="tmh" data-clock={view.kind}>
      <span className="tmh-sr" role="status" aria-live="polite">{spoken}</span>
      <div className="daily-fritz-progress-pill" data-has-turn-label={Boolean(label)}>
        <span className="hud-pill-label">{stage}</span>
      </div>
      {label ? (
        <span className={`tmh-turn wl-turn-label rh-hud-turn ${tone}`} aria-hidden>
          <span className="tmh-turn__text">{label}</span>
          {showBar ? (
            <span className="tmh-clock-bar" aria-hidden>
              <span className="tmh-clock-bar__fill" style={{ transform: `scaleX(${view.fraction})` }} />
            </span>
          ) : null}
        </span>
      ) : null}
      {warning ? (
        <span className={`tmh-warning${warning.severe ? ' tmh-warning--severe' : ''}`} aria-hidden>
          {warning.severe ? <span aria-hidden className="tmh-warning__mark">!</span> : null}
          {warning.text}
        </span>
      ) : null}
    </div>
  );
}
