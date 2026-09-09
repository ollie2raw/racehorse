/**
 * Daily Fritz browser-storage helpers. Split out of `dailyFritz/api.ts`
 * (REFACTOR_OPPORTUNITIES R3) — this is client-only cache/checkpoint cleanup,
 * not the network layer.
 */

export const DAILY_FRITZ_TODAY_CACHE_PREFIX = 'racehorse:daily-fritz:today:';

/** Clears only the Daily Fritz "today" hub cache (sessionStorage). */
export function clearDailyFritzTodayCache(userId: string): void {
  if (typeof window === 'undefined' || !userId) return;
  try {
    window.sessionStorage.removeItem(`${DAILY_FRITZ_TODAY_CACHE_PREFIX}${userId}`);
  } catch {
    /* noop */
  }
}

/** Clears in-match localStorage checkpoints for Daily Fritz. */
export function clearDailyFritzMatchSnapshots(): void {
  if (typeof window === 'undefined') return;
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key?.startsWith('racehorse:daily-fritz:') && !key.startsWith(DAILY_FRITZ_TODAY_CACHE_PREFIX)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    /* noop */
  }
}

/** Clears Daily Fritz today cache + in-match saves. Prefer clearDailyFritzTodayCache on soft retries. */
export function clearDailyFritzClientStorage(userId: string): void {
  clearDailyFritzTodayCache(userId);
  clearDailyFritzMatchSnapshots();
}
