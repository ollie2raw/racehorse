// @vitest-environment jsdom
import type { User } from '@supabase/supabase-js';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyFritzTodayResponse } from './api';
import { pacificDateText } from './dailyFritzScreenHelpers';

const getTodayDailyFritz = vi.hoisted(() => vi.fn());
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  getTodayDailyFritz,
}));
vi.mock('./DailyFritzLeaderboardScreen', () => ({
  default: (props: { runDate: string; initialToday: DailyFritzTodayResponse | null; user: User | null }) => (
    <div data-testid="board" data-run-date={props.runDate} data-has-today={String(Boolean(props.initialToday))} data-signed-in={String(Boolean(props.user))} />
  ),
}));
vi.mock('./DailyFritzLeaderboardLoading', () => ({
  DailyFritzLeaderboardLoading: () => <div data-testid="loading" />,
}));

import DailyFritzLeaderboardRoute from './DailyFritzLeaderboardRoute';

const TODAY = { ok: true, run_date: '2026-07-05' } as DailyFritzTodayResponse;
const user = { id: 'u1' } as User;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-12-05T20:00:00.000Z'));
  getTodayDailyFritz.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('DailyFritzLeaderboardRoute', () => {
  it('does not ask the server for today\'s set when signed out (it can only answer 401), and shows the board for today\'s Pacific date', async () => {
    render(<DailyFritzLeaderboardRoute user={null} profile={null} onClose={vi.fn()} />);

    const board = await screen.findByTestId('board');
    expect(getTodayDailyFritz).not.toHaveBeenCalled();
    expect(board.dataset.runDate).toBe(pacificDateText(new Date()));
    expect(board.dataset.runDate).toBe('2026-12-05');
    expect(board.dataset.hasToday).toBe('false');
    expect(board.dataset.signedIn).toBe('false');
    expect(screen.queryByTestId('loading')).toBeNull();
  });

  it('loads today\'s set for a signed-in player and passes it to the board', async () => {
    getTodayDailyFritz.mockResolvedValue(TODAY);
    render(<DailyFritzLeaderboardRoute user={user} profile={null} onClose={vi.fn()} />);

    expect(screen.getByTestId('loading')).toBeTruthy();
    const board = await screen.findByTestId('board');
    expect(getTodayDailyFritz).toHaveBeenCalledTimes(1);
    expect(board.dataset.runDate).toBe('2026-07-05');
    expect(board.dataset.hasToday).toBe('true');
  });

  it('still shows the board, for the Pacific date, when a signed-in player\'s request fails', async () => {
    getTodayDailyFritz.mockRejectedValue(new Error('not_found'));
    render(<DailyFritzLeaderboardRoute user={user} profile={null} onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByTestId('board').dataset.runDate).toBe('2026-12-05'));
    expect(screen.getByTestId('board').dataset.hasToday).toBe('false');
  });
});
