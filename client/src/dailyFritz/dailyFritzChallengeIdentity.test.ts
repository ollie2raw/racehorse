import { describe, expect, it } from 'vitest';
import { createDailyFritzChallengeIdentity, getDailyFritzDateKey, isDailyFritzChallengeCurrent } from './dailyFritzChallengeIdentity.ts';

describe('Daily Fritz challenge identity', () => {
  it('uses the Pacific calendar date deterministically', () => {
    expect(getDailyFritzDateKey(new Date('2026-07-12T06:30:00.000Z'))).toBe('2026-07-11');
    expect(getDailyFritzDateKey(new Date('2026-07-12T08:30:00.000Z'))).toBe('2026-07-12');
  });
  it('includes explicit rules and seed versions', () => {
    expect(createDailyFritzChallengeIdentity('2026-07-12')).toEqual({ challengeDate:'2026-07-12',challengeId:'daily-fritz:2026-07-12:r2:s1',rulesVersion:2,seedVersion:1 });
  });
  it('rejects stale, future, or version-mismatched identities', () => {
    const now = new Date('2026-07-12T20:00:00.000Z');
    expect(isDailyFritzChallengeCurrent(createDailyFritzChallengeIdentity('2026-07-12'), now)).toBe(true);
    expect(isDailyFritzChallengeCurrent(createDailyFritzChallengeIdentity('2026-07-11'), now)).toBe(false);
    expect(isDailyFritzChallengeCurrent(createDailyFritzChallengeIdentity('2026-07-13'), now)).toBe(false);
    expect(isDailyFritzChallengeCurrent({ ...createDailyFritzChallengeIdentity('2026-07-12'), rulesVersion: 3 }, now)).toBe(false);
  });
});
