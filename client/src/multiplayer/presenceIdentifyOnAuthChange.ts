export type PresenceIdentifyPayload = { userId: string | null; username: string; authToken: string | null };

/**
 * What a connected socket must tell the server when the auth fingerprint (`userId|email|username|token`) changes.
 * - signed in: identify as that account with its current token (covers A -> B and token rotation);
 * - signed out after having been signed in: downgrade to a guest identify so the server stops treating the socket
 *   as the previous account (sign-out, expiry/revocation, another tab);
 * - never signed in (guest -> guest): nothing to say.
 */
export function presenceIdentifyForAuthChange(input: {
  previousFingerprint: string;
  userId: string | null;
  username: string;
  authToken: string | null;
}): PresenceIdentifyPayload | null {
  if (input.userId) return { userId: input.userId, username: input.username, authToken: input.authToken };
  if (input.previousFingerprint.split('|')[0]) return { userId: null, username: 'Guest', authToken: null };
  return null;
}
