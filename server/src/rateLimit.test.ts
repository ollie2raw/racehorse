import { describe, expect, it } from 'vitest';
import { InMemoryRateLimiter } from './rateLimit';

describe('InMemoryRateLimiter', () => {
  it('allows requests until the rule max is reached', () => {
    const limiter = new InMemoryRateLimiter({ windowMs: 1000, max: 2 });

    expect(limiter.take('key', undefined, 0).allowed).toBe(true);
    expect(limiter.take('key', undefined, 100).allowed).toBe(true);

    const denied = limiter.take('key', undefined, 200);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBe(800);
  });

  it('resets a bucket after the window expires', () => {
    const limiter = new InMemoryRateLimiter({ windowMs: 1000, max: 1 });

    expect(limiter.take('key', undefined, 0).allowed).toBe(true);
    expect(limiter.take('key', undefined, 999).allowed).toBe(false);
    expect(limiter.take('key', undefined, 1000).allowed).toBe(true);
  });

  it('keeps separate keys isolated', () => {
    const limiter = new InMemoryRateLimiter({ windowMs: 1000, max: 1 });

    expect(limiter.take('a', undefined, 0).allowed).toBe(true);
    expect(limiter.take('b', undefined, 0).allowed).toBe(true);
    expect(limiter.take('a', undefined, 0).allowed).toBe(false);
  });
});

