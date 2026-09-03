import { createHash } from 'crypto';
import type express from 'express';
import { config } from '../../config';

const authenticatedUserIdCache = new Map<string, { userId: string | null; expiresAt: number }>();
/**
 * AU-1 (HARDENING_PLAN §6.3): a successful `/auth/v1/user` result is trusted for
 * this long before re-checking upstream. This is the server-side half of the
 * token-revocation lag — a token banned/expired at Supabase keeps working for
 * up to this window. Cut 60s → 15s. The remaining revocation gap ("a client
 * `signOut()` does not revoke the access-token JWT — it lives to its `exp`") is
 * bounded only by the Supabase project's JWT-expiry setting (human action) or a
 * server-side denylist (scale-gated).
 */
const AUTHENTICATED_USER_ID_TTL_MS = 15_000;
/**
 * Hard ceiling on cached tokens. Entries carried a TTL but were never evicted,
 * so the map grew by one entry per token the process ever saw — and tokens
 * rotate, so it grew without bound for the lifetime of the process.
 */
const AUTHENTICATED_USER_ID_MAX_ENTRIES = 1_000;

/** Concurrent requests carrying the same token share one upstream validation. */
const authenticatedUserIdInFlight = new Map<string, Promise<string | null>>();

/**
 * Tokens are keyed by digest rather than stored verbatim: the cache outlives
 * the request that carried the token, and there is no reason to keep bearer
 * credentials in a long-lived map.
 */
function tokenCacheKey(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

/** Drop expired entries, then oldest-first until back under the ceiling. */
function pruneAuthenticatedUserIdCache(now: number): void {
  for (const [key, entry] of authenticatedUserIdCache) {
    if (entry.expiresAt <= now) authenticatedUserIdCache.delete(key);
  }
  while (authenticatedUserIdCache.size > AUTHENTICATED_USER_ID_MAX_ENTRIES) {
    const oldest = authenticatedUserIdCache.keys().next().value;
    if (oldest === undefined) break;
    authenticatedUserIdCache.delete(oldest);
  }
}

function rememberAuthenticatedUserId(key: string, userId: string | null, ttlMs: number): void {
  const now = Date.now();
  authenticatedUserIdCache.set(key, { userId, expiresAt: now + ttlMs });
  pruneAuthenticatedUserIdCache(now);
}

/** Test-only: drop all cached token validations. */
export function resetAuthenticatedUserIdCache(): void {
  authenticatedUserIdCache.clear();
  authenticatedUserIdInFlight.clear();
}

/** Test-only: current number of cached token validations. */
export function authenticatedUserIdCacheSize(): number {
  return authenticatedUserIdCache.size;
}

export async function getAuthenticatedUserId(req: express.Request): Promise<string | null> {
  const authHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization.trim() : '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  if (process.env.NODE_ENV !== 'production' && token === 'e2e-daily-fritz') {
    const headerUser = req.headers['x-e2e-daily-fritz-user'];
    const fromHeader = typeof headerUser === 'string' ? headerUser.trim() : '';
    if (fromHeader) return fromHeader;
    const fromEnv = process.env.E2E_DAILY_FRITZ_USER_ID?.trim();
    if (fromEnv) return fromEnv;
  }
  return getAuthenticatedUserIdFromToken(token ?? null);
}

/**
 * AU-8 (HARDENING_PLAN §6.3): the single canonical "verify a Bearer token →
 * verified user id (or null)" entry point. Cached (`AUTHENTICATED_USER_ID_TTL_MS`),
 * in-flight-deduped, 12s upstream timeout. `social/socialAuth.ts` and
 * `scheduledTournament/tournamentAuth.ts` were each hitting `/auth/v1/user`
 * directly (uncached, per-request) — they now route through this. Callers that
 * need extra checks (tournament's `isValidUuid` + payload-userId-match) wrap it.
 */
export async function verifyBearerToken(token: string | null | undefined): Promise<string | null> {
  return getAuthenticatedUserIdFromToken(token ?? null);
}

export async function getAuthenticatedUserIdFromToken(token: string | null): Promise<string | null> {
  if (!token) return null;
  const key = tokenCacheKey(token);
  const cached = authenticatedUserIdCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.userId;

  // A cold cache plus a burst of parallel requests — a page load fans out to
  // roughly nine — would otherwise validate the same token nine times.
  const pending = authenticatedUserIdInFlight.get(key);
  if (pending) return pending;

  const validation = validateTokenUpstream(token, key)
    .finally(() => { authenticatedUserIdInFlight.delete(key); });
  authenticatedUserIdInFlight.set(key, validation);
  return validation;
}

async function validateTokenUpstream(token: string, key: string): Promise<string | null> {
  const supabaseUrl = config.supabaseUrl;
  const serviceKey = config.supabaseServiceKey;
  if (!supabaseUrl || !serviceKey) {
    throw new Error('Supabase auth configuration is required.');
  }

  const controller = new AbortController();
  const authTimeoutMs = 12_000;
  const authTimeout = setTimeout(() => controller.abort(), authTimeoutMs);
  let response: Response;
  try {
    response = await fetch(new URL('/auth/v1/user', supabaseUrl), {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.warn('[auth] token validation timed out', { authTimeoutMs });
      return null;
    }
    throw error;
  } finally {
    clearTimeout(authTimeout);
  }
  if (!response.ok) {
    rememberAuthenticatedUserId(key, null, 10_000);
    return null;
  }

  const user = (await response.json()) as { id?: unknown };
  const userId = typeof user.id === 'string' ? user.id : null;
  rememberAuthenticatedUserId(key, userId, AUTHENTICATED_USER_ID_TTL_MS);
  return userId;
}