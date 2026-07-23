import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HomeStreakStrip } from './HomeStreakStrip';
import type { HomeSourceState, DailySummaryBaseModel } from '../homeTypes';

const mockSummary: HomeSourceState<DailySummaryBaseModel> = {
  status: 'ready',
  stale: false,
  error: null,
  fetchedAt: Date.now(),
  data: {
    dateKey: '2026-07-14',
    currentStreakCount: 14,
    todayComplete: true,
    weeklyCompletedCount: 2,
    week: [
      { dateKey: '2026-07-13', label: 'MON', fritzCompleted: true, puzzleCompleted: true, complete: true, isToday: false, isFuture: false },
      { dateKey: '2026-07-14', label: 'TUE', fritzCompleted: true, puzzleCompleted: true, complete: true, isToday: true, isFuture: false },
      { dateKey: '2026-07-15', label: 'WED', fritzCompleted: false, puzzleCompleted: false, complete: false, isToday: false, isFuture: false },
      { dateKey: '2026-07-16', label: 'THU', fritzCompleted: false, puzzleCompleted: false, complete: false, isToday: false, isFuture: false },
      { dateKey: '2026-07-17', label: 'FRI', fritzCompleted: false, puzzleCompleted: false, complete: false, isToday: false, isFuture: false },
      { dateKey: '2026-07-18', label: 'SAT', fritzCompleted: false, puzzleCompleted: false, complete: false, isToday: false, isFuture: true },
      { dateKey: '2026-07-19', label: 'SUN', fritzCompleted: false, puzzleCompleted: false, complete: false, isToday: false, isFuture: true },
    ],
  },
};

describe('HomeStreakStrip', () => {
  it('renders the streak count and goal info', () => {
    render(<HomeStreakStrip summary={mockSummary} />);
    expect(screen.getByText('14 Day Streak')).toBeInTheDocument();
    expect(screen.getByText('Nice — today is complete.')).toBeInTheDocument();
    expect(screen.getByText('Weekly Goal')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('/ 7 Days')).toBeInTheDocument();
  });

  it('renders loading skeleton when loading', () => {
    render(<HomeStreakStrip summary={null} loading />);
    expect(screen.getByRole('region', { name: 'Loading daily summary streak info' })).toHaveAttribute('aria-busy', 'true');
  });

  it('renders encouragement subtitle when today is not complete', () => {
    const incompleteSummary: HomeSourceState<DailySummaryBaseModel> = {
      ...mockSummary,
      data: {
        ...mockSummary.data!,
        todayComplete: false,
      },
    };
    render(<HomeStreakStrip summary={incompleteSummary} />);
    expect(screen.getByText('Play Fritz or Puzzle today to keep it going.')).toBeInTheDocument();
  });

  it('keeps the seven-day banner visible when the summary has no week rows', () => {
    render(<HomeStreakStrip summary={{ ...mockSummary, data: { ...mockSummary.data!, week: [], currentStreakCount: 0, todayComplete: false } }} />);
    expect(screen.getByText('Start your streak')).toBeInTheDocument();
    expect(screen.getAllByText(/^(MON|TUE|WED|THU|FRI|SAT|SUN)$/)).toHaveLength(7);
  });
});
