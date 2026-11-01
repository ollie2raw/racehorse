// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AccuracyTrend, trendSummary } from './AccuracyTrend';
import type { SavedGameSummary } from './savedGames';

function reviewed(n: number, accuracy: number): SavedGameSummary {
  return {
    sourceMatchId: `g${n}`,
    mode: 'pvf',
    fritzTier: 'elite',
    dealSize: 7,
    winningScore: 60,
    result: { you: 61, opponent: 40, winner: 'you' },
    moveCount: 80,
    verification: 'replay_verified',
    playedAt: new Date(Date.UTC(2026, 10, n)).toISOString(),
    savedAt: new Date(Date.UTC(2026, 10, n, 1)).toISOString(),
    review: { id: `r${n}`, accuracy, grade: null },
  };
}
const series = (accuracies: number[]) => accuracies.map((accuracy, i) => reviewed(i + 1, accuracy));

describe('AccuracyTrend', () => {
  it('shows nothing until there are two reviewed games to connect', () => {
    const { container, rerender } = render(<AccuracyTrend games={[]} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<AccuracyTrend games={series([80])} />);
    expect(container).toBeEmptyDOMElement();
  });

  const dots = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('.rh-accuracy-trend__dot')];
  const topOf = (dot: HTMLElement) => parseFloat(dot.style.top);
  const leftOf = (dot: HTMLElement) => parseFloat(dot.style.left);

  it('draws one dot per reviewed game with the newest one marked, and a text alternative', () => {
    const { container } = render(<AccuracyTrend games={series([60, 70, 80])} />);
    const chart = screen.getByRole('img');
    expect(chart).toHaveAttribute('aria-label', 'Accuracy across your last 3 reviewed games, from 60% to 80%');
    expect(dots(container)).toHaveLength(3);
    expect(container.querySelectorAll('.rh-accuracy-trend__dot--latest')).toHaveLength(1);
    expect(dots(container)[2]).toHaveClass('rh-accuracy-trend__dot--latest');
    expect(container.querySelector('path')?.getAttribute('d')).toMatch(/^M[\d.]+ [\d.]+ L/);
  });

  it('keeps the dots out of the screen reader tree: the chart carries the description', () => {
    const { container } = render(<AccuracyTrend games={series([60, 70, 80])} />);
    for (const dot of dots(container)) expect(dot).toHaveAttribute('aria-hidden', 'true');
  });

  it('spreads the games evenly from the left edge to the right edge', () => {
    const { container } = render(<AccuracyTrend games={series([60, 70, 80, 90, 75])} />);
    expect(dots(container).map(leftOf)).toEqual([0, 25, 50, 75, 100]);
  });

  it('keeps every point inside the plot even when the accuracies sit at the extremes', () => {
    const { container } = render(<AccuracyTrend games={series([0, 100, 0, 100])} />);
    for (const dot of dots(container)) {
      expect(topOf(dot)).toBeGreaterThanOrEqual(0);
      expect(topOf(dot)).toBeLessThanOrEqual(100);
      expect(leftOf(dot)).toBeGreaterThanOrEqual(0);
      expect(leftOf(dot)).toBeLessThanOrEqual(100);
    }
  });

  it('puts a better game higher on the chart than a worse one', () => {
    const { container } = render(<AccuracyTrend games={series([50, 90])} />);
    const [first, second] = dots(container).map(topOf);
    expect(second).toBeLessThan(first!);
  });

  it('does not divide by zero when every game has the same accuracy', () => {
    const { container } = render(<AccuracyTrend games={series([75, 75, 75])} />);
    for (const dot of dots(container)) expect(Number.isFinite(topOf(dot))).toBe(true);
  });

  it('says in words where the trend is heading', () => {
    render(<AccuracyTrend games={series([70, 72, 74, 76, 78, 80, 82, 84, 86, 88])} />);
    expect(screen.getByText('Your last 5 reviewed games average 84%, up 10 points on the 5 before.')).toBeTruthy();
  });
});

describe('trendSummary', () => {
  it('asks for more games before there is an average', () => {
    expect(trendSummary(null, null)).toBe('Review 5 games to see your recent average.');
  });

  it('gives the average without a direction while the history is short', () => {
    expect(trendSummary(null, 81.4)).toBe('Your last 5 reviewed games average 81.4%.');
  });

  it('calls a small move steady, and a real one up or down', () => {
    expect(trendSummary(0.3, 80)).toBe('Your last 5 reviewed games average 80%, steady against the 5 before.');
    expect(trendSummary(-0.4, 80)).toContain('steady');
    expect(trendSummary(3.2, 80)).toBe('Your last 5 reviewed games average 80%, up 3.2 points on the 5 before.');
    expect(trendSummary(-6, 80)).toBe('Your last 5 reviewed games average 80%, down 6 points on the 5 before.');
  });
});
