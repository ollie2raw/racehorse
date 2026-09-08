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
 */
export function useMatchHistoryScrubber(
  moveLog: readonly MoveEntry[],
): MatchHistoryScrubberState {
  const total = moveLog.length;
  const [viewingIndex, setViewingIndex] = useState<number | null>(null);

  // Adjust-state-on-prop-change: the log was reset or trimmed under the cursor.
  if (viewingIndex !== null && viewingIndex >= total) {
    setViewingIndex(null);
  }

  const effectiveIndex =
    viewingIndex !== null && viewingIndex < total ? viewingIndex : null;

  const stepBack = useCallback(() => {
    setViewingIndex((prev) => {
      if (prev === null || prev >= total) return total > 0 ? total - 1 : null;
      return Math.max(0, prev - 1);
    });
  }, [total]);

  const stepForward = useCallback(() => {
    setViewingIndex((prev) => {
      if (prev === null || prev >= total) return null;
      return prev + 1 >= total ? null : prev + 1;
    });
  }, [total]);

  const jumpTo = useCallback(
    (index: number) => {
      if (total === 0) return;
      setViewingIndex(Math.max(0, Math.min(total - 1, Math.trunc(index))));
    },
    [total],
  );

  const backToLive = useCallback(() => setViewingIndex(null), []);

  const historyBoard = useMemo(
    () =>
      effectiveIndex === null
        ? null
        : derivePostMoveReviewBoard(moveLog[effectiveIndex]),
    [moveLog, effectiveIndex],
  );

  return {
    viewingHistory: effectiveIndex !== null,
    viewingIndex: effectiveIndex,
    historyBoard,
    position: effectiveIndex === null ? total : effectiveIndex + 1,
    total,
    viewedHandNumber:
      effectiveIndex === null ? null : moveLog[effectiveIndex].handNumber ?? null,
    movesBehindLive: effectiveIndex === null ? 0 : total - 1 - effectiveIndex,
    canStepBack: effectiveIndex === null ? total > 0 : effectiveIndex > 0,
    canStepForward: effectiveIndex !== null,
    stepBack,
    stepForward,
    jumpTo,
    backToLive,
  };
}
