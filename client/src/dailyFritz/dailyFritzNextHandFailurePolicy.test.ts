import { describe, expect, it } from 'vitest';
import {
  DAILY_FRITZ_UNVERIFIED_FALLBACK_AFTER_ATTEMPTS,
  resolveDailyFritzCompletedHandNextHandFailure,
} from './dailyFritzNextHandFailurePolicy';

describe('resolveDailyFritzCompletedHandNextHandFailure', () => {
  it('rebuilds incomplete blocked transcripts before showing Continue', () => {
    expect(resolveDailyFritzCompletedHandNextHandFailure({
      verifierCode: 'incomplete_transcript',
      status: 400,
      failureAttempt: 1,
    })).toEqual({ kind: 'rebuild', delayMs: 150, reason: 'rebuild-incomplete_transcript' });
  });

  it('advances the run unranked once rebuilds and retries are exhausted', () => {
    // A player who cannot get a hand verified must never be left with only a
    // Retry button: the run continues without a receipt instead.
    const decision = resolveDailyFritzCompletedHandNextHandFailure({
      verifierCode: 'incomplete_transcript',
      status: 400,
      failureAttempt: DAILY_FRITZ_UNVERIFIED_FALLBACK_AFTER_ATTEMPTS,
    });
    expect(decision.kind).toBe('unverified_fallback');
    if (decision.kind === 'unverified_fallback') {
      expect(decision.attempts).toBe(DAILY_FRITZ_UNVERIFIED_FALLBACK_AFTER_ATTEMPTS);
    }
  });

  it('still shows Continue (never a reload) before the fallback threshold', () => {
    const decision = resolveDailyFritzCompletedHandNextHandFailure({
      // A code with no rebuild path: Continue is the interim state until the
      // fallback threshold is reached.
      verifierCode: 'illegal_action',
      status: 400,
      failureAttempt: DAILY_FRITZ_UNVERIFIED_FALLBACK_AFTER_ATTEMPTS - 1,
    });
    expect(decision.kind).toBe('continue');
    if (decision.kind === 'continue') {
      expect(decision.message).not.toMatch(/Reload the hand/i);
    }
  });

  it('never leaves any verifier code stuck on Continue forever', () => {
    for (const verifierCode of [
      'post_terminal_action',
      'illegal_action',
      'wrong_actor',
      'incomplete_transcript',
      'fritz_action_mismatch',
      'malformed_transcript',
      null,
    ]) {
      const decision = resolveDailyFritzCompletedHandNextHandFailure({
        verifierCode,
        status: 400,
        failureAttempt: DAILY_FRITZ_UNVERIFIED_FALLBACK_AFTER_ATTEMPTS + 3,
      });
      expect(decision.kind, `${verifierCode} must not strand the player`).toBe('unverified_fallback');
    }
  });

  it('never requires a page reload for a generic 400 after Hand Over', () => {
    const decision = resolveDailyFritzCompletedHandNextHandFailure({
      verifierCode: 'illegal_action',
      status: 400,
      failureAttempt: 1,
    });
    expect(decision.kind).toBe('continue');
  });

  it('continues (never resets) on a bare 400 with no verifier code after Hand Over', () => {
    // e.g. a malformed follow-up request rejected before any verification
    // ran. The already-recorded score for the prior verified hand must not
    // be treated as invalid just because this later request failed.
    const decision = resolveDailyFritzCompletedHandNextHandFailure({
      verifierCode: null,
      status: 400,
      failureAttempt: 1,
    });
    expect(decision).toEqual({ kind: 'continue', message: expect.any(String), reason: 'http-400' });
  });

  it('rebuilds Fritz mismatch before falling back to an unranked advance', () => {
    expect(resolveDailyFritzCompletedHandNextHandFailure({
      verifierCode: 'fritz_action_mismatch',
      status: 409,
      failureAttempt: 1,
    }).kind).toBe('rebuild');
    expect(resolveDailyFritzCompletedHandNextHandFailure({
      verifierCode: 'fritz_action_mismatch',
      status: 409,
      failureAttempt: DAILY_FRITZ_UNVERIFIED_FALLBACK_AFTER_ATTEMPTS,
    }).kind).toBe('unverified_fallback');
  });
});
