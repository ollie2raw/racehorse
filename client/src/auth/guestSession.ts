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
