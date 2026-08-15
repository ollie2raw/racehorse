import type { NextFunction, Request, Response } from 'express';
import type { Redis } from 'ioredis';
import { childLogger } from './logger';
import { getRedisDataClient } from './redisClient';

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

export interface RateLimiter {
  take(key: string, rule?: RateLimitRule, now?: number): Promise<RateLimitResult>;
  check(key: string, rule?: RateLimitRule, now?: number): Promise<RateLimitResult>;
  increment(key: string, rule?: RateLimitRule, now?: number): Promise<void>;
}

type Bucket = {
  count: number;
  resetAt: number;
};

/**
 * Single-process fallback. Buckets live in local memory, so limits are
 * per-instance only — fine for local dev, wrong for a horizontally-scaled
 * deployment (see RedisRateLimiter).
 */
export class InMemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly defaultRule: RateLimitRule) {}

  async take(key: string, rule: RateLimitRule = this.defaultRule, now = Date.now()): Promise<RateLimitResult> {
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

  async check(key: string, rule: RateLimitRule = this.defaultRule, now = Date.now()): Promise<RateLimitResult> {
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

  async increment(key: string, rule: RateLimitRule = this.defaultRule, now = Date.now()): Promise<void> {
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

// Atomic "increment, and set expiry only on first hit in the window" — avoids a
// separate GET+SET round trip and a race between two instances hitting the same
// key at once. Returns [count, pttl] (pttl is -1 if the key has no expiry yet,
// which we treat as "brand new window" on the client side below).
const TAKE_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local pttl = redis.call('PTTL', KEYS[1])
return { count, pttl }
`;

/**
 * Redis-backed limiter — required once the server runs as more than one
 * instance (Vercel Fluid Compute), since counts must be shared across
 * processes for a rate limit to mean anything.
 */
export class RedisRateLimiter implements RateLimiter {
  constructor(
    private readonly redis: Redis,
    private readonly defaultRule: RateLimitRule,
    private readonly keyPrefix: string,
  ) {}

  async take(key: string, rule: RateLimitRule = this.defaultRule, _now = Date.now()): Promise<RateLimitResult> {
    const normalizedKey = key.trim() || 'anonymous';
    const redisKey = `ratelimit:${this.keyPrefix}:${normalizedKey}`;
    try {
      const [count, pttl] = (await this.redis.eval(
        TAKE_SCRIPT,
        1,
        redisKey,
        String(rule.windowMs),
      )) as [number, number];
      const retryAfterMs = pttl > 0 ? pttl : rule.windowMs;
      if (count > rule.max) {
        return { allowed: false, remaining: 0, retryAfterMs };
      }
      return { allowed: true, remaining: Math.max(0, rule.max - count), retryAfterMs };
    } catch (err) {
      // Fail open: a Redis outage should not take gameplay down with it.
      log.error({ err, redisKey }, 'redis rate limit check failed, allowing request');
      return { allowed: true, remaining: rule.max, retryAfterMs: 0 };
    }
  }

  async check(key: string, rule: RateLimitRule = this.defaultRule): Promise<RateLimitResult> {
    const normalizedKey = key.trim() || 'anonymous';
    const redisKey = `ratelimit:${this.keyPrefix}:${normalizedKey}`;
    try {
      const [countRaw, pttl] = await Promise.all([this.redis.get(redisKey), this.redis.pttl(redisKey)]);
      const count = countRaw ? parseInt(countRaw, 10) : 0;
      const retryAfterMs = pttl > 0 ? pttl : 0;
      if (count >= rule.max) {
        return { allowed: false, remaining: 0, retryAfterMs };
      }
      return { allowed: true, remaining: Math.max(0, rule.max - count), retryAfterMs };
    } catch (err) {
      log.error({ err, redisKey }, 'redis rate limit check failed, allowing request');
      return { allowed: true, remaining: rule.max, retryAfterMs: 0 };
    }
  }

  async increment(key: string, rule: RateLimitRule = this.defaultRule): Promise<void> {
    await this.take(key, rule);
  }
}

function retryAfterSeconds(retryAfterMs: number): string {
  return String(Math.max(1, Math.ceil(retryAfterMs / 1000)));
}

function requestIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0]?.trim() || req.ip || 'unknown';
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

export function createRateLimitMiddleware(
  limiter: RateLimiter,
  rule: RateLimitRule,
  scope: string,
  getUserId?: (req: Request) => string | null,
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const userId = getUserId?.(req) ?? null;
    const key = userId
      ? `${scope}:user:${userId}`
      : `${scope}:ip:${requestIp(req)}`;
    const result = await limiter.take(key, rule);
    res.setHeader('X-RateLimit-Limit', String(rule.max));
    res.setHeader('X-RateLimit-Remaining', String(result.remaining));
    if (result.allowed) {
      next();
      return;
    }
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

/**
 * Creates a Redis-backed limiter when REDIS_URL is configured, otherwise falls
 * back to an in-memory limiter (single-instance only — fine for local dev).
 */
export function createRateLimiter(defaultRule: RateLimitRule, keyPrefix: string): RateLimiter {
  const redis = getRedisDataClient();
  if (redis) {
    return new RedisRateLimiter(redis, defaultRule, keyPrefix);
  }
  return new InMemoryRateLimiter(defaultRule);
}

export const failedRoomLookupLimiter = createRateLimiter(
  {
    windowMs: getEnvInt('LIMIT_FAILED_ROOM_LOOKUPS_WINDOW', 60_000),
    max: getEnvInt('LIMIT_FAILED_ROOM_LOOKUPS_MAX', 5),
  },
  'failed-room-lookups',
);

