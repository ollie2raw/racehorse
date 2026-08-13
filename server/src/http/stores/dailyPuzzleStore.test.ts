import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ supabaseFetch: vi.fn() }));

vi.mock('../../supabaseUtils', () => ({
  supabaseFetch: (...args: unknown[]) => mocks.supabaseFetch(...args),
}));

import { createDailyPuzzleAttempt } from './dailyPuzzleStore';

const row = {
  id: 'attempt-1',
  puzzle_date: '2026-08-11',
  user_id: 'user-1',
  username: 'Player',
  status: 'started',
  set_version: 1,
  current_slot_index: 1,
  puzzles_completed: 0,
  total_score: 0,
  master_chain_score: 0,
  completed_at: null,
  started_at: '2026-08-11T20:00:00.000Z',
  updated_at: '2026-08-11T20:00:00.000Z',
  review_unlocked: false,
  result: {},
};

describe('createDailyPuzzleAttempt', () => {
  beforeEach(() => mocks.supabaseFetch.mockReset());

  it('creates through the unique attempt conflict target without overwriting an existing attempt', async () => {
    mocks.supabaseFetch.mockResolvedValueOnce([row]);

    const result = await createDailyPuzzleAttempt({
      runDate: '2026-08-11', userId: 'user-1', username: 'Player', setVersion: 1,
    });

    expect(result.created).toBe(true);
    expect(result.attempt.id).toBe('attempt-1');
    expect(mocks.supabaseFetch).toHaveBeenCalledWith(
      '/rest/v1/daily_puzzle_attempts?on_conflict=puzzle_date,user_id',
      expect.objectContaining({
        method: 'POST',
        headers: { Prefer: 'return=representation,resolution=ignore-duplicates' },
      }),
    );
  });

  it('replays the authoritative winner when a concurrent start wins the insert race', async () => {
    mocks.supabaseFetch
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([row])
      .mockResolvedValueOnce([]);

    const result = await createDailyPuzzleAttempt({
      runDate: '2026-08-11', userId: 'user-1', username: 'Player', setVersion: 1,
    });

    expect(result.created).toBe(false);
    expect(result.attempt.id).toBe('attempt-1');
    expect(mocks.supabaseFetch).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('puzzle_date=eq.2026-08-11&user_id=eq.user-1'),
      { method: 'GET' },
    );
  });
});
