import { useCallback, useMemo, useState } from 'react';
import { derivePostMoveReviewBoard } from '../reviewBoardState.ts';
import type { MoveEntry } from '../../../game/moveLogger.ts';
import type { BoardState } from '../../../types.ts';

export interface MatchHistoryScrubberState {
  /** True while the player is parked on a past move rather than the live board. */
  viewingHistory: boolean;
  /** Index into moveLog being viewed, or null when live. */
  viewingIndex: number | null;
  /**
   * Board projection for the viewed move (post-action), or null when live —
   * the consumer renders the live board on null.
   */
  historyBoard: BoardState | null;
  /** 1-based position of the viewed move; equals `total` when live. */
  position: number;
  total: number;
  /** `handNumber` of the viewed entry, or null when live. */
  viewedHandNumber: number | null;
  /** Moves that have landed ahead of the viewed one — the "back to live" pill count. */
  movesBehindLive: number;
  canStepBack: boolean;
  canStepForward: boolean;
  stepBack: () => void;
  stepForward: () => void;
  jumpTo: (index: number) => void;
  backToLive: () => void;
}

/**
 * Owns the view-only history cursor for a live match's move log. It never
 * touches game state: `historyBoard` is a pure projection of a logged
 * `MoveEntry`, and every consumer treats a null cursor as "show live".
 *
 * New moves landing while the player views history do NOT snap them away
 * (`movesBehindLive` drives a "back to live" pill instead). A log reset
 * (rematch / new game) or a log that shrinks below the cursor forces live.
 *
 * Only tile placements are steppable — draws and passes don't move the board,
 * so stepping onto one would look like a dead click.
 */
export function useMatchHistoryScrubber(
  moveLog: readonly MoveEntry[],
): MatchHistoryScrubberState {
  const placements = useMemo(
    () => moveLog.filter((entry) => entry.action === 'place'),
    [moveLog],
  );
  const total = placements.length;
  // The last move's post-state IS the live board, so the deepest a history
  // cursor can sit is the move *before* it. "Live" is null, or any index at
  // or past the last move — stepping onto the last move means stepping to live.
  const lastIndex = total - 1;
  const deepestIndex = total - 2;
  const [viewingIndex, setViewingIndex] = useState<number | null>(null);

  // Adjust-state-on-prop-change: the log was reset or trimmed under the cursor.
  if (viewingIndex !== null && viewingIndex >= total) {
    setViewingIndex(null);
  }

  const effectiveIndex =
    viewingIndex !== null && viewingIndex < lastIndex ? viewingIndex : null;

  const stepBack = useCallback(() => {
    setViewingIndex((prev) => {
      if (deepestIndex < 0) return null; // fewer than two moves — nothing to view
      if (prev === null || prev >= lastIndex) return deepestIndex;
      return Math.max(0, prev - 1);
    });
  }, [deepestIndex, lastIndex]);

  const stepForward = useCallback(() => {
    setViewingIndex((prev) => {
      if (prev === null) return null;
      const next = prev + 1;
      return next >= lastIndex ? null : next; // stepping onto the live move = live
    });
  }, [lastIndex]);

  const jumpTo = useCallback(
    (index: number) => {
      if (total < 2) return;
      setViewingIndex(Math.max(0, Math.min(deepestIndex, Math.trunc(index))));
    },
    [deepestIndex, total],
  );

  const backToLive = useCallback(() => setViewingIndex(null), []);

  const historyBoard = useMemo(
    () =>
      effectiveIndex === null
        ? null
        : derivePostMoveReviewBoard(placements[effectiveIndex]),
    [placements, effectiveIndex],
  );

  return {
    viewingHistory: effectiveIndex !== null,
    viewingIndex: effectiveIndex,
    historyBoard,
    position: effectiveIndex === null ? total : effectiveIndex + 1,
    total,
    viewedHandNumber:
      effectiveIndex === null ? null : placements[effectiveIndex].handNumber ?? null,
    movesBehindLive: effectiveIndex === null ? 0 : total - 1 - effectiveIndex,
    canStepBack: effectiveIndex === null ? total >= 2 : effectiveIndex > 0,
    canStepForward: effectiveIndex !== null,
    stepBack,
    stepForward,
    jumpTo,
    backToLive,
  };
}
