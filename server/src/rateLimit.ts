import type { NextFunction, Request, Response } from 'express';

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

  clear(): void {
    this.buckets.clear();
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
  limiter: InMemoryRateLimiter,
  rule: RateLimitRule,
  scope: string,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = limiter.take(`${scope}:${requestIp(req)}`, rule);
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

