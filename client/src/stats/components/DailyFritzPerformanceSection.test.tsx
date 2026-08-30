// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DailyFritzPerformanceSection } from './DailyFritzPerformanceSection';

type DailyFritz = Parameters<typeof DailyFritzPerformanceSection>[0]['dailyFritz'];

const dailyFritz = (over: Partial<DailyFritz> = {}): DailyFritz => ({
  completions: 22,
  wins: 9,
  bestFinish: '2nd',
  bestMargin: 41,
  ...over,
});

/**
 * `model.dailyFritz` was fetched on every load of this page and rendered
 * nowhere — the mode with a leaderboard and a daily ritual had no section at
 * all.
 */
describe('DailyFritzPerformanceSection', () => {
  it('reports the run: completions, wins, best finish and best margin', () => {
    render(<DailyFritzPerformanceSection dailyFritz={dailyFritz()} />);

    expect(screen.getByText('22')).toBeTruthy();
    expect(screen.getByText('9')).toBeTruthy();
    expect(screen.getByText('2nd')).toBeTruthy();
    expect(screen.getByText('41')).toBeTruthy();
  });

  it('nudges instead of printing a grid of zeros for a player who has never played', () => {
    render(
      <DailyFritzPerformanceSection
        dailyFritz={dailyFritz({ completions: 0, wins: 0, bestFinish: null, bestMargin: null })}
      />,
    );

    expect(screen.getByText(/play today's set/i)).toBeTruthy();
    expect(screen.queryByText('0')).toBeNull();
  });

  it('still renders the run when only the completion count is known', () => {
    render(
      <DailyFritzPerformanceSection
        dailyFritz={dailyFritz({ wins: null, bestFinish: null, bestMargin: null })}
      />,
    );

    expect(screen.getByText('22')).toBeTruthy();
    expect(screen.queryByText(/play today's set/i)).toBeNull();
  });
});
