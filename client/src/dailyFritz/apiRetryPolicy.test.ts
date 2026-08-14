// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  DailyFritzNextHandHttpError,
  isRecoverableDailyFritzAuthorityCode,
  isRetryableDailyFritzNextHandError,
} from './api.ts';

describe('Daily Fritz next-hand retry policy', () => {
  it('does not retry deterministic verification rejection responses', () => {
    const error = new DailyFritzNextHandHttpError(
      'Player player does not have tile [4|6] in hand.',
      400,
      'illegal_action',
    );
    expect(isRetryableDailyFritzNextHandError(error)).toBe(false);
    expect(error.verifierCode).toBe('illegal_action');
  });

  it('retries transient network and server failures', () => {
    expect(isRetryableDailyFritzNextHandError(new Error('Failed to fetch'))).toBe(true);
    expect(isRetryableDailyFritzNextHandError(
      new DailyFritzNextHandHttpError('Service unavailable', 503),
    )).toBe(true);
  });

  it('restores official state for policy and state parity failures regardless of HTTP status', () => {
    expect(isRecoverableDailyFritzAuthorityCode('fritz_action_mismatch')).toBe(true);
    expect(isRecoverableDailyFritzAuthorityCode('fritz_state_mismatch')).toBe(true);
    expect(isRecoverableDailyFritzAuthorityCode('illegal_action')).toBe(false);
  });
});
