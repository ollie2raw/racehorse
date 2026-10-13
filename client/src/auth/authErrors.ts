type AuthLikeError = {
  message?: string;
  status?: number;
  code?: string;
  name?: string;
};

/**
 * Player-facing copy for the auth email states (reset, confirmation, email
 * change). Kept free of Supabase and Capacitor imports so it can be tested
 * directly — the same split as emailChange.ts.
 */
export const AUTH_GENERIC_ERROR_MESSAGE = 'Something went wrong. Try again.';
/** Supabase 429s: "email rate limit exceeded", "For security purposes, you can only request this after N seconds". */
export const AUTH_RATE_LIMITED_MESSAGE = 'Too many requests — wait a minute and try again.';
/** Network failures, timeouts and gateway errors: the request may never have arrived. */
export const AUTH_UNAVAILABLE_MESSAGE = 'We couldn’t reach the sign-in service. Check your connection and try again.';
/** Supabase accepted the request but its mailer failed. No provider details for players. */
export const AUTH_EMAIL_SEND_FAILED_MESSAGE = 'We couldn’t send that email right now. Wait a few minutes and try again.';
/** The redirect allowlist rejected our URL — an operator problem, not the player's. */
export const AUTH_RESET_UNAVAILABLE_MESSAGE = 'Password reset isn’t available right now. Try again later.';

/**
 * Neutral on purpose: Supabase answers the same whether or not the address has
 * an account, and so must we, or the form becomes a way to test addresses.
 */
export const PASSWORD_RESET_SENT_MESSAGE = 'If that email has an account, we sent a reset link.';

/**
 * The reset link always opens playracehorse.com (see authRedirect.ts) — in the
 * iOS app the WebView origin cannot receive it — so app players finish on the
 * web and then come back to sign in.
 */
export function passwordResetSentMessage(isNativeApp: boolean): string {
  return isNativeApp
    ? `${PASSWORD_RESET_SENT_MESSAGE} Open the link on this device; after you set a new password, return to the app and sign in.`
    : `${PASSWORD_RESET_SENT_MESSAGE} Open the link on this device to set a new password.`;
}

const RATE_LIMIT_CODES = new Set(['over_email_send_rate_limit', 'over_request_rate_limit', 'over_sms_send_rate_limit']);

function isRateLimited(error: AuthLikeError, lower: string): boolean {
  return (
    error.status === 429 ||
    (error.code != null && RATE_LIMIT_CODES.has(error.code)) ||
    lower.includes('rate limit') ||
    lower.includes('for security purposes') ||
    lower.includes('too many requests')
  );
}

function isUnavailable(error: AuthLikeError, lower: string): boolean {
  return (
    // Gateway / availability codes only. A plain 500 can be a real answer
    // (e.g. a signup trigger rejecting the row), which this must not disguise
    // as a connection problem.
    error.status === 502 ||
    error.status === 503 ||
    error.status === 504 ||
    error.name === 'AuthRetryableFetchError' ||
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('network request failed') ||
    lower.includes('load failed') ||
    lower.includes('timed out')
  );
}

/** Map Supabase auth errors to clearer player-facing copy. */
export function formatAuthErrorMessage(error: AuthLikeError | null | undefined): string {
  if (!error) return AUTH_GENERIC_ERROR_MESSAGE;

  const message = error.message?.trim() || AUTH_GENERIC_ERROR_MESSAGE;
  const lower = message.toLowerCase();

  if (isRateLimited(error, lower)) return AUTH_RATE_LIMITED_MESSAGE;

  // Supabase reports mailer failures as a 500 with this prefix.
  if (lower.includes('error sending')) return AUTH_EMAIL_SEND_FAILED_MESSAGE;

  if (lower.includes('redirect') && lower.includes('url')) return AUTH_RESET_UNAVAILABLE_MESSAGE;

  if (isUnavailable(error, lower)) return AUTH_UNAVAILABLE_MESSAGE;

  return message;
}
