// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import type { User } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import WeeklyStatsScreen from './WeeklyStatsScreen';
import type { WeeklyRecap } from './statsApi';

const { fetchWeeklyRecap } = vi.hoisted(() => ({ fetchWeeklyRecap: vi.fn() }));
vi.mock('./statsApi', () => ({ fetchWeeklyRecap }));

const user = { id: 'u1', email: 'maya@example.com' } as User;

function recap(over: Partial<WeeklyRecap> = {}): WeeklyRecap {
  return {
    weekLabel: 'Sep 8 – Sep 14',
    fritz: { gamesThisWeek: 3, ratingChangeThisWeek: 12, bestWinMarginThisWeek: 40 },
    ghost: { gamesThisWeek: 1, ratingChangeThisWeek: -4, bestWinMarginThisWeek: 8 },
    puzzle: { completionsThisWeek: 5, bestScoreToday: 1907 },
    multiplayer: { gamesThisWeek: 2, wins: 1, losses: 1 },
    ...over,
  };
}

describe('WeeklyStatsScreen', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not fetch while closed', () => {
    render(<WeeklyStatsScreen open={false} onClose={vi.fn()} user={user} />);
    expect(fetchWeeklyRecap).not.toHaveBeenCalled();
    // The overlay is present but hidden — no recap content, no loading state.
    expect(screen.queryByText('Loading weekly recap...')).toBeNull();
  });

  it('fetches and renders the recap sections when opened', async () => {
    fetchWeeklyRecap.mockResolvedValue({ data: recap(), error: null });
    render(<WeeklyStatsScreen open onClose={vi.fn()} user={user} />);

    await waitFor(() => expect(fetchWeeklyRecap).toHaveBeenCalledWith(user));
    expect(await screen.findByText('Sep 8 – Sep 14')).toBeTruthy();
    expect(screen.getByText('Fritz This Week')).toBeTruthy();
    expect(screen.getByText('Multiplayer This Week')).toBeTruthy();
    // A figure from the recap payload.
    expect(screen.getByText('1907')).toBeTruthy();
  });

  it('shows an error state when the recap fetch fails', async () => {
    fetchWeeklyRecap.mockResolvedValue({ data: null, error: 'Weekly recap unavailable right now.' });
    render(<WeeklyStatsScreen open onClose={vi.fn()} user={user} />);
    expect(await screen.findByText('Weekly recap unavailable right now.')).toBeTruthy();
  });
});
