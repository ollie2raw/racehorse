import { isGuestPlayEnabled } from '../config/guestPlayFeature';

/**
 * Play vs Fritz works signed out, but a signed-out game is never recorded (a record belongs to an account). With guest play on, tapping Play creates the
 * guest session first, so the game is recorded and an account made afterwards keeps it. Only a visitor with no session at all gets one.
 *
 * Never blocks play: if the session cannot be made (offline, anonymous sign-ins off), the game starts anyway, just as it does today.
 */
export async function ensureGuestBeforePlay(
  isSignedIn: boolean,
  ensureGuestSession: (() => Promise<{ error: string | null }>) | undefined,
): Promise<void> {
  if (isSignedIn || !ensureGuestSession || !isGuestPlayEnabled()) return;
  try {
    await ensureGuestSession();
  } catch {
    /* play on without a session */
  }
}
