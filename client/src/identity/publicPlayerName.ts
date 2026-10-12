/**
 * The name other players see when no real profile username is available
 * (the profile has not loaded yet, or its request failed). Never derived from
 * the account email, the user id or auth metadata: an email's local part used
 * to stand in here and reached opponents and spectators (Phase 4A.1).
 */
export const ANONYMOUS_PLAYER_NAME = 'Player';

/** A profile username when there is one, else ANONYMOUS_PLAYER_NAME. */
export function publicPlayerName(profileUsername: string | null | undefined): string {
  const name = typeof profileUsername === 'string' ? profileUsername.trim() : '';
  return name || ANONYMOUS_PLAYER_NAME;
}
