import { Button } from '../../components/primitives/Button.tsx';
import type { MatchHistoryScrubberState } from './hooks/useMatchHistoryScrubber.ts';
import './MatchHistoryScrubber.css';

export interface MatchHistoryScrubberProps {
  scrubber: MatchHistoryScrubberState;
}

/**
 * Compact move-history stepper. Lives in the match top HUD beside the turn
 * pill — never in the board flow — so it can't shift the board off-centre.
 *
 * Presentational only: all cursor logic lives in `useMatchHistoryScrubber`.
 * The board itself is swapped by the consuming screen, not rendered here.
 * The expanded "Move X / Hand Y" detail is deliberately dropped from the
 * visible control (it stays in the labels) to keep the HUD from reflowing
 * while the player scrubs.
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

  const readoutTitle = viewingHistory
    ? viewedHandNumber != null
      ? `Move ${position} of ${total}, hand ${viewedHandNumber}`
      : `Move ${position} of ${total}`
    : 'Following the live board';

  const backToLiveLabel =
    movesBehindLive > 0
      ? `Back to live, ${movesBehindLive} new ${movesBehindLive === 1 ? 'move' : 'moves'}`
      : 'Back to live';

  return (
    <div
      className={`rh-scrubber rh-scrubber--docked${viewingHistory ? ' rh-scrubber--viewing' : ''}`}
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

      <span
        className={`rh-scrubber-readout${viewingHistory ? '' : ' rh-scrubber-readout--live'}`}
        aria-live="polite"
        aria-label={viewingHistory ? readoutTitle : undefined}
        title={readoutTitle}
      >
        {viewingHistory ? (
          <>
            <span className="rh-scrubber-pos">{position}</span>
            <span className="rh-scrubber-sep" aria-hidden="true">/</span>
            <span className="rh-scrubber-total">{total}</span>
          </>
        ) : (
          <>
            <span className="rh-scrubber-dot" aria-hidden="true" />
            Live
          </>
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
          variant="ghost"
          className="rh-scrubber-live"
          onClick={backToLive}
          aria-label={backToLiveLabel}
        >
          <span aria-hidden="true">⟲</span>
          {movesBehindLive > 0 ? (
            <span className="rh-scrubber-live-count">{movesBehindLive}</span>
          ) : null}
        </Button>
      ) : null}
    </div>
  );
}
