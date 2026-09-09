import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ supabaseFetch: vi.fn() }));

vi.mock('../../supabaseUtils', () => ({
  supabaseFetch: (...args: unknown[]) => mocks.supabaseFetch(...args),
}));

import {
  listPuzzleRushDayResultsForUser,
  listLegacyDailyPuzzleDayResultsForUser,
} from './puzzleStatsStore';

describe('puzzleStatsStore', () => {
  beforeEach(() => mocks.supabaseFetch.mockReset());

  it('reads day results from rush_runs (the current-era Daily Puzzle table)', async () => {
    mocks.supabaseFetch.mockResolvedValueOnce([
      { run_date: '2026-09-08', total_score: 1907 },
      { run_date: 'bogus', total_score: 1 },
      { run_date: '2026-08-31', total_score: 2163 },
    ]);
    const rows = await listPuzzleRushDayResultsForUser('u1');
    expect(mocks.supabaseFetch.mock.calls[0][0]).toContain('/rest/v1/rush_runs?');
    expect(mocks.supabaseFetch.mock.calls[0][0]).toContain('status=eq.completed');
    expect(rows).toEqual([
      { date: '2026-09-08', score: 1907 },
      { date: '2026-08-31', score: 2163 },
    ]);
  });

  it('degrades to [] when rush_runs is missing rather than failing the read', async () => {
    mocks.supabaseFetch.mockRejectedValueOnce(
      new Error("Could not find the table 'public.rush_runs' in the schema cache"),
    );
    await expect(listPuzzleRushDayResultsForUser('u1')).resolves.toEqual([]);
  });

  it('reads frozen Ladder history from daily_puzzle_attempts', async () => {
    mocks.supabaseFetch.mockResolvedValueOnce([{ puzzle_date: '2026-07-27', total_score: 800 }]);
    const rows = await listLegacyDailyPuzzleDayResultsForUser('u1');
    expect(mocks.supabaseFetch.mock.calls[0][0]).toContain('/rest/v1/daily_puzzle_attempts?');
    expect(rows).toEqual([{ date: '2026-07-27', score: 800 }]);
  });

  it('degrades to [] when the frozen table is absent', async () => {
    mocks.supabaseFetch.mockRejectedValueOnce(
      new Error("Could not find the table 'public.daily_puzzle_attempts' in the schema cache"),
    );
    await expect(listLegacyDailyPuzzleDayResultsForUser('u1')).resolves.toEqual([]);
  });
});
