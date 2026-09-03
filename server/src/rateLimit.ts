import type { NextFunction, Request, Response } from 'express';
import { childLogger } from './logger';

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
 * AU-3 (HARDENING_PLAN §6.3): use Express's resolved `req.ip`. With
 * `app.set('trust proxy', 1)` this is the rightmost `X-Forwarded-For` entry —
 * the address Render's load balancer recorded — which a client cannot forge
 * (they can only prepend). Previously this read `x-forwarded-for.split(',')[0]`
 * (the client-settable leftmost entry), so rotating that header gave an
 * unlimited supply of fresh rate-limit buckets.
 */
function requestIp(req: Request): string {
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
    // AU-3 verification hook: after `trust proxy` is set, `reqIp` must be the
    // real client IP, not a value from a client-supplied `X-Forwarded-For`
    // prefix. If it ever shows a spoofed prefix, the trust-proxy hop count is
    // wrong.
    log.warn(
      { scope, key, reqIp: req.ip, xffRaw: req.headers['x-forwarded-for'] ?? null },
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

