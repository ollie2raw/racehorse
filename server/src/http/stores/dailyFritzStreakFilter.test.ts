import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../supabaseUtils', () => ({ supabaseFetch: vi.fn() }));

import { supabaseFetch } from '../../supabaseUtils';
import { getDailyFritzStreak, isDailyFritzAttemptStreakEligible } from './dailyFritzStore';

const TODAY = '2026-09-02';
const YESTERDAY = '2026-09-01';
const TWO_DAYS_AGO = '2026-08-31';

describe('isDailyFritzAttemptStreakEligible (DF-G2)', () => {
  it('counts a completed, non-rejected run', () => {
    expect(isDailyFritzAttemptStreakEligible({ status: 'completed', result: { verification_status: 'verified' } })).toBe(true);
    expect(isDailyFritzAttemptStreakEligible({ status: 'completed', result: { verification_status: 'in_progress' } })).toBe(true);
  });

  it('still counts a pre-protocol legacy_unverified completion — the filter must not zero real streaks', () => {
    expect(isDailyFritzAttemptStreakEligible({ status: 'completed', result: null })).toBe(true);
    expect(isDailyFritzAttemptStreakEligible({ status: 'completed', result: { verification_status: 'legacy_unverified' } })).toBe(true);
  });

  it('does NOT count a rejected run', () => {
    expect(isDailyFritzAttemptStreakEligible({ status: 'completed', result: { verification_status: 'rejected' } })).toBe(false);
  });

  it('does NOT count a run that advanced a hand without a receipt', () => {
    expect(
      isDailyFritzAttemptStreakEligible({
        status: 'completed',
        result: { verification_status: 'in_progress', unverified_hands: [{ game_number: 1, hand_index: 3 }] },
      }),
    ).toBe(false);
  });

  it('does NOT count an unfinished attempt', () => {
    expect(isDailyFritzAttemptStreakEligible({ status: 'started', result: { verification_status: 'verified' } })).toBe(false);
  });
});

describe('getDailyFritzStreak applies the streak filter (DF-G2)', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalMemory = process.env.DAILY_FRITZ_MEMORY_STORE;

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    delete process.env.DAILY_FRITZ_MEMORY_STORE;
    vi.mocked(supabaseFetch).mockReset();
  });
  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalMemory === undefined) delete process.env.DAILY_FRITZ_MEMORY_STORE;
    else process.env.DAILY_FRITZ_MEMORY_STORE = originalMemory;
  });

  it('breaks the streak at a rejected day even though the row is status=completed', async () => {
    vi.mocked(supabaseFetch).mockResolvedValue([
      { run_date: TODAY, status: 'completed', result: { verification_status: 'verified' } },
      { run_date: YESTERDAY, status: 'completed', result: { verification_status: 'rejected' } },
      { run_date: TWO_DAYS_AGO, status: 'completed', result: { verification_status: 'verified' } },
    ]);
    // Today counts; yesterday is rejected -> the run of consecutive eligible days ends at today.
    expect(await getDailyFritzStreak('user-1', TODAY)).toBe(1);
  });

  it('counts consecutive verified + legacy days', async () => {
    vi.mocked(supabaseFetch).mockResolvedValue([
      { run_date: TODAY, status: 'completed', result: { verification_status: 'verified' } },
      { run_date: YESTERDAY, status: 'completed', result: null },
      { run_date: TWO_DAYS_AGO, status: 'completed', result: { verification_status: 'in_progress' } },
    ]);
    expect(await getDailyFritzStreak('user-1', TODAY)).toBe(3);
  });

  it('selects the result column so the filter can run', async () => {
    vi.mocked(supabaseFetch).mockResolvedValue([]);
    await getDailyFritzStreak('user-1', TODAY);
    const [path] = vi.mocked(supabaseFetch).mock.calls[0]!;
    expect(String(path)).toContain('select=run_date,status,result');
  });
});
