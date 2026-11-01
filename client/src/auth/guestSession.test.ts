import { describe, expect, it } from 'vitest';
import { isAnonymousUser, shouldPromptForUsername } from './guestSession';

describe('isAnonymousUser', () => {
  it('is true only for a user Supabase marks anonymous', () => {
    expect(isAnonymousUser({ is_anonymous: true })).toBe(true);
    expect(isAnonymousUser({ is_anonymous: false })).toBe(false);
    expect(isAnonymousUser({})).toBe(false);
    expect(isAnonymousUser(null)).toBe(false);
    expect(isAnonymousUser(undefined)).toBe(false);
  });
});

describe('shouldPromptForUsername', () => {
  it('prompts a signed-in account that still has a placeholder handle', () => {
    expect(shouldPromptForUsername({ is_anonymous: false }, true)).toBe(true);
    expect(shouldPromptForUsername({}, true)).toBe(true);
  });

  it('never prompts a guest, even though their handle is a placeholder', () => {
    expect(shouldPromptForUsername({ is_anonymous: true }, true)).toBe(false);
  });

  it('does not prompt someone who has a real handle, or nobody at all', () => {
    expect(shouldPromptForUsername({ is_anonymous: false }, false)).toBe(false);
    expect(shouldPromptForUsername(null, true)).toBe(false);
  });
});
