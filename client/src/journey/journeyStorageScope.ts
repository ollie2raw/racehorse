/**
 * Which browser-storage namespace Journey data is read from and written to.
 *
 * Journey progress and the attempt log are local-only in the slice, so two people sharing a browser
 * (or one person switching between a guest session and an account) must never see each other's data.
 * The scope is a module-level value set once from the app's auth state; the storage modules derive
 * their keys from it on every read and write, so nothing caches a key across an account switch.
 *
 * Conventions (match `practice/noBrainerLabProgress.ts`: `${PREFIX}:${userId}`):
 *   - guest:       the legacy, un-suffixed key (keeps existing guest data and the E2E fixtures valid)
 *   - signed-in:   `${base}:u:${userSegment}` — the `u:` marker means a user id can never collide with
 *                  the guest namespace, whatever the id looks like.
 */

let currentUserId: string | null = null;

const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,128}$/;

/** Auth user ids are UUIDs in practice; anything outside the safe set is percent-encoded, never interpolated raw. */
function userSegment(userId: string): string {
  return SAFE_SEGMENT.test(userId) ? userId : encodeURIComponent(userId);
}

export function setJourneyStorageUser(userId: string | null | undefined): void {
  currentUserId = userId && userId.length > 0 ? userId : null;
}

export function getJourneyStorageUser(): string | null {
  return currentUserId;
}

/** Stable identifier for the current namespace — usable as a React `key` to remount on scope change. */
export function getJourneyStorageScopeId(): string {
  return currentUserId ? `u:${userSegment(currentUserId)}` : 'guest';
}

/** Suffix for keys whose guest form is the bare legacy key (`rh_journey_progress_v1`). */
export function journeyLegacyKeySuffix(): string {
  return currentUserId ? `:u:${userSegment(currentUserId)}` : '';
}

/** Suffix for keys that are new in the slice and always carry an explicit namespace. */
export function journeyNamespacedKeySuffix(): string {
  return `:${getJourneyStorageScopeId()}`;
}
