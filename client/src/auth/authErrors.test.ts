import { describe, expect, it } from 'vitest';
import {
  AUTH_EMAIL_SEND_FAILED_MESSAGE,
  AUTH_GENERIC_ERROR_MESSAGE,
  AUTH_RATE_LIMITED_MESSAGE,
  AUTH_RESET_UNAVAILABLE_MESSAGE,
  AUTH_UNAVAILABLE_MESSAGE,
  PASSWORD_RESET_SENT_MESSAGE,
  formatAuthErrorMessage,
  passwordResetSentMessage,
} from './authErrors';

describe('formatAuthErrorMessage', () => {
  it.each([
    ['429 status', { status: 429, message: 'Too Many Requests' }],
    ['email rate limit text', { status: 400, message: 'email rate limit exceeded' }],
    ['per-request cooldown', { message: 'For security purposes, you can only request this after 42 seconds.' }],
    ['rate-limit error code', { code: 'over_email_send_rate_limit', message: 'whatever' }],
    ['request rate-limit code', { code: 'over_request_rate_limit', message: 'whatever' }],
  ])('maps %s to the calm rate-limited copy', (_label, error) => {
    expect(formatAuthErrorMessage(error)).toBe(AUTH_RATE_LIMITED_MESSAGE);
  });

  it('says "wait a minute", and never exposes the seconds count or provider text', () => {
    const copy = formatAuthErrorMessage({ message: 'For security purposes, you can only request this after 59 seconds.' });
    expect(copy).toBe('Too many requests — wait a minute and try again.');
    expect(copy).not.toMatch(/59|security purposes/);
  });

  it.each([
    ['recovery', 'Error sending recovery email'],
    ['confirmation', 'Error sending confirmation email'],
    ['email change', 'Error sending email change email'],
  ])('maps a %s mailer failure to a neutral send-failed message with no provider details', (_label, message) => {
    const copy = formatAuthErrorMessage({ status: 500, message });
    expect(copy).toBe(AUTH_EMAIL_SEND_FAILED_MESSAGE);
    expect(copy).not.toMatch(/supabase|smtp/i);
  });

  it.each([
    ['fetch failure', { message: 'Failed to fetch' }],
    ['Safari fetch failure', { message: 'Load failed' }],
    ['retryable fetch error', { name: 'AuthRetryableFetchError', message: '{}' }],
    ['gateway error', { status: 503, message: 'Service Unavailable' }],
    ['client timeout', { message: 'Request timed out. Try again.' }],
  ])('maps a %s to the generic try-again copy', (_label, error) => {
    expect(formatAuthErrorMessage(error)).toBe(AUTH_UNAVAILABLE_MESSAGE);
  });

  it('does not disguise a plain 500 answer as a connection problem', () => {
    expect(formatAuthErrorMessage({ status: 500, message: 'Database error saving new user' })).toBe(
      'Database error saving new user',
    );
  });

  it('hides redirect misconfiguration behind a player-facing message', () => {
    const copy = formatAuthErrorMessage({ message: 'Redirect URL not allowed' });
    expect(copy).toBe(AUTH_RESET_UNAVAILABLE_MESSAGE);
  });

  it('passes through specific, already-readable messages', () => {
    expect(formatAuthErrorMessage({ status: 400, message: 'Invalid login credentials' })).toBe('Invalid login credentials');
  });

  it('falls back to a generic message for empty errors', () => {
    expect(formatAuthErrorMessage(null)).toBe(AUTH_GENERIC_ERROR_MESSAGE);
    expect(formatAuthErrorMessage({ message: '   ' })).toBe(AUTH_GENERIC_ERROR_MESSAGE);
  });
});

describe('passwordResetSentMessage', () => {
  it('stays neutral about whether the address has an account', () => {
    for (const native of [true, false]) {
      const copy = passwordResetSentMessage(native);
      expect(copy.startsWith(PASSWORD_RESET_SENT_MESSAGE)).toBe(true);
      expect(copy).not.toMatch(/no account|not found|doesn.t exist|unknown/i);
    }
  });

  it('tells app players the reset finishes on the web, then to sign in back in the app', () => {
    expect(passwordResetSentMessage(true)).toContain(
      'Open the link on this device; after you set a new password, return to the app and sign in.',
    );
  });

  it('keeps the web copy short: the link opens this same site', () => {
    expect(passwordResetSentMessage(false)).toContain('Open the link on this device to set a new password.');
    expect(passwordResetSentMessage(false)).not.toMatch(/return to the app/);
  });
});
