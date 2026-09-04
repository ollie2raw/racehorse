import { isIP } from 'net';
import type { NextFunction, Request, Response } from 'express';
import { childLogger } from './logger';
import { isTrustedInfraPeer } from './trustedProxy';

const log = childLogger('rate-limit');

export type RateLimitRule = {
  windowMs: number;
  max: number;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
};

type Bucket = {
  count: number;
  resetAt: number;
};

export class InMemoryRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly defaultRule: RateLimitRule) {}

  take(key: string, rule: RateLimitRule = this.defaultRule, now = Date.now()): RateLimitResult {
    const normalizedKey = key.trim() || 'anonymous';
    const existing = this.buckets.get(normalizedKey);
    if (!existing || existing.resetAt <= now) {
      const resetAt = now + rule.windowMs;
      this.buckets.set(normalizedKey, { count: 1, resetAt });
      return { allowed: true, remaining: Math.max(0, rule.max - 1), retryAfterMs: 0 };
    }

    if (existing.count >= rule.max) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(0, existing.resetAt - now),
      };
    }

    existing.count += 1;
    return {
      allowed: true,
      remaining: Math.max(0, rule.max - existing.count),
      retryAfterMs: Math.max(0, existing.resetAt - now),
    };
  }

  check(key: string, rule: RateLimitRule = this.defaultRule, now = Date.now()): RateLimitResult {
    const normalizedKey = key.trim() || 'anonymous';
    const existing = this.buckets.get(normalizedKey);
    if (!existing || existing.resetAt <= now) {
      return { allowed: true, remaining: rule.max, retryAfterMs: 0 };
    }
    if (existing.count >= rule.max) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(0, existing.resetAt - now),
      };
    }
    return {
      allowed: true,
      remaining: Math.max(0, rule.max - existing.count),
      retryAfterMs: Math.max(0, existing.resetAt - now),
    };
  }

  increment(key: string, rule: RateLimitRule = this.defaultRule, now = Date.now()): void {
    const normalizedKey = key.trim() || 'anonymous';
    const existing = this.buckets.get(normalizedKey);
    if (!existing || existing.resetAt <= now) {
      const resetAt = now + rule.windowMs;
      this.buckets.set(normalizedKey, { count: 1, resetAt });
      return;
    }
    existing.count += 1;
  }

  clear(): void {
    this.buckets.clear();
  }
}

function retryAfterSeconds(retryAfterMs: number): string {
  return String(Math.max(1, Math.ceil(retryAfterMs / 1000)));
}

/**
 * The client address a rate-limit bucket is keyed on.
 *
 * AU-3 (HARDENING_PLAN §6.3), corrected 2026-09-04. Prefer `CF-Connecting-IP` —
 * Cloudflare (Render's platform edge) sets it to the verified immediate client
 * and strips any client-supplied value — but only when the request actually
 * transited trusted infra (`isTrustedInfraPeer`): a raw origin request can send
 * that header itself, so on an untrusted peer it is ignored and we fall back to
 * Express's `req.ip` (resolved via the range-based `trust proxy` in
 * `trustedProxy.ts`, which walks `X-Forwarded-For` past every infra hop to the
 * real client — a value the client cannot forge).
 *
 * The earlier `trust proxy: 1` + bare `req.ip` was one hop short of the real
 * Cloudflare→Render chain, so distinct clients bucketed onto shared
 * Render-internal `10.x` keys and hit cross-user false 429s.
 */
function requestIp(req: Request): string {
  if (isTrustedInfraPeer(req.socket.remoteAddress)) {
    const header = req.headers['cf-connecting-ip'];
    const cfIp = (typeof header === 'string' ? header : Array.isArray(header) ? header[0] ?? '' : '').trim();
    if (cfIp && isIP(cfIp)) return cfIp;
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

export function createRateLimitMiddleware(
  limiter: InMemoryRateLimiter,
  rule: RateLimitRule,
  scope: string,
  getUserId?: (req: Request) => string | null,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const userId = getUserId?.(req) ?? null;
    const key = userId
      ? `${scope}:user:${userId}`
      : `${scope}:ip:${requestIp(req)}`;
    const result = limiter.take(key, rule);
    res.setHeader('X-RateLimit-Limit', String(rule.max));
    res.setHeader('X-RateLimit-Remaining', String(result.remaining));
    if (result.allowed) {
      next();
      return;
    }
    // AU-3 verification hook: `keyIp` (what the bucket is keyed on) must be a
    // real, distinct client address — not a shared Render-internal `10.x` hop
    // and not a client-supplied `X-Forwarded-For` / `CF-Connecting-IP` value.
    log.warn(
      {
        scope,
        key,
        keyIp: requestIp(req),
        reqIp: req.ip,
        peer: req.socket.remoteAddress ?? null,
        cfConnectingIp: req.headers['cf-connecting-ip'] ?? null,
        xffRaw: req.headers['x-forwarded-for'] ?? null,
      },
      'rate limited',
    );
    res.setHeader('Retry-After', retryAfterSeconds(result.retryAfterMs));
    res.status(429).json({ error: 'rate_limited', retryAfterMs: result.retryAfterMs });
  };
}

export function socketRateLimitKey(socket: {
  id?: string;
  data?: { userId?: unknown };
  handshake?: { address?: string };
}): string {
  const userId = typeof socket.data?.userId === 'string' && socket.data.userId.trim()
    ? socket.data.userId.trim()
    : null;
  return userId ?? socket.handshake?.address ?? socket.id ?? 'unknown';
}

const getEnvInt = (key: string, defaultValue: number): number => {
  const val = process.env[key];
  if (!val) return defaultValue;
  const parsed = parseInt(val, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
};

export const failedRoomLookupLimiter = new InMemoryRateLimiter({
  windowMs: getEnvInt('LIMIT_FAILED_ROOM_LOOKUPS_WINDOW', 60_000),
  max: getEnvInt('LIMIT_FAILED_ROOM_LOOKUPS_MAX', 5),
});

