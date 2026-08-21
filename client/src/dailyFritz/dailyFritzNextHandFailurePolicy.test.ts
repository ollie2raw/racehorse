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

  it('falls back to score-only advance once transport retries are exhausted', () => {
    const decision = resolveDailyFritzCompletedHandNextHandFailure({
      verifierCode: 'illegal_action',
      status: 400,
      failureAttempt: DAILY_FRITZ_UNVERIFIED_FALLBACK_AFTER_ATTEMPTS,
    });
    expect(decision.kind).toBe('unverified_fallback');
    if (decision.kind === 'unverified_fallback') {
      expect(decision.attempts).toBe(DAILY_FRITZ_UNVERIFIED_FALLBACK_AFTER_ATTEMPTS);
    }
  });

  it('retries silently before the fallback threshold, showing nothing', () => {
    const decision = resolveDailyFritzCompletedHandNextHandFailure({
      verifierCode: 'illegal_action',
      status: 400,
      failureAttempt: 1,
    });
    // Previously a 'continue' decision carrying "the next deal is loading
    // automatically" — copy that promised an automatic retry the caller never
    // scheduled, so it sat next to the Retry button that did the real work.
    expect(decision.kind).toBe('retry');
    if (decision.kind === 'retry') {
      expect(decision.delayMs).toBeGreaterThan(0);
    }
    // A first failure must carry no player-facing text at all.
    expect(decision).not.toHaveProperty('message');
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
        failureAttempt: DAILY_FRITZ_UNVERIFIED_FALLBACK_AFTER_ATTEMPTS + 4,
      });
      expect(decision.kind, `${verifierCode} must not strand the player`).toBe('unverified_fallback');
    }
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
      failureAttempt: 5,
    }).kind).toBe('unverified_fallback');
  });
});
