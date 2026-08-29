/**
 * The new-password rules, shared by the recovery-link modal and the signed-in
 * change on the Settings page, so the two cannot drift.
 */

/** Supabase's own floor. Raising it here would only reject locally. */
export const MIN_PASSWORD_LENGTH = 6;

export type PasswordChangeResolution = { password: string } | { error: string };

export function resolvePasswordChange(
  password: string,
  confirmPassword: string,
): PasswordChangeResolution {
  // Length first: "passwords do not match" about two too-short strings sends
  // the user to fix the wrong thing.
  if (password.length < MIN_PASSWORD_LENGTH || confirmPassword.length < MIN_PASSWORD_LENGTH) {
    return { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  if (password !== confirmPassword) return { error: 'Passwords do not match.' };
  return { password };
}
