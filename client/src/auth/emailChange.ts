/**
 * Email-change validation, kept out of useAuth so it can be tested without a
 * Supabase client — the same split as authErrors.ts and
 * authTimeoutSessionFallback.ts.
 */

export type EmailChangeResolution = { email: string } | { error: string };

/** Deliberately loose: Supabase is the authority, this only catches typos. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function resolveEmailChange(
  input: string,
  currentEmail: string | null | undefined,
): EmailChangeResolution {
  const normalized = input.trim().toLowerCase();
  if (!normalized) return { error: 'Enter your new email address.' };
  if (!EMAIL_PATTERN.test(normalized)) return { error: 'Enter a valid email address.' };
  if (currentEmail && currentEmail.trim().toLowerCase() === normalized) {
    // Supabase accepts this and mails a confirmation link to an address the
    // user already has, which reads as a broken feature.
    return { error: 'That is already your email address.' };
  }
  return { email: normalized };
}

/**
 * `updateUser({ email })` does not change the address. It sends a confirmation
 * link to the new one — and on projects with Supabase's "secure email change"
 * setting enabled (the default for new projects), a link to the current one
 * too, both of which must be followed. So the UI reports a pending change,
 * never a completed one.
 */
export function EMAIL_CHANGE_PENDING_MESSAGE(email: string): string {
  return `Check ${email} for a confirmation link. Your sign-in email changes once you confirm it — and if your account also asks your current address to approve the change, follow that link too.`;
}
