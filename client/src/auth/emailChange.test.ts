import { describe, expect, it } from 'vitest';
import { EMAIL_CHANGE_PENDING_MESSAGE, resolveEmailChange } from './emailChange';

describe('resolveEmailChange', () => {
  it('normalizes the address it will send to Supabase', () => {
    expect(resolveEmailChange('  New.Player@Example.COM ', 'old@example.com')).toEqual({
      email: 'new.player@example.com',
    });
  });

  it('refuses an empty address', () => {
    expect(resolveEmailChange('   ', 'old@example.com')).toEqual({
      error: 'Enter your new email address.',
    });
  });

  it('refuses an address that is not one', () => {
    expect(resolveEmailChange('not-an-email', 'old@example.com')).toEqual({
      error: 'Enter a valid email address.',
    });
  });

  it('refuses the address already on the account, however it is cased', () => {
    // Supabase accepts this and sends a confirmation link to an address the
    // user is already using, which reads as a broken feature.
    expect(resolveEmailChange('OLD@example.com', 'old@example.com')).toEqual({
      error: 'That is already your email address.',
    });
  });

  it('accepts a change when the account has no email on record', () => {
    expect(resolveEmailChange('new@example.com', null)).toEqual({ email: 'new@example.com' });
  });
});

describe('EMAIL_CHANGE_PENDING_MESSAGE', () => {
  it('names the address the link went to and says the change is not done yet', () => {
    // Supabase does not change the address on the call — it emails a
    // confirmation link — so the UI must not report success.
    const message = EMAIL_CHANGE_PENDING_MESSAGE('new@example.com');
    expect(message).toContain('new@example.com');
    expect(message.toLowerCase()).toContain('confirm');
  });
});
