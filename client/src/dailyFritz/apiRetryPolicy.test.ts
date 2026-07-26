import { describe, expect, it } from 'vitest';
import {
  DailyFritzNextHandHttpError,
  isRetryableDailyFritzNextHandError,
} from './api.ts';

describe('Daily Fritz next-hand retry policy', () => {
  it('does not retry deterministic verification rejection responses', () => {
    expect(isRetryableDailyFritzNextHandError(
      new DailyFritzNextHandHttpError('Player player does not have tile [4|6] in hand.', 400),
    )).toBe(false);
  });

  it('retries transient network and server failures', () => {
    expect(isRetryableDailyFritzNextHandError(new Error('Failed to fetch'))).toBe(true);
    expect(isRetryableDailyFritzNextHandError(
      new DailyFritzNextHandHttpError('Service unavailable', 503),
    )).toBe(true);
  });
});
