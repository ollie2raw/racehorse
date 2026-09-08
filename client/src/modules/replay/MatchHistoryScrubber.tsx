import { Button } from '../../components/primitives/Button.tsx';
import type { MatchHistoryScrubberState } from './hooks/useMatchHistoryScrubber.ts';
import './MatchHistoryScrubber.css';

export interface MatchHistoryScrubberProps {
  scrubber: MatchHistoryScrubberState;
}

/**
 * View-only control strip for stepping through the current match's move history.
 * Presentational: all cursor logic lives in `useMatchHistoryScrubber`. The board
 * itself is swapped by the match view model, not rendered here.
 */
export function MatchHistoryScrubber({ scrubber }: MatchHistoryScrubberProps) {
  const {
    viewingHistory,
    position,
    total,
    viewedHandNumber,
    movesBehindLive,
    canStepBack,
    canStepForward,
    stepBack,
    stepForward,
    backToLive,
  } = scrubber;

  if (total === 0) return null;

  return (
    <div
      className={`rh-scrubber${viewingHistory ? ' rh-scrubber--viewing' : ''}`}
      data-ui="match-history-scrubber"
    >
      <Button
        variant="ghost"
        className="rh-scrubber-step"
        onClick={stepBack}
        disabled={!canStepBack}
        aria-label="Previous move"
      >
        <span aria-hidden="true">‹</span>
      </Button>

      <span className="rh-scrubber-label" aria-live="polite">
        {viewingHistory ? (
          <>
            Move {position} / {total}
            {viewedHandNumber != null ? ` · Hand ${viewedHandNumber}` : ''}
          </>
        ) : (
          'Live'
        )}
      </span>

      <Button
        variant="ghost"
        className="rh-scrubber-step"
        onClick={stepForward}
        disabled={!canStepForward}
        aria-label="Next move"
      >
        <span aria-hidden="true">›</span>
      </Button>

      {viewingHistory ? (
        <Button
          variant="secondary"
          className="rh-scrubber-live"
          onClick={backToLive}
          aria-label={
            movesBehindLive > 0
              ? `Back to live, ${movesBehindLive} new ${movesBehindLive === 1 ? 'move' : 'moves'}`
              : 'Back to live'
          }
        >
          Back to live
          {movesBehindLive > 0 ? (
            <span className="rh-scrubber-live-count">{movesBehindLive}</span>
          ) : null}
        </Button>
      ) : null}
    </div>
  );
}
