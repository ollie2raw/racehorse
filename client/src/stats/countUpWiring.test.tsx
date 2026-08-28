// @vitest-environment jsdom
/**
 * Count-up wiring on the identity-model surfaces (Stats and public profile).
 *
 * Both mount only once their data has loaded, so the value is already known at
 * first render. The assertion that separates a real count-up from a raw render
 * is therefore that the first paint is *not* the final number.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { PlayerCompetitiveSummary } from '../identity/components/PlayerCompetitiveSummary';
import { PlayerRankedOverview } from '../stats/components/PlayerRankedOverview';
import { RankedPerformanceSection } from '../stats/components/RankedPerformanceSection';

type Competitive = Parameters<typeof PlayerCompetitiveSummary>[0]['competitive'];

const competitive = {
  rating: 1420,
  peakRating: 1480,
  globalRank: 27,
  provisional: false,
  wins: 8,
  losses: 3,
  rankedGames: 11,
  winRate: 72.7,
  currentStreak: 3,
  bestStreak: 5,
  recentForm: [],
  recentMatches: [],
} as unknown as Competitive;

describe('identity surfaces count numbers up', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const settle = () =>
    act(() => {
      vi.advanceTimersByTime(1000);
    });

  it('animates the profile rating instead of hard-cutting', () => {
    const { container } = render(<PlayerCompetitiveSummary competitive={competitive} />);
    expect(container.textContent).not.toContain('1,420');
    settle();
    expect(container.textContent).toContain('1,420');
  });

  it('animates the stats rating and keeps thousands separators', () => {
    const { container } = render(
      <PlayerRankedOverview competitive={competitive} username="oliver" />,
    );
    expect(container.textContent).not.toContain('1,420');
    settle();
    expect(container.textContent).toContain('1,420');
    expect(container.textContent).toContain('1,480');
  });

  it('animates streak counts', () => {
    const { container } = render(<RankedPerformanceSection competitive={competitive} />);
    settle();
    expect(container.textContent).toContain('5');
  });

  it('renders an em dash for a missing number rather than counting to zero', () => {
    const blank = { ...competitive, rating: null, peakRating: null } as Competitive;
    const { container } = render(<PlayerCompetitiveSummary competitive={blank} />);
    settle();
    expect(container.textContent).toContain('—');
  });

  it('releases animation frames when a surface unmounts mid-count', () => {
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    const { unmount } = render(<PlayerCompetitiveSummary competitive={competitive} />);
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
