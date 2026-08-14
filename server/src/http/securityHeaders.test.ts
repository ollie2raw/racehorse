import { describe, it, expect, vi } from 'vitest';
import { InMemoryRateLimiter, createRateLimitMiddleware } from '../rateLimit';
import type { Request, Response, NextFunction } from 'express';

function makeRes() {
  const headers: Record<string, string> = {};
  return {
    setHeader: (name: string, value: string) => { headers[name] = value; },
    headers,
  } as unknown as Response & { headers: Record<string, string> };
}

function makeReq(override?: Partial<Request>): Request {
  return { headers: {}, ip: '127.0.0.1', socket: { remoteAddress: '127.0.0.1' } as never, ...override } as Request;
}

const next: NextFunction = vi.fn();

describe('security headers middleware', () => {
  const middleware = (_req: Request, res: Response, n: NextFunction): void => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    n();
  };

  it('sets X-Content-Type-Options: nosniff', () => {
    const res = makeRes();
    middleware(makeReq(), res, next);
    expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
  });

  it('sets X-Frame-Options: DENY', () => {
    const res = makeRes();
    middleware(makeReq(), res, next);
    expect(res.headers['X-Frame-Options']).toBe('DENY');
  });

  it('sets Referrer-Policy', () => {
    const res = makeRes();
    middleware(makeReq(), res, next);
    expect(res.headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
  });

  it('sets Permissions-Policy blocking sensors', () => {
    const res = makeRes();
    middleware(makeReq(), res, next);
    expect(res.headers['Permissions-Policy']).toContain('geolocation=()');
    expect(res.headers['Permissions-Policy']).toContain('microphone=()');
    expect(res.headers['Permissions-Policy']).toContain('camera=()');
  });

  it('calls next()', () => {
    const res = makeRes();
    const n = vi.fn();
    middleware(makeReq(), res, n);
    expect(n).toHaveBeenCalledOnce();
  });
});

describe('createRateLimitMiddleware response headers', () => {
  it('sets X-RateLimit-Limit and X-RateLimit-Remaining on allowed requests', () => {
    const limiter = new InMemoryRateLimiter({ windowMs: 60_000, max: 10 });
    const mw = createRateLimitMiddleware(limiter, { windowMs: 60_000, max: 10 }, 'test');
    const res = makeRes();
    mw(makeReq(), res, next);
    expect(res.headers['X-RateLimit-Limit']).toBe('10');
    expect(res.headers['X-RateLimit-Remaining']).toBe('9');
  });

  it('returns 429 and sets Retry-After when limit exceeded', () => {
    const limiter = new InMemoryRateLimiter({ windowMs: 60_000, max: 1 });
    let statusCode = 0;
    let body: unknown;
    const res = {
      headers: {} as Record<string, string>,
      setHeader(k: string, v: string) { this.headers[k] = v; },
      status(code: number) { statusCode = code; return this; },
      json(b: unknown) { body = b; },
    } as unknown as Response & { headers: Record<string, string> };

    const mw = createRateLimitMiddleware(limiter, { windowMs: 60_000, max: 1 }, 'test');
    mw(makeReq(), res, next);  // consume the one allowed
    mw(makeReq(), res, next);  // should be denied
    expect(statusCode).toBe(429);
    expect((body as { error: string }).error).toBe('rate_limited');
    expect(res.headers['Retry-After']).toBeTruthy();
  });
});
