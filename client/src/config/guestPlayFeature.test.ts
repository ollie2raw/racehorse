import { describe, expect, it } from 'vitest';
import { isGuestPlayEnabled, parseGuestPlayFlag } from './guestPlayFeature';

describe('guest play flag', () => {
  it('is on only for the exact string "true"', () => {
    expect(parseGuestPlayFlag('true')).toBe(true);
    for (const value of ['false', 'TRUE', 'True', '1', 'yes', '', ' true', undefined, null, true, 1]) {
      expect(parseGuestPlayFlag(value), String(value)).toBe(false);
    }
  });

  it('is off by default (nothing sets it in the test build)', () => {
    expect(isGuestPlayEnabled()).toBe(false);
  });

  it('reads the value it is given', () => {
    expect(isGuestPlayEnabled('true')).toBe(true);
    expect(isGuestPlayEnabled('false')).toBe(false);
  });
});
