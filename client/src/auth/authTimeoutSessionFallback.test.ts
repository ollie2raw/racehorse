// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const captureMessage = vi.fn();

vi.mock('@sentry/react', () => ({
  captureMessage: (...args: unknown[]) => captureMessage(...args),
}));

const {
  AUTH_TIMEOUT_FALLBACK_ERROR,
  evaluateAuthTimeoutSessionFallback,
  sessionEmailMatchesAttempt,
} = await import('./authTimeoutSessionFallback');

describe('sessionEmailMatchesAttempt', () => {
  it('matches case-insensitively with trimming', () => {
    expect(sessionEmailMatchesAttempt('  Alice@Example.COM ', 'alice@example.com')).toBe(true);
  });

  it('rejects different emails', () => {
    expect(sessionEmailMatchesAttempt('a@example.com', 'b@example.com')).toBe(false);
  });

  it('rejects empty session email', () => {
    expect(sessionEmailMatchesAttempt(null, 'a@example.com')).toBe(false);
    expect(sessionEmailMatchesAttempt('', 'a@example.com')).toBe(false);
  });
});

describe('evaluateAuthTimeoutSessionFallback — actual timeout-path decision', () => {
  beforeEach(() => {
    captureMessage.mockReset();
  });

  it('1. timeout + different user session → error, no false success, Sentry auth_alert', () => {
    const result = evaluateAuthTimeoutSessionFallback({
      flow: 'sign_in',
      attemptedEmail: 'attempt@example.com',
      session: {
        user: { id: 'user-other', email: 'other@example.com' },
      },
    });

    expect(result).toEqual({
      ok: false,
      reason: 'email_mismatch',
      error: AUTH_TIMEOUT_FALLBACK_ERROR,
    });
    expect(captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('session email does not match'),
      expect.objectContaining({
        level: 'error',
        tags: expect.objectContaining({
          auth_alert: 'auth_timeout_stale_session',
          auth_flow: 'sign_in',
        }),
        extra: expect.objectContaining({
          reason: 'email_mismatch',
          session_present: true,
          emails_match: false,
        }),
      }),
    );
    const extra = captureMessage.mock.calls[0]?.[1]?.extra as Record<string, unknown>;
    expect(extra).not.toHaveProperty('attempted_email');
    expect(extra).not.toHaveProperty('session_email');
    expect(extra).not.toHaveProperty('password');
    expect(extra).not.toHaveProperty('access_token');
    expect(Object.keys(extra).sort()).toEqual(
      [
        'attempted_email_len',
        'auth_flow',
        'emails_match',
        'reason',
        'session_email_present',
        'session_present',
        'session_user_id_len',
      ].sort(),
    );
  });

  it('2. timeout + matching user session → success (legitimate fallback)', () => {
    const result = evaluateAuthTimeoutSessionFallback({
      flow: 'sign_up',
      attemptedEmail: 'Same@Example.com',
      session: {
        user: { id: 'user-match', email: 'same@example.com' },
      },
    });

    expect(result).toEqual({
      ok: true,
      user: { id: 'user-match', email: 'same@example.com' },
    });
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it('3. timeout + no session → error', () => {
    const result = evaluateAuthTimeoutSessionFallback({
      flow: 'sign_in',
      attemptedEmail: 'attempt@example.com',
      session: null,
    });

    expect(result).toEqual({
      ok: false,
      reason: 'no_session',
      error: AUTH_TIMEOUT_FALLBACK_ERROR,
    });
    // Normal timeout — console only, not a stale-session Sentry alert.
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it('3b. timeout + session without user → error', () => {
    const result = evaluateAuthTimeoutSessionFallback({
      flow: 'sign_in',
      attemptedEmail: 'attempt@example.com',
      session: { user: null },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('no_session');
  });
});
