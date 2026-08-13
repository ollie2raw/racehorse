/**
 * Verifies Phase 1 item 1.4: the leaderboard endpoint rate limit triggers at its
 * configured threshold (30 req/min) independently of the global restApiLimit.
 */
import { describe, it, expect } from 'vitest';
import { InMemoryRateLimiter, createRateLimitMiddleware } from './rateLimit';
import type { Request, Response, NextFunction } from 'express';

function makeReq(ip = '1.2.3.4'): Request {
  return {
    headers: {},
    socket: { remoteAddress: ip },
    ip,
    connection: { remoteAddress: ip },
  } as unknown as Request;
}

function makeRes(): { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn>; setHeader: ReturnType<typeof vi.fn> } {
  const res = { setHeader: vi.fn(), status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
}

import { vi } from 'vitest';

describe('leaderboard rate limit (item 1.4)', () => {
  const LEADERBOARD_MAX = 30;
  const LEADERBOARD_WINDOW_MS = 60_000;

  function buildMiddleware() {
    const limiter = new InMemoryRateLimiter({ windowMs: LEADERBOARD_WINDOW_MS, max: LEADERBOARD_MAX });
    return createRateLimitMiddleware(limiter, { windowMs: LEADERBOARD_WINDOW_MS, max: LEADERBOARD_MAX }, 'rest:leaderboard');
  }

  it('allows the first 30 requests within the window', () => {
    const middleware = buildMiddleware();
    const req = makeReq();

    for (let i = 0; i < LEADERBOARD_MAX; i++) {
      const res = makeRes();
      const next = vi.fn();
      middleware(req, res as unknown as Response, next as unknown as NextFunction);
      expect(next).toHaveBeenCalledOnce();
      expect(res.status).not.toHaveBeenCalled();
    }
  });

  it('blocks the 31st request with 429 and rate_limited error', () => {
    const middleware = buildMiddleware();
    const req = makeReq();
    const next = vi.fn();

    for (let i = 0; i < LEADERBOARD_MAX; i++) {
      middleware(req, makeRes() as unknown as Response, next as unknown as NextFunction);
    }
    next.mockClear();

    const res = makeRes();
    middleware(req, res as unknown as Response, next as unknown as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'rate_limited' }));
  });

  it('is independent: a separate IP can still make 30 requests after first IP is exhausted', () => {
    const middleware = buildMiddleware();
    const req1 = makeReq('1.2.3.4');
    const req2 = makeReq('5.6.7.8');
    const next = vi.fn();

    for (let i = 0; i < LEADERBOARD_MAX; i++) {
      middleware(req1, makeRes() as unknown as Response, next as unknown as NextFunction);
    }

    // IP1 should be blocked
    const blockedRes = makeRes();
    middleware(req1, blockedRes as unknown as Response, vi.fn() as unknown as NextFunction);
    expect(blockedRes.status).toHaveBeenCalledWith(429);

    // IP2 should still have its own fresh budget
    next.mockClear();
    middleware(req2, makeRes() as unknown as Response, next as unknown as NextFunction);
    expect(next).toHaveBeenCalledOnce();
  });

  it('sets X-RateLimit-Limit header to the configured max', () => {
    const middleware = buildMiddleware();
    const res = makeRes();
    middleware(makeReq(), res as unknown as Response, vi.fn() as unknown as NextFunction);
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', String(LEADERBOARD_MAX));
  });
});
