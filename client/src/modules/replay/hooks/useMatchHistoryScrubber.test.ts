import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MoveEntry } from '../../../game/moveLogger.ts';
import { useMatchHistoryScrubber } from './useMatchHistoryScrubber.ts';

function entry(moveNumber: number, handNumber: number): MoveEntry {
  return {
    moveNumber,
    handNumber,
    player: moveNumber % 2 === 1 ? 'you' : 'opponent',
    action: 'place',
    tile: [moveNumber % 7, (moveNumber + 1) % 7],
    position: 'left',
    boardEnds: [0, 0],
    handBefore: [],
    validMoves: [],
    pipDelta: 0,
    pointsScored: 0,
    boardState: [],
    boardRenderState: null,
    handSnapshot: [],
    engineBestMove: null,
  };
}

function log(count: number, handNumber = 1): MoveEntry[] {
  return Array.from({ length: count }, (_, i) => entry(i + 1, handNumber));
}

describe('useMatchHistoryScrubber', () => {
  it('starts live (not viewing history)', () => {
    const { result } = renderHook(() => useMatchHistoryScrubber(log(4)));
    expect(result.current.viewingHistory).toBe(false);
    expect(result.current.viewingIndex).toBeNull();
    expect(result.current.movesBehindLive).toBe(0);
    expect(result.current.canStepForward).toBe(false);
    expect(result.current.canStepBack).toBe(true);
  });

  it('is inert with an empty log', () => {
    const { result } = renderHook(() => useMatchHistoryScrubber([]));
    expect(result.current.canStepBack).toBe(false);
    act(() => result.current.stepBack());
    expect(result.current.viewingIndex).toBeNull();
  });

  it('stepBack from live moves one real move back (never a no-op)', () => {
    const { result } = renderHook(() => useMatchHistoryScrubber(log(4)));
    act(() => result.current.stepBack());
    // The last move's board IS the live board, so a single back-step lands on
    // the move before it — index total-2, not total-1.
    expect(result.current.viewingHistory).toBe(true);
    expect(result.current.viewingIndex).toBe(2);
    expect(result.current.position).toBe(3);
    expect(result.current.total).toBe(4);
    expect(result.current.movesBehindLive).toBe(1);
  });

  it('steps backward and forward through the log', () => {
    const { result } = renderHook(() => useMatchHistoryScrubber(log(4)));
    act(() => result.current.stepBack());
    expect(result.current.viewingIndex).toBe(2);
    act(() => result.current.stepBack());
    expect(result.current.viewingIndex).toBe(1);
    act(() => result.current.stepForward());
    expect(result.current.viewingIndex).toBe(2);
  });

  it('stepForward onto the live move returns to live', () => {
    const { result } = renderHook(() => useMatchHistoryScrubber(log(4)));
    act(() => result.current.stepBack());
    expect(result.current.viewingIndex).toBe(2);
    act(() => result.current.stepForward());
    expect(result.current.viewingIndex).toBeNull();
    expect(result.current.viewingHistory).toBe(false);
  });

  it('needs at least two moves before stepBack does anything', () => {
    const { result } = renderHook(() => useMatchHistoryScrubber(log(1)));
    expect(result.current.canStepBack).toBe(false);
    act(() => result.current.stepBack());
    expect(result.current.viewingIndex).toBeNull();
  });

  it('does not step before the first move', () => {
    const { result } = renderHook(() => useMatchHistoryScrubber(log(3)));
    act(() => result.current.jumpTo(0));
    expect(result.current.canStepBack).toBe(false);
    act(() => result.current.stepBack());
    expect(result.current.viewingIndex).toBe(0);
  });

  it('jumpTo clamps to the viewable range (up to the move before live)', () => {
    const { result } = renderHook(() => useMatchHistoryScrubber(log(3)));
    act(() => result.current.jumpTo(99));
    expect(result.current.viewingIndex).toBe(1);
    act(() => result.current.jumpTo(-5));
    expect(result.current.viewingIndex).toBe(0);
  });

  it('backToLive clears the cursor', () => {
    const { result } = renderHook(() => useMatchHistoryScrubber(log(4)));
    act(() => result.current.jumpTo(1));
    act(() => result.current.backToLive());
    expect(result.current.viewingIndex).toBeNull();
  });

  it('reports how many moves are behind live and does not auto-snap when new moves land', () => {
    const { result, rerender } = renderHook(
      ({ entries }) => useMatchHistoryScrubber(entries),
      { initialProps: { entries: log(4) } },
    );
    act(() => result.current.jumpTo(1));
    expect(result.current.movesBehindLive).toBe(2);
    rerender({ entries: log(6) });
    // still parked on the same move
    expect(result.current.viewingIndex).toBe(1);
    expect(result.current.movesBehindLive).toBe(4);
    expect(result.current.total).toBe(6);
  });

  it('drops back to live when the log is reset (rematch / new game)', () => {
    const { result, rerender } = renderHook(
      ({ entries }) => useMatchHistoryScrubber(entries),
      { initialProps: { entries: log(5) } },
    );
    act(() => result.current.jumpTo(3));
    expect(result.current.viewingIndex).toBe(3);
    rerender({ entries: [] });
    expect(result.current.viewingIndex).toBeNull();
    expect(result.current.viewingHistory).toBe(false);
  });

  it('clamps the cursor when the log shrinks below it', () => {
    const { result, rerender } = renderHook(
      ({ entries }) => useMatchHistoryScrubber(entries),
      { initialProps: { entries: log(8) } },
    );
    act(() => result.current.jumpTo(6));
    rerender({ entries: log(3) });
    expect(result.current.viewingIndex).toBeNull();
  });

  it('exposes the viewed entry hand number for hand-boundary labelling', () => {
    const entries = [...log(3, 1), entry(4, 2), entry(5, 2)];
    const { result } = renderHook(() => useMatchHistoryScrubber(entries));
    act(() => result.current.jumpTo(4));
    expect(result.current.viewedHandNumber).toBe(2);
    act(() => result.current.jumpTo(1));
    expect(result.current.viewedHandNumber).toBe(1);
  });

  it('derives a post-move board from the viewed entry and null when live', () => {
    const entries = log(3);
    const { result } = renderHook(() => useMatchHistoryScrubber(entries));
    expect(result.current.historyBoard).toBeNull();
    act(() => result.current.jumpTo(1));
    // Projected from the viewed MoveEntry (not from live state): the entry is a
    // 'place' action, so derivePostMoveReviewBoard returns its post-action board.
    expect(result.current.historyBoard).not.toBeNull();
    expect(result.current.viewingIndex).toBe(1);
    act(() => result.current.backToLive());
    expect(result.current.historyBoard).toBeNull();
  });
});
