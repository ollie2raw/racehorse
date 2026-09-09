import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MatchHistoryScrubber } from './MatchHistoryScrubber.tsx';
import type { MatchHistoryScrubberState } from './hooks/useMatchHistoryScrubber.ts';

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
    expect(screen.getByText('3', { selector: '.rh-scrubber-live-count' })).toBeTruthy();
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
