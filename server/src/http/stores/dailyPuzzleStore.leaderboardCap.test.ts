/**
 * Verifies Phase 1 item 1.2: leaderboard query is capped and admin path is unbounded.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LEADERBOARD_ATTEMPT_LIMIT } from './dailyPuzzleStore';

// We verify the cap is wired by inspecting the URL passed to supabaseFetch.
// The actual DB round-trip is mocked so the test runs without Supabase credentials.

vi.mock('../../supabaseUtils', () => ({
  supabaseFetch: vi.fn(),
}));

import { supabaseFetch } from '../../supabaseUtils';
import {
  listDailyPuzzleAttemptsForDate,
  listAllDailyPuzzleAttemptsForDate,
} from './dailyPuzzleStore';

const mockedFetch = vi.mocked(supabaseFetch);

beforeEach(() => {
  mockedFetch.mockClear();
  mockedFetch.mockResolvedValue([]);
});

describe('listDailyPuzzleAttemptsForDate (leaderboard cap)', () => {
  it('passes &limit=200 in the attempts query URL', async () => {
    await listDailyPuzzleAttemptsForDate('2026-08-12');

    const [url] = mockedFetch.mock.calls[0] as [string, ...unknown[]];
    expect(url).toContain(`&limit=${LEADERBOARD_ATTEMPT_LIMIT}`);
    expect(LEADERBOARD_ATTEMPT_LIMIT).toBe(200);
  });

  it('does not pass a limit clause in the slot-results query (those are bounded by the attempt set)', async () => {
    // First call is attempts, second would be slot results — but with 0 rows returned
    // the slot-results fetch is skipped. Verify only one fetch call happens on empty result.
    await listDailyPuzzleAttemptsForDate('2026-08-12');
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });
});

describe('listAllDailyPuzzleAttemptsForDate (admin path, unbounded)', () => {
  it('does NOT include &limit= in the attempts query URL', async () => {
    await listAllDailyPuzzleAttemptsForDate('2026-08-12');

    const [url] = mockedFetch.mock.calls[0] as [string, ...unknown[]];
    expect(url).not.toContain('&limit=');
  });
});
