import { describe, expect, it } from 'vitest';
import { resolveDailyFritzCompletedHandNextHandFailure } from './dailyFritzNextHandFailurePolicy';

describe('resolveDailyFritzCompletedHandNextHandFailure', () => {
  it('rebuilds incomplete blocked transcripts before showing Continue', () => {
    expect(resolveDailyFritzCompletedHandNextHandFailure({
      verifierCode: 'incomplete_transcript',
      status: 400,
      failureAttempt: 1,
    })).toEqual({ kind: 'rebuild', delayMs: 150, reason: 'rebuild-incomplete_transcript' });
  });

  it('shows Continue instead of reload after rebuilds are exhausted', () => {
    const decision = resolveDailyFritzCompletedHandNextHandFailure({
      verifierCode: 'incomplete_transcript',
      status: 400,
      failureAttempt: 5,
    });
    expect(decision.kind).toBe('continue');
    if (decision.kind === 'continue') {
      expect(decision.message).not.toMatch(/Reload the hand/i);
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

  it('rebuilds Fritz mismatch once before Continue', () => {
    expect(resolveDailyFritzCompletedHandNextHandFailure({
      verifierCode: 'fritz_action_mismatch',
      status: 409,
      failureAttempt: 1,
    }).kind).toBe('rebuild');
    expect(resolveDailyFritzCompletedHandNextHandFailure({
      verifierCode: 'fritz_action_mismatch',
      status: 409,
      failureAttempt: 5,
    }).kind).toBe('continue');
  });
});
