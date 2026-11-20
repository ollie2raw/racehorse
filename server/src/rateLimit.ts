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

export type InMemoryRateLimiterOptions = {
  /** How often expired buckets are swept out (default 60 s). */
  sweepIntervalMs?: number;
  /** Hard cap on live buckets; past it the oldest-created ones are dropped (default 100 000). */
  maxKeys?: number;
};

const DEFAULT_SWEEP_INTERVAL_MS = 60_000;
const DEFAULT_MAX_KEYS = 100_000;

export class InMemoryRateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly sweepIntervalMs: number;
  private readonly maxKeys: number;
  private lastSweepAt: number | null = null;

  constructor(private readonly defaultRule: RateLimitRule, options: InMemoryRateLimiterOptions = {}) {
    this.sweepIntervalMs = options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
    this.maxKeys = Math.max(1, options.maxKeys ?? DEFAULT_MAX_KEYS);
  }

  /** Live buckets held in memory (expired ones are swept lazily, so this can briefly exceed the live count). */
  get size(): number {
    return this.buckets.size;
  }

  /**
   * Keys (client addresses, user ids) must not live past their window: drop expired buckets at most once per
   * `sweepIntervalMs`, and if rotating keys still push the map to `maxKeys`, drop the oldest-created 10 %. Dropping an
   * active bucket only forgets that caller's count (fail-open), never blocks anyone.
   */
  private sweep(now: number): void {
    if (this.lastSweepAt === null) {
      this.lastSweepAt = now;
      return;
    }
    if (now - this.lastSweepAt < this.sweepIntervalMs && this.buckets.size < this.maxKeys) return;
    this.lastSweepAt = now;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
    if (this.buckets.size >= this.maxKeys) {
      let toDrop = Math.ceil(this.maxKeys * 0.1);
      for (const key of this.buckets.keys()) {
        if (toDrop-- <= 0) break;
        this.buckets.delete(key);
      }
    }
  }

  take(key: string, rule: RateLimitRule = this.defaultRule, now = Date.now()): RateLimitResult {
    this.sweep(now);
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
    this.sweep(now);
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

export type RateLimitMiddlewareOptions = {
  /**
   * Whether a 429 log line may carry the caller's address (key, keyIp, reqIp, peer, CF-Connecting-IP, X-Forwarded-For).
   * Default true: that line is the AU-3 verification hook. Pass false, or a predicate, for requests whose published
   * privacy statement says the address is not recorded (POST /api/rum); the line then carries only the scope.
   */
  logClientAddress?: boolean | ((req: Request) => boolean);
};

export function createRateLimitMiddleware(
  limiter: InMemoryRateLimiter,
  rule: RateLimitRule,
  scope: string,
  getUserId?: (req: Request) => string | null,
  options: RateLimitMiddlewareOptions = {},
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
    const logAddress = typeof options.logClientAddress === 'function' ? options.logClientAddress(req) : options.logClientAddress !== false;
    if (logAddress) {
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
    } else {
      log.warn({ scope }, 'rate limited');
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

export const failedRoomLookupLimiter = new InMemoryRateLimiter({
  windowMs: getEnvInt('LIMIT_FAILED_ROOM_LOOKUPS_WINDOW', 60_000),
  max: getEnvInt('LIMIT_FAILED_ROOM_LOOKUPS_MAX', 5),
});

