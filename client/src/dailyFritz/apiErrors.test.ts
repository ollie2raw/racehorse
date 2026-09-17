import { describe, expect, it } from 'vitest';
import { DailyFritzNextHandHttpError } from './apiErrors';

describe('DailyFritzNextHandHttpError -- currentHandIndex (2026-09 retry-storm fix)', () => {
  it('carries a provided currentHandIndex', () => {
    const error = new DailyFritzNextHandHttpError('Daily Fritz hand is no longer current.', 409, null, null, null, 10);
    expect(error.currentHandIndex).toBe(10);
  });

  it('defaults currentHandIndex to null when not provided', () => {
    const error = new DailyFritzNextHandHttpError('Daily Fritz hand is no longer current.', 409, null);
    expect(error.currentHandIndex).toBeNull();
  });
});
