// @vitest-environment jsdom
/**
 * The count-up primitive.
 *
 * Two behaviours matter beyond "the number moves": it must render its final
 * value when asked not to animate (so a mounted HUD never shows a wrong
 * number), and it must release its rAF handle when unmounted mid-count — a
 * results modal can be dismissed while the number is still climbing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { AnimatedScore } from './AnimatedScore';

describe('AnimatedScore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function advance(ms: number) {
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  }

  it('renders the final value immediately when no start value is given', () => {
    // The three HUD call sites rely on this: they mount mid-match with a real
    // score and must not flash a count-up from zero.
    const { container } = render(<AnimatedScore value={250} />);
    expect(container.textContent).toBe('250');
  });

  it('counts up from an explicit start value', () => {
    const { container } = render(<AnimatedScore value={250} from={0} duration={600} />);
    expect(container.textContent).toBe('0');
    advance(300);
    const mid = Number(container.textContent);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(250);
    advance(600);
    expect(container.textContent).toBe('250');
  });

  it('counts toward a value that changes while mounted', () => {
    const { container, rerender } = render(<AnimatedScore value={100} duration={600} />);
    expect(container.textContent).toBe('100');
    rerender(<AnimatedScore value={200} duration={600} />);
    advance(1000);
    expect(container.textContent).toBe('200');
  });

  it('applies a formatter to the animating number', () => {
    const { container } = render(
      <AnimatedScore value={1420} from={0} format={(n) => n.toLocaleString()} />,
    );
    advance(1000);
    expect(container.textContent).toBe((1420).toLocaleString());
  });

  it('stops scheduling frames once it settles, and stays stopped on re-render', () => {
    // This repo has shipped a fix for continuous idle work (PR #61). A counter
    // that kept re-arming its rAF after finishing would be the same failure
    // mode, so assert the loop actually stops.
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    const { rerender, container } = render(<AnimatedScore value={250} from={0} duration={600} />);

    advance(1000);
    expect(container.textContent).toBe('250');

    const framesAfterSettle = raf.mock.calls.length;
    advance(5000);
    expect(raf.mock.calls.length).toBe(framesAfterSettle);

    // A re-render with the same value must not restart the count.
    rerender(<AnimatedScore value={250} from={0} duration={600} />);
    advance(5000);
    expect(raf.mock.calls.length).toBe(framesAfterSettle);
    expect(container.textContent).toBe('250');
    raf.mockRestore();
  });

  it('releases its animation frame when unmounted mid-count', () => {
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    const { unmount, container } = render(<AnimatedScore value={250} from={0} duration={600} />);

    advance(100);
    expect(Number(container.textContent)).toBeLessThan(250);

    const cancelsBefore = cancel.mock.calls.length;
    expect(() => unmount()).not.toThrow();
    expect(cancel.mock.calls.length).toBeGreaterThan(cancelsBefore);

    // Nothing may keep ticking after teardown.
    expect(() => advance(2000)).not.toThrow();
    cancel.mockRestore();
  });
});
