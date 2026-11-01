import { isGuestPlayEnabled } from '../config/guestPlayFeature';

/** Supabase marks an anonymous (guest) user with `is_anonymous`; a permanent account has it false or absent. */
export function isAnonymousUser(user: { is_anonymous?: boolean } | null | undefined): boolean {
  return user?.is_anonymous === true;
}

/**
 * A guest has no handle of their own until they make an account, so the app's "pick a username" prompt, which fires
 * for any placeholder name, must not fire for them. It belongs to the upgrade step.
 */
export function shouldPromptForUsername(
  user: { is_anonymous?: boolean } | null | undefined,
  hasPlaceholderUsername: boolean,
): boolean {
  return Boolean(user) && !isAnonymousUser(user) && hasPlaceholderUsername;
}

/**
 * Whether to treat this user as a guest in the UI. Needs the flag as well as the anonymous marker, so a build with guest
 * play off never shows guest wording, whatever session happens to be stored.
 */
export function isGuestUser(user: { is_anonymous?: boolean } | null | undefined): boolean {
  return isGuestPlayEnabled() && isAnonymousUser(user);
}
