import { describe, expect, it } from 'vitest';
import { MIN_PASSWORD_LENGTH, resolvePasswordChange } from './passwordChange';

describe('resolvePasswordChange', () => {
  it('accepts a long-enough matching pair', () => {
    expect(resolvePasswordChange('correct-horse', 'correct-horse')).toEqual({
      password: 'correct-horse',
    });
  });

  it('refuses a pair that does not match', () => {
    expect(resolvePasswordChange('correct-horse', 'correct-hoarse')).toEqual({
      error: 'Passwords do not match.',
    });
  });

  it('refuses a password under the minimum length', () => {
    expect(resolvePasswordChange('short', 'short')).toEqual({
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    });
  });

  it('reports the length problem before the mismatch', () => {
    // Both are wrong; the length is the one the user has to fix first, and
    // saying "do not match" about two too-short strings is misleading.
    expect(resolvePasswordChange('abc', 'xyz')).toEqual({
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    });
  });

  it('does not trim — a leading space is part of the password', () => {
    expect(resolvePasswordChange(' spaced out', ' spaced out')).toEqual({
      password: ' spaced out',
    });
    expect(resolvePasswordChange(' spaced out', 'spaced out')).toEqual({
      error: 'Passwords do not match.',
    });
  });
});
