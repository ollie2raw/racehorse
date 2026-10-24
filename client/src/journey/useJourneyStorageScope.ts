import { setJourneyStorageUser } from './journeyStorageScope';

/**
 * Points Journey's local storage at the signed-in user's namespace (or the guest namespace).
 *
 * The assignment is synchronous and idempotent on purpose: anything rendered in the same pass — the
 * Journey trail, the match route, the home summary loaders — must already read the right namespace,
 * and an effect would run after those reads. While auth is still resolving the previous scope is kept,
 * so a signed-in user's reload never briefly reads (or writes) the guest namespace's identity as theirs;
 * the Journey and match routes additionally wait for `authLoading` before rendering.
 */
export function useJourneyStorageScope(userId: string | null | undefined, authLoading: boolean): void {
  if (!authLoading) setJourneyStorageUser(userId ?? null);
}
