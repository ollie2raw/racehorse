import { useEffect, useRef } from 'react';
import { playMatchFoundSound } from '../utils/sound';
import type { PuzzleRushStage } from './types';

export const STAGE_TRANSITION_MS = 1400;

/**
 * The stage-transition beat.
 *
 * Two deliberate constraints, both because this is a timed mode:
 *  - It does **not** pause the clock. Stopping a rush clock for a flourish
 *    would be a gift the server's duration check wouldn't recognise anyway.
 *  - It does **not** block input (`pointer-events: none`). A player who is
 *    already reaching for the next tile is not interrupted; the beat plays
 *    over the live board and fades.
 */
export function RushStageTransition({
  stage,
  muted = false,
  onDone,
}: {
  stage: PuzzleRushStage | null;
  muted?: boolean;
  onDone?: () => void;
}) {
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const stageKey = stage?.key ?? null;

  useEffect(() => {
    if (!stageKey) return undefined;
    playMatchFoundSound(muted);
    const id = window.setTimeout(() => onDoneRef.current?.(), STAGE_TRANSITION_MS);
    return () => window.clearTimeout(id);
  }, [stageKey, muted]);

  if (!stage) return null;

  return (
    <div
      className="pr-stage-transition"
      data-ui="rush-stage-transition"
      data-stage={stage.key}
      role="status"
      aria-live="polite"
    >
      <div className="pr-stage-transition__card">
        <span className="pr-stage-transition__eyebrow">Stage {stage.fromOrdinal > 1 ? 'up' : 'start'}</span>
        <span className="pr-stage-transition__label">{stage.label}</span>
        <span className="pr-stage-transition__meta">
          {stage.maxPointsPerPuzzle} pts per puzzle
        </span>
      </div>
    </div>
  );
}

export default RushStageTransition;
