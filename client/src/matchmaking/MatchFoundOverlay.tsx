import { useEffect, useState } from 'react';
import type { MatchFoundPayload } from './types';
import './matchFoundOverlay.css';

type Props = {
  payload: MatchFoundPayload;
  onComplete: () => void;
};

/**
 * Full-screen dramatic countdown shown after `queue:matched` fires.
 * Calls `onComplete` after the countdown reaches 0 — at that point the
 * parent should trigger the room:join.
 */
export function MatchFoundOverlay({ payload, onComplete }: Props) {
  const [secondsLeft, setSecondsLeft] = useState(Math.max(1, Math.ceil(payload.countdownMs / 1000)));

  useEffect(() => {
    if (secondsLeft <= 0) {
      onComplete();
      return;
    }
    const t = window.setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => window.clearTimeout(t);
  }, [secondsLeft, onComplete]);

  return (
    <div className="mm-found-overlay" role="dialog" aria-modal="true" aria-label="Match found">
      <div className="mm-found-card">
        <span className="mm-found-kicker">Match found</span>
        <h2 className="mm-found-headline">Get ready.</h2>
        <div className="mm-found-opponent">
          <span className="mm-found-opponent__name">{payload.opponent.username}</span>
          <span className="mm-found-opponent__rating">{Math.round(payload.opponent.rating)} ELO</span>
          {payload.opponent.isSim ? (
            <span className="mm-found-opponent__sim-badge">vs Bot (sim)</span>
          ) : null}
        </div>
        <div className="mm-found-countdown" aria-live="assertive">{secondsLeft}</div>
      </div>
    </div>
  );
}
