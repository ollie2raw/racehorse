import type { BotMatchViewScoreToast } from '../../view-model/botMatchViewModelTypes.ts';

type BotMatchScoreToastOverlayProps = {
  scoreToast: BotMatchViewScoreToast;
};

function parsePoints(message: string): number | null {
  const pointsMatch = message.match(/\+(\d+)/);
  return pointsMatch ? Number(pointsMatch[1]) : null;
}

export function BotMatchScoreToastOverlay({ scoreToast }: BotMatchScoreToastOverlayProps) {
  const points = scoreToast.points ?? parsePoints(scoreToast.message);

  return (
    <div
      key={scoreToast.eventId}
      className={`rh-score-chip ${scoreToast.kind === 'notice' ? 'rh-score-chip--notice' : scoreToast.tone === 'you' ? 'rh-score-chip--you' : 'rh-score-chip--bot'}${
        scoreToast.visible ? ' is-visible' : ''
      }`}
      data-ui="score-toast"
      role="status"
      aria-live="polite"
      aria-label={scoreToast.message}
    >
      {typeof points === 'number' ? (
        <span className="rh-score-chip__value">+{points}</span>
      ) : (
        <span className="rh-score-chip__value rh-score-chip__value--text">{scoreToast.message}</span>
      )}
    </div>
  );
}
