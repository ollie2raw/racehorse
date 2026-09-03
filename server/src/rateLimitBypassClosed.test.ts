/**
 * AU-3 / AU-4 (HARDENING_PLAN §6.3): the IP-keyed rate limiters can no longer be
 * reset by a client-supplied header.
 *
 * - AU-3: the key derives from Express's resolved `req.ip` (rightmost trusted
 *   `X-Forwarded-For` entry under `trust proxy: 1`), NOT the client-settable
 *   leftmost `X-Forwarded-For` value. Rotating that header gives no fresh bucket.
 * - AU-4: `createRateLimitMiddleware` is called WITHOUT a `getUserId` resolver on
 *   the four formerly-unsigned-JWT-keyed endpoints, so a forged `Authorization`
 *   Bearer `sub` no longer partitions (and thus resets) the bucket.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { InMemoryRateLimiter, createRateLimitMiddleware } from './rateLimit';

const RULE = { windowMs: 60_000, max: 5 };

function makeReq(opts: { ip?: string; xff?: string; auth?: string } = {}): Request {
  const headers: Record<string, string> = {};
  if (opts.xff) headers['x-forwarded-for'] = opts.xff;
  if (opts.auth) headers.authorization = opts.auth;
  return {
    headers,
    socket: { remoteAddress: opts.ip ?? '10.0.0.1' },
    ip: opts.ip ?? '10.0.0.1',
  } as unknown as Request;
}

function makeRes() {
  const res = { setHeader: vi.fn(), status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
}

function run(mw: ReturnType<typeof createRateLimitMiddleware>, req: Request) {
  const res = makeRes();
  const next = vi.fn();
  mw(req, res as unknown as Response, next as unknown as NextFunction);
  return { res, allowed: next.mock.calls.length === 1 };
}

describe('rate-limit bypass is closed (AU-3 / AU-4)', () => {
  it('a rotating X-Forwarded-For prefix does not yield fresh buckets', () => {
    const mw = createRateLimitMiddleware(new InMemoryRateLimiter(RULE), RULE, 'test:xff');
    // Same real client IP, but a different spoofed XFF prefix every request.
    for (let i = 0; i < RULE.max; i++) {
      const { allowed } = run(mw, makeReq({ ip: '203.0.113.7', xff: `${i}.${i}.${i}.${i}` }));
      expect(allowed).toBe(true);
    }
    const { res, allowed } = run(mw, makeReq({ ip: '203.0.113.7', xff: '9.9.9.9' }));
    expect(allowed).toBe(false);
    expect(res.status).toHaveBeenCalledWith(429);
  });

  it('a rotating forged Authorization Bearer token does not yield fresh buckets', () => {
    const mw = createRateLimitMiddleware(new InMemoryRateLimiter(RULE), RULE, 'test:jwt');
    for (let i = 0; i < RULE.max; i++) {
      const { allowed } = run(mw, makeReq({ ip: '198.51.100.4', auth: `Bearer forged-sub-${i}` }));
      expect(allowed).toBe(true);
    }
    const { allowed } = run(mw, makeReq({ ip: '198.51.100.4', auth: 'Bearer forged-sub-final' }));
    expect(allowed).toBe(false);
  });

  it('distinct real client IPs still get independent buckets', () => {
    const mw = createRateLimitMiddleware(new InMemoryRateLimiter(RULE), RULE, 'test:ip');
    for (let i = 0; i < RULE.max; i++) run(mw, makeReq({ ip: '203.0.113.1' }));
    expect(run(mw, makeReq({ ip: '203.0.113.1' })).allowed).toBe(false);
    expect(run(mw, makeReq({ ip: '203.0.113.2' })).allowed).toBe(true);
  });
});
