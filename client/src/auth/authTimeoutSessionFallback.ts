import * as Sentry from '@sentry/react';

export type AuthTimeoutFlow = 'sign_in' | 'sign_up';

export type AuthTimeoutSessionUser = {
  id: string;
  email?: string | null;
};

export type AuthTimeoutFallbackOk = {
  ok: true;
  user: AuthTimeoutSessionUser;
};

export type AuthTimeoutFallbackErr = {
  ok: false;
  reason: 'no_session' | 'email_mismatch' | 'probe_failed';
  error: string;
};

export type AuthTimeoutFallbackResult = AuthTimeoutFallbackOk | AuthTimeoutFallbackErr;

export const AUTH_TIMEOUT_FALLBACK_ERROR = 'Request timed out. Try again.';

/** Case-insensitive email equality for timeout-session proof. */
export function sessionEmailMatchesAttempt(
  sessionEmail: string | null | undefined,
  attemptedEmail: string,
): boolean {
  const session = sessionEmail?.trim().toLowerCase() ?? '';
  const attempted = attemptedEmail.trim().toLowerCase();
  return session.length > 0 && attempted.length > 0 && session === attempted;
}

/**
 * Decide whether a getSession() probe after AUTH_REQUEST_TIMEOUT_MS may count as
 * success for the timed-out sign-in/up attempt.
 *
 * Only a session whose user email matches the submitted email is accepted.
 * Any other session is left untouched and the attempt fails as a real timeout.
 */
export function evaluateAuthTimeoutSessionFallback(params: {
  session: { user?: AuthTimeoutSessionUser | null } | null | undefined;
  attemptedEmail: string;
  flow: AuthTimeoutFlow;
}): AuthTimeoutFallbackResult {
  const user = params.session?.user ?? null;
  if (!user) {
    reportAuthTimeoutFallback({
      flow: params.flow,
      reason: 'no_session',
      sessionPresent: false,
      emailsMatch: false,
      sessionUserIdLen: 0,
      attemptedEmailLen: params.attemptedEmail.trim().length,
    });
    return { ok: false, reason: 'no_session', error: AUTH_TIMEOUT_FALLBACK_ERROR };
  }

  if (!sessionEmailMatchesAttempt(user.email, params.attemptedEmail)) {
    reportAuthTimeoutFallback({
      flow: params.flow,
      reason: 'email_mismatch',
      sessionPresent: true,
      emailsMatch: false,
      sessionUserIdLen: user.id.length,
      attemptedEmailLen: params.attemptedEmail.trim().length,
      sessionEmailPresent: Boolean(user.email && user.email.trim().length > 0),
    });
    return { ok: false, reason: 'email_mismatch', error: AUTH_TIMEOUT_FALLBACK_ERROR };
  }

  return { ok: true, user };
}

function reportAuthTimeoutFallback(extra: {
  flow: AuthTimeoutFlow;
  reason: 'no_session' | 'email_mismatch';
  sessionPresent: boolean;
  emailsMatch: boolean;
  sessionUserIdLen: number;
  attemptedEmailLen: number;
  sessionEmailPresent?: boolean;
}): void {
  const message =
    extra.reason === 'email_mismatch'
      ? 'auth timeout fallback rejected: session email does not match attempt'
      : 'auth timeout fallback rejected: no session after timeout';

  // Lengths / booleans only — never emails, passwords, or tokens.
  const safeExtra = {
    auth_flow: extra.flow,
    reason: extra.reason,
    session_present: extra.sessionPresent,
    emails_match: extra.emailsMatch,
    session_user_id_len: extra.sessionUserIdLen,
    attempted_email_len: extra.attemptedEmailLen,
    session_email_present: extra.sessionEmailPresent ?? false,
  };

  console.warn(`[auth] ${message}`, safeExtra);

  // Stale-session mismatch is the silent-false-success failure mode; alert it.
  // No-session is a normal timeout outcome — warn in console only.
  if (extra.reason === 'email_mismatch') {
    Sentry.captureMessage(`[auth] ${message}`, {
      level: 'error',
      tags: {
        auth_alert: 'auth_timeout_stale_session',
        auth_flow: extra.flow,
      },
      extra: safeExtra,
    });
  }
}
