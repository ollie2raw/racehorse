import { useEffect } from 'react';
import { isAnonymousUser } from '../auth/guestSession';

/**
 * Keeps a signed-in player's Journey progress in step with their account (docs/progress-sync.md): pulled on sign-in and when the tab returns, pushed shortly after
 * every local change. Guests (anonymous users) and signed-out visitors stay local-only, exactly as before.
 *
 * Mounted once, in App, next to `useJourneyStorageScope`. This file is deliberately tiny: the sync itself (and the chapter definitions it needs) is loaded on
 * demand, only for a signed-in player, so it adds nothing to the main bundle. Progress made before that module arrives is not lost: its first step is a pull that
 * merges, and a push of whatever the server lacks.
 */
export function useJourneyProgressSync(user: { id: string; is_anonymous?: boolean } | null | undefined, authLoading: boolean): void {
  const userId = user?.id ?? null;
  const anonymous = isAnonymousUser(user);

  useEffect(() => {
    if (authLoading || !userId || anonymous) return undefined;

    let cancelled = false;
    let stop: (() => void) | null = null;
    void import('./journeyProgressSyncRuntime')
      .then(({ startJourneyProgressSync }) => {
        if (!cancelled) stop = startJourneyProgressSync(userId);
      })
      .catch(() => {
        // The chunk did not load (offline): nothing to sync with, and the app is unaffected. The next sign-in tries again.
      });

    return () => {
      cancelled = true;
      stop?.();
    };
  }, [userId, anonymous, authLoading]);
}
