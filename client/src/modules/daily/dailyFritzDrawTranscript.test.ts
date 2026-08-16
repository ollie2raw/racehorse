// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { capDailyFritzDrawLogCount, resolveTranscriptDrawLogCount } from './dailyFritzDrawTranscript.ts';

describe('resolveTranscriptDrawLogCount', () => {
  it('expands each drawn tile for Daily Fritz verification', () => {
    expect(resolveTranscriptDrawLogCount(true, 3)).toBe(3);
    expect(resolveTranscriptDrawLogCount(true, 1)).toBe(1);
  });

  it('collapses multi-draws for non-Daily modes', () => {
    expect(resolveTranscriptDrawLogCount(false, 3)).toBe(1);
    expect(resolveTranscriptDrawLogCount(false, 1)).toBe(1);
  });

  it('returns zero when nothing was drawn', () => {
    expect(resolveTranscriptDrawLogCount(true, 0)).toBe(0);
    expect(resolveTranscriptDrawLogCount(false, 0)).toBe(0);
  });
});

describe('capDailyFritzDrawLogCount', () => {
  // Regression coverage for the incident where a Daily Fritz player got
  // permanently stuck on the Hand Over screen after a blocked TIE ending:
  // the boneyard-delta upward correction in usePlayerNoMoveEffect.ts /
  // runBotDrawPassSequence could push the logged draw count past the number
  // of real, positively-observed per-step draws, fabricating a 'draw'
  // MoveEntry with no real drawOne() behind it. That is an unrecoverable
  // server-side 'illegal_action' / "Draw is not legal" rejection (the
  // server only self-heals MISSING draws, never extra ones) — see
  // server/src/http/routes/dailyFritzTieBlockAndDrawDedupClientTranscript.test.ts
  // for the end-to-end reproduction through the real HTTP verification path.

  it('for Daily Fritz, caps the logged draw count at the number of real per-step snapshots', () => {
    // The boneyard-delta correction inflated drawCount to 3, but onStep only
    // positively observed 2 real draws — never fabricate the third.
    expect(capDailyFritzDrawLogCount(true, 3, 2)).toBe(2);
  });

  it('for Daily Fritz, never inflates below what was actually observed', () => {
    expect(capDailyFritzDrawLogCount(true, 2, 5)).toBe(2);
  });

  it('for Daily Fritz, passes through when the counts already agree', () => {
    expect(capDailyFritzDrawLogCount(true, 2, 2)).toBe(2);
    expect(capDailyFritzDrawLogCount(true, 0, 0)).toBe(0);
  });

  it('is a no-op for non-Daily modes (no server-side replay to diverge from)', () => {
    expect(capDailyFritzDrawLogCount(false, 3, 0)).toBe(3);
    expect(capDailyFritzDrawLogCount(false, 1, 1)).toBe(1);
  });
});
