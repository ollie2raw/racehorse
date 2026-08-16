import type express from 'express';
import { config } from '../../config';

const authenticatedUserIdCache = new Map<string, { userId: string | null; expiresAt: number }>();
const AUTHENTICATED_USER_ID_TTL_MS = 60_000;

export function getUserIdFromAuthHeaderSync(req: express.Request): string | null {
  const authHeader = typeof req.headers.authorization === 'string'
    ? req.headers.authorization.trim() : '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payloadJson = Buffer.from(parts[1], 'base64').toString('utf-8');
    const payload = JSON.parse(payloadJson) as { sub?: unknown };
    return typeof payload.sub === 'string' && payload.sub.trim() ? payload.sub.trim() : null;
  } catch {
    return null;
  }
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

export async function getAuthenticatedUserIdFromToken(token: string | null): Promise<string | null> {
  if (!token) return null;
  const cached = authenticatedUserIdCache.get(token);
  if (cached && cached.expiresAt > Date.now()) return cached.userId;

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
    authenticatedUserIdCache.set(token, { userId: null, expiresAt: Date.now() + 10_000 });
    return null;
  }

  const user = (await response.json()) as { id?: unknown };
  const userId = typeof user.id === 'string' ? user.id : null;
  authenticatedUserIdCache.set(token, { userId, expiresAt: Date.now() + AUTHENTICATED_USER_ID_TTL_MS });
  return userId;
}