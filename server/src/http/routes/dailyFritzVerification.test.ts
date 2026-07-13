import { describe, expect, it } from 'vitest';
import { isIdenticalDailyFritzGameReplay } from './dailyFritz';
import { isDailyFritzAttemptLeaderboardEligible } from '../stores/dailyFritzStore';

describe('Daily Fritz competitive verification boundary', () => {
  it('excludes completed client-reported results from the verified leaderboard', () => {
    expect(isDailyFritzAttemptLeaderboardEligible({
      status: 'completed',
      result: { verification_status: 'legacy_unverified', final_score: 60 },
    })).toBe(false);
  });

  it('admits only an explicitly server-verified completed result', () => {
    expect(isDailyFritzAttemptLeaderboardEligible({
      status: 'completed',
      result: { verification_status: 'verified' },
    })).toBe(true);
    expect(isDailyFritzAttemptLeaderboardEligible({
      status: 'started',
      result: { verification_status: 'verified' },
    })).toBe(false);
  });

  it('rejects a fabricated score as a conflicting game replay', () => {
    const existing = { playerScore: 60, fritzScore: 42, movesUsed: 31, handsPlayed: 6 };
    expect(isIdenticalDailyFritzGameReplay(existing, existing)).toBe(true);
    expect(isIdenticalDailyFritzGameReplay(existing, { ...existing, playerScore: 600 })).toBe(false);
    expect(isIdenticalDailyFritzGameReplay(existing, { ...existing, fritzScore: 0 })).toBe(false);
  });
});
