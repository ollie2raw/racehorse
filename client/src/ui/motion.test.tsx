// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { AnimatedScore } from '../components/AnimatedScore';
import { FeedbackNumber } from '../components/FeedbackNumber';
import { TurnStatus } from '../components/TurnStatus';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

/** Independent review: the shared motion subscription must not leak listeners, timers or animation frames. */
describe('motion presentation resources', () => {
  it('balances every media-query and visibility listener over mount/unmount of many instances', () => {
    const media = new EventTarget();
    const mediaAdd = vi.spyOn(media, 'addEventListener');
    const mediaRemove = vi.spyOn(media, 'removeEventListener');
    vi.stubGlobal('matchMedia', () => Object.assign(media, { matches: false }));
    const docAdd = vi.spyOn(document, 'addEventListener');
    const docRemove = vi.spyOn(document, 'removeEventListener');

    const views = Array.from({ length: 40 }, (_, i) => render(
      <>
        <AnimatedScore value={i} from={0} />
        <FeedbackNumber value={i} />
        <TurnStatus label="Your move" isYourTurn />
      </>,
    ));
    views.forEach((v) => v.unmount());

    const visAdd = docAdd.mock.calls.filter(([type]) => type === 'visibilitychange').length;
    const visRemove = docRemove.mock.calls.filter(([type]) => type === 'visibilitychange').length;
    expect(visAdd).toBeGreaterThan(0);
    expect(visRemove).toBe(visAdd);
    const changeAdd = mediaAdd.mock.calls.filter(([type]) => type === 'change').length;
    expect(mediaRemove.mock.calls.filter(([type]) => type === 'change').length).toBe(changeAdd);
  });

  it('leaves no animation frame running after unmounting mid-count and never loops once settled', () => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', () => Object.assign(new EventTarget(), { matches: false }));
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    const view = render(<AnimatedScore value={50} from={0} />);
    act(() => vi.advanceTimersByTime(100));
    view.unmount();
    expect(cancel).toHaveBeenCalled();
    const frames = raf.mock.calls.length;
    act(() => vi.advanceTimersByTime(2000));
    expect(raf.mock.calls.length).toBe(frames); // nothing keeps scheduling

    // settled score: no idle frame loop at all
    const settled = render(<AnimatedScore value={7} />);
    const before = raf.mock.calls.length;
    act(() => vi.advanceTimersByTime(2000));
    expect(raf.mock.calls.length).toBe(before);
    settled.unmount();
  });

  it('settles on the exact authoritative value when scores change faster than the count', () => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', () => Object.assign(new EventTarget(), { matches: false }));
    const { container, rerender } = render(<AnimatedScore value={10} />);
    for (const v of [12, 15, 17, 22, 25]) {
      rerender(<AnimatedScore value={v} />);
      act(() => vi.advanceTimersByTime(40));
    }
    act(() => vi.advanceTimersByTime(1000));
    expect(container.textContent).toBe('25');
  });
});
