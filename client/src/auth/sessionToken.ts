/**
 * The current Supabase access token, held in memory.
 *
 * `supabase.auth.getSession()` was called on every outgoing request — once in
 * `getAuthHeaders` to build the Authorization header, and again in
 * `socialApi.authCacheScope` to build a cache key. In supabase-js v2 that call
 * acquires a lock and may trigger a refresh, so it is not free, and a page load
 * that fans out to nine requests paid for it nine times over.
 *
 * The client already receives every token change through `onAuthStateChange`,
 * so the token can simply be kept here and read synchronously. `getSession()`
 * is still the fallback for the first read before any auth event has landed,
 * and its result is cached the same way.
 */

type CachedSession = { token: string | null; userId: string | null };

let cached: CachedSession | null = null;
let inFlight: Promise<CachedSession> | null = null;
/** Bumped by every auth-driven write/clear so a slower in-flight load can tell it is stale. */
let epoch = 0;

/**
 * Record the session from an auth event. Called by the auth provider on every
 * `onAuthStateChange`, which is what keeps this authoritative.
 */
export function setCachedSession(token: string | null, userId: string | null): void {
  epoch += 1;
  cached = { token, userId };
}

export function clearCachedSession(): void {
  epoch += 1;
  cached = null;
  inFlight = null;
}

/** Synchronous read. Null when no auth event has landed yet. */
export function peekCachedSession(): CachedSession | null {
  return cached;
}

/**
 * The current session, from cache when available. Concurrent cold reads share
 * one `getSession()` call rather than each making their own.
 */
export async function getCachedSession(
  loadSession: () => Promise<CachedSession>,
): Promise<CachedSession> {
  if (cached) return cached;
  if (inFlight) return inFlight;

  // A load that began before an auth event (sign-out, account switch) describes the PREVIOUS principal: its result
  // is returned to the callers that asked, but never written into the cache over what the event established.
  const startedAt = epoch;
  const load: Promise<CachedSession> = loadSession()
    .then((session) => {
      if (epoch === startedAt) cached = session;
      return session;
    })
    .catch(() => ({ token: null, userId: null }))
    .finally(() => { if (inFlight === load) inFlight = null; });
  inFlight = load;

  return load;
}
