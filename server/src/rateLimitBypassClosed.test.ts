/**
 * AU-3 / AU-4 (HARDENING_PLAN §6.3): the IP-keyed rate limiters can no longer be
 * reset by a client-supplied header.
 *
 * - AU-3: the key derives from the real client address — Express's `req.ip`
 *   (resolved via the range-based `trust proxy` in `trustedProxy.ts`), or, when
 *   the request transited trusted infra, the Cloudflare-verified
 *   `CF-Connecting-IP`. Neither a rotating `X-Forwarded-For` prefix nor a
 *   client-set `CF-Connecting-IP` on an untrusted peer yields a fresh bucket.
 * - AU-4: `createRateLimitMiddleware` is called WITHOUT a `getUserId` resolver on
 *   the four formerly-unsigned-JWT-keyed endpoints, so a forged `Authorization`
 *   Bearer `sub` no longer partitions (and thus resets) the bucket.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { InMemoryRateLimiter, createRateLimitMiddleware } from './rateLimit';

const RULE = { windowMs: 60_000, max: 5 };

function makeReq(opts: { ip?: string; peer?: string; xff?: string; auth?: string; cfip?: string } = {}): Request {
  const headers: Record<string, string> = {};
  if (opts.xff) headers['x-forwarded-for'] = opts.xff;
  if (opts.auth) headers.authorization = opts.auth;
  if (opts.cfip) headers['cf-connecting-ip'] = opts.cfip;
  return {
    headers,
    socket: { remoteAddress: opts.peer ?? opts.ip ?? '10.0.0.1' },
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

/** Exhaust `max`, then return whether one more request is still blocked. */
function stillBlockedAfterExhausting(
  mw: ReturnType<typeof createRateLimitMiddleware>,
  reqs: Request[],
  probe: Request,
): boolean {
  for (const r of reqs) run(mw, r);
  return !run(mw, probe).allowed;
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

  // AU-3 correction (2026-09-04): CF-Connecting-IP handling.
  it('a client-set CF-Connecting-IP on an untrusted (non-Cloudflare) peer is ignored', () => {
    const mw = createRateLimitMiddleware(new InMemoryRateLimiter(RULE), RULE, 'test:cfspoof');
    // Raw origin request: public non-Cloudflare peer, attacker rotates its own
    // CF-Connecting-IP. Every request must key on the same real address.
    const reqs = Array.from({ length: RULE.max }, (_, i) =>
      makeReq({ ip: '198.51.100.9', peer: '198.51.100.9', cfip: `55.55.55.${i}` }),
    );
    const probe = makeReq({ ip: '198.51.100.9', peer: '198.51.100.9', cfip: '55.55.55.250' });
    expect(stillBlockedAfterExhausting(mw, reqs, probe)).toBe(true);
  });

  it('CF-Connecting-IP IS honoured when the peer is a Cloudflare edge', () => {
    const mw = createRateLimitMiddleware(new InMemoryRateLimiter(RULE), RULE, 'test:cftrust');
    const CF_EDGE = '162.158.1.2';
    // Distinct Cloudflare-verified clients behind the same edge get distinct buckets.
    for (let i = 0; i < RULE.max; i++) {
      expect(run(mw, makeReq({ peer: CF_EDGE, cfip: '203.0.113.50' })).allowed).toBe(true);
    }
    expect(run(mw, makeReq({ peer: CF_EDGE, cfip: '203.0.113.50' })).allowed).toBe(false);
    // A different real client, same edge — fresh bucket, as it should be.
    expect(run(mw, makeReq({ peer: CF_EDGE, cfip: '203.0.113.51' })).allowed).toBe(true);
  });

  it('one client cannot escape its bucket by forging CF-Connecting-IP behind a real Cloudflare edge', () => {
    // The edge overwrites any client value, so in prod cfip is always the true
    // client. This asserts that even if the header varied, the FALLBACK path
    // (untrusted peer) keys stably — the guarantee that matters.
    const mw = createRateLimitMiddleware(new InMemoryRateLimiter(RULE), RULE, 'test:mix');
    const reqs = Array.from({ length: RULE.max }, (_, i) =>
      makeReq({ ip: '203.0.113.77', peer: '203.0.113.77', cfip: `9.9.9.${i}`, xff: `1.1.1.${i}` }),
    );
    const probe = makeReq({ ip: '203.0.113.77', peer: '203.0.113.77', cfip: '9.9.9.200', xff: '1.1.1.200' });
    expect(stillBlockedAfterExhausting(mw, reqs, probe)).toBe(true);
  });
});
