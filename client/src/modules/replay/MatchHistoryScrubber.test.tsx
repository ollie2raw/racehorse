import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MatchHistoryScrubber } from './MatchHistoryScrubber.tsx';
import { useMatchHistoryScrubber } from './hooks/useMatchHistoryScrubber.ts';
import type { MatchHistoryScrubberState } from './hooks/useMatchHistoryScrubber.ts';
import type { MoveEntry } from '../../game/moveLogger.ts';

function state(over: Partial<MatchHistoryScrubberState> = {}): MatchHistoryScrubberState {
  return {
    viewingHistory: false,
    viewingIndex: null,
    historyBoard: null,
    position: 6,
    total: 6,
    viewedHandNumber: null,
    movesBehindLive: 0,
    canStepBack: true,
    canStepForward: false,
    stepBack: vi.fn(),
    stepForward: vi.fn(),
    jumpTo: vi.fn(),
    backToLive: vi.fn(),
    ...over,
  };
}

describe('MatchHistoryScrubber', () => {
  it('renders nothing with an empty log', () => {
    const { container } = render(<MatchHistoryScrubber scrubber={state({ total: 0 })} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows Live and disables next when at live', () => {
    render(<MatchHistoryScrubber scrubber={state()} />);
    expect(screen.getByText('Live')).toBeTruthy();
    expect(screen.getByLabelText('Next move').hasAttribute('disabled')).toBe(true);
    expect(screen.queryByLabelText(/Back to live/)).toBeNull();
  });

  it('shows a compact move counter and a back-to-live control when viewing history', () => {
    const { container } = render(
      <MatchHistoryScrubber
        scrubber={state({
          viewingHistory: true,
          viewingIndex: 2,
          position: 3,
          total: 6,
          viewedHandNumber: 2,
          canStepForward: true,
          movesBehindLive: 3,
        })}
      />,
    );
    // Position / total render as discrete spans, not "Move 3 / 6" prose.
    expect(container.querySelector('.rh-scrubber-pos')?.textContent).toBe('3');
    expect(container.querySelector('.rh-scrubber-total')?.textContent).toBe('6');
    expect(screen.queryByText(/Move 3/)).toBeNull();
    // Hand detail is carried on the readout's accessible name, not visible text.
    expect(screen.getByLabelText('Move 3 of 6, hand 2')).toBeTruthy();
    expect(screen.getByText('+3', { selector: '.rh-scrubber-live-count' })).toBeTruthy();
    expect(screen.getByLabelText('Back to live, 3 new moves')).toBeTruthy();
  });

  it('wires the step and back-to-live callbacks', () => {
    const s = state({ viewingHistory: true, canStepForward: true });
    render(<MatchHistoryScrubber scrubber={s} />);
    fireEvent.click(screen.getByLabelText('Previous move'));
    fireEvent.click(screen.getByLabelText('Next move'));
    fireEvent.click(screen.getByRole('button', { name: /Back to live/ }));
    expect(s.stepBack).toHaveBeenCalledTimes(1);
    expect(s.stepForward).toHaveBeenCalledTimes(1);
    expect(s.backToLive).toHaveBeenCalledTimes(1);
  });

  it('disables previous at the first move', () => {
    render(<MatchHistoryScrubber scrubber={state({ viewingHistory: true, canStepBack: false })} />);
    expect(screen.getByLabelText('Previous move').hasAttribute('disabled')).toBe(true);
  });

  it('singularises the new-move count', () => {
    render(
      <MatchHistoryScrubber
        scrubber={state({ viewingHistory: true, movesBehindLive: 1 })}
      />,
    );
    expect(screen.getByLabelText('Back to live, 1 new move')).toBeTruthy();
  });
});

// ─── Integrated: the real component driving the real cursor hook ──────────────
// This replaces what `e2e/mid-match-scrubber.spec.ts` used to prove by clicking
// through a live Play-vs-Fritz match (flaky — see docs). The step / back-to-live
// mechanics are deterministic and need no browser; the e2e now only smoke-checks
// that the dock mounts in a real match.

function placement(moveNumber: number, handNumber = 1): MoveEntry {
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
  } as MoveEntry;
}

function Harness({ initialMoves }: { initialMoves: number }) {
  const [moveLog, setMoveLog] = useState<MoveEntry[]>(() =>
    Array.from({ length: initialMoves }, (_, i) => placement(i + 1)),
  );
  const scrubber = useMatchHistoryScrubber(moveLog);
  return (
    <div>
      <button type="button" onClick={() => setMoveLog((l) => [...l, placement(l.length + 1)])}>
        land a move
      </button>
      <MatchHistoryScrubber scrubber={scrubber} />
    </div>
  );
}

describe('MatchHistoryScrubber ↔ useMatchHistoryScrubber (integrated)', () => {
  it('starts live, steps back into history, and returns to live', () => {
    render(<Harness initialMoves={5} />);

    // Live: "Live" shown, previous enabled (5 placements), next disabled.
    expect(screen.getByText('Live')).toBeTruthy();
    expect(screen.getByLabelText('Previous move').hasAttribute('disabled')).toBe(false);
    expect(screen.getByLabelText('Next move').hasAttribute('disabled')).toBe(true);

    // Step back once → parked on the move before live (position 4 of 5).
    fireEvent.click(screen.getByLabelText('Previous move'));
    expect(screen.getByLabelText('Move 4 of 5, hand 1')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Back to live/ })).toBeTruthy();
    expect(screen.queryByText('Live', { selector: '.rh-scrubber-readout--live' })).toBeNull();

    // Step back again → position 3 of 5. Forward → back to 4 of 5.
    fireEvent.click(screen.getByLabelText('Previous move'));
    expect(screen.getByLabelText('Move 3 of 5, hand 1')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Next move'));
    expect(screen.getByLabelText('Move 4 of 5, hand 1')).toBeTruthy();

    // Back to live → "Live" again, no back-to-live control.
    fireEvent.click(screen.getByRole('button', { name: /Back to live/ }));
    expect(screen.getByText('Live', { selector: '.rh-scrubber-readout--live' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Back to live/ })).toBeNull();
  });

  it('counts moves landing while parked without snapping away from history', () => {
    render(<Harness initialMoves={4} />);
    fireEvent.click(screen.getByLabelText('Previous move')); // park on 3 of 4
    expect(screen.getByLabelText('Move 3 of 4, hand 1')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'land a move' }));
    fireEvent.click(screen.getByRole('button', { name: 'land a move' }));

    // Still parked on the same move; the back-to-live control now reports 3 behind
    // (was 1 when parked, +2 landed).
    expect(screen.getByLabelText('Move 3 of 6, hand 1')).toBeTruthy();
    expect(screen.getByLabelText('Back to live, 3 new moves')).toBeTruthy();
  });

  it('drops back to live when the log resets under the cursor', () => {
    function ResetHarness() {
      const [moveLog, setMoveLog] = useState<MoveEntry[]>(() =>
        Array.from({ length: 5 }, (_, i) => placement(i + 1)),
      );
      const scrubber = useMatchHistoryScrubber(moveLog);
      return (
        <div>
          <button type="button" onClick={() => setMoveLog([])}>reset</button>
          <MatchHistoryScrubber scrubber={scrubber} />
        </div>
      );
    }
    render(<ResetHarness />);
    fireEvent.click(screen.getByLabelText('Previous move'));
    expect(screen.getByLabelText(/Move 4 of 5/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'reset' }));
    // Empty log → the whole control unmounts.
    expect(screen.queryByLabelText('Previous move')).toBeNull();
  });
});
