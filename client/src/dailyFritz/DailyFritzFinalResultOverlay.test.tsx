// @vitest-environment jsdom
/**
 * The overlay's numeric meta pills count up; its stat row does not, because
 * those values are formatted strings ("2–0", "+80", "Won") rather than numbers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { DailyFritzFinalResultOverlay } from './DailyFritzFinalResultOverlay';
import type { DailyFritzSetOverlayViewModel } from './setOverlayViewModel';

const overlay = {
  headline: 'Set won',
  subheadline: 'You beat Fritz 2–0.',
  setScoreValue: '2–0',
  marginValue: '+80',
  marginTone: 'win',
  resultValue: 'Won',
  rankValue: null,
  games: [],
  shareRating: 2230,
  shareStreak: 7,
  primaryLabel: 'Done',
  onPrimary: () => {},
} as unknown as DailyFritzSetOverlayViewModel;

describe('DailyFritzFinalResultOverlay', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const settle = () =>
    act(() => {
      vi.advanceTimersByTime(1000);
    });

  it('counts the rating and streak up rather than hard-cutting', () => {
    const { container } = render(
      <DailyFritzFinalResultOverlay overlay={overlay} shareDone={false} onShare={() => {}} />,
    );
    expect(container.textContent).not.toContain('2230');
    settle();
    expect(container.textContent).toContain('2230');
    expect(container.textContent).toContain('7');
  });

  it('leaves nothing running when dismissed mid-count', () => {
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    const { unmount } = render(
      <DailyFritzFinalResultOverlay overlay={overlay} shareDone={false} onShare={() => {}} />,
    );
    act(() => {
      vi.advanceTimersByTime(100);
    });
    const before = cancel.mock.calls.length;
    expect(() => unmount()).not.toThrow();
    expect(cancel.mock.calls.length).toBeGreaterThan(before);
    expect(() => settle()).not.toThrow();
    cancel.mockRestore();
  });
});
