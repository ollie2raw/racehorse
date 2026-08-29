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

/**
 * The set-result modal routes "Return Home" through `tertiaryLabel`, not
 * `secondaryLabel` (buildDailyFritzSetOverlayViewModel.ts:270). The dossier
 * rebuild in #64 only carried primary and secondary over, so that button
 * silently vanished from the completed-set card while still being present in
 * the view model. No path ever sets both, so at most two buttons share the row.
 */
describe('DailyFritzFinalResultOverlay — action buttons', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const withLabels = (extra: Record<string, unknown>) =>
    ({ ...overlay, ...extra }) as unknown as DailyFritzSetOverlayViewModel;

  it('renders the tertiary action the completed-set card uses for Return Home', () => {
    const { getByRole } = render(
      <DailyFritzFinalResultOverlay
        overlay={withLabels({
          primaryLabel: 'View Leaderboard',
          secondaryLabel: null,
          tertiaryLabel: 'Return Home',
          onTertiary: () => {},
        })}
        shareDone={false}
        onShare={() => {}}
      />,
    );
    expect(getByRole('button', { name: 'View Leaderboard' })).toBeTruthy();
    expect(getByRole('button', { name: 'Return Home' })).toBeTruthy();
  });

  it('gives it the same treatment as View Leaderboard, not the share button', () => {
    const { getByRole } = render(
      <DailyFritzFinalResultOverlay
        overlay={withLabels({
          primaryLabel: 'View Leaderboard',
          secondaryLabel: null,
          tertiaryLabel: 'Return Home',
          onTertiary: () => {},
        })}
        shareDone={false}
        onShare={() => {}}
      />,
    );
    const leaderboard = getByRole('button', { name: 'View Leaderboard' });
    const home = getByRole('button', { name: 'Return Home' });
    expect(home.className).toBe(leaderboard.className);
    expect(home.parentElement).toBe(leaderboard.parentElement);
  });

  it('fires onTertiary when it is pressed', () => {
    const onTertiary = vi.fn();
    const { getByRole } = render(
      <DailyFritzFinalResultOverlay
        overlay={withLabels({
          primaryLabel: 'View Leaderboard',
          secondaryLabel: null,
          tertiaryLabel: 'Return Home',
          onTertiary,
        })}
        shareDone={false}
        onShare={() => {}}
      />,
    );
    getByRole('button', { name: 'Return Home' }).click();
    expect(onTertiary).toHaveBeenCalledTimes(1);
  });

  it('renders no extra button when there is no tertiary label', () => {
    const { queryByRole, getByRole } = render(
      <DailyFritzFinalResultOverlay
        overlay={withLabels({ primaryLabel: 'Back Home', secondaryLabel: null, tertiaryLabel: null })}
        shareDone={false}
        onShare={() => {}}
      />,
    );
    expect(getByRole('button', { name: 'Back Home' })).toBeTruthy();
    expect(queryByRole('button', { name: 'Return Home' })).toBeNull();
  });
});
