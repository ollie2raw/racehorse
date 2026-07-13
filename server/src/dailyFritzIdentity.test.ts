import { describe, expect, it } from 'vitest';
import { buildDailyFritzChallengeId } from './dailyFritzIdentity';
describe('Daily Fritz challenge identity',()=>{it('is deterministic and versioned',()=>expect(buildDailyFritzChallengeId('2026-07-12')).toBe('daily-fritz:2026-07-12:r2:s1'));it('rejects malformed dates',()=>expect(()=>buildDailyFritzChallengeId('tomorrow')).toThrow());});
