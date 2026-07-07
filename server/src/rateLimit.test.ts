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

  describe('check and increment', () => {
    it('check does not increment count but correctly reports permission state', () => {
      const limiter = new InMemoryRateLimiter({ windowMs: 1000, max: 2 });
      
      // Initially allowed
      expect(limiter.check('key', undefined, 0).allowed).toBe(true);
      
      // Take 1
      limiter.take('key', undefined, 0);
      expect(limiter.check('key', undefined, 0).allowed).toBe(true);
      expect(limiter.check('key', undefined, 0).remaining).toBe(1);

      // Take 2 (reaches max)
      limiter.take('key', undefined, 0);
      expect(limiter.check('key', undefined, 0).allowed).toBe(false);
      expect(limiter.check('key', undefined, 0).remaining).toBe(0);
    });

    it('increment increases count manually without calling take', () => {
      const limiter = new InMemoryRateLimiter({ windowMs: 1000, max: 2 });
      
      limiter.increment('key', undefined, 0);
      expect(limiter.check('key', undefined, 0).remaining).toBe(1);

      limiter.increment('key', undefined, 0);
      expect(limiter.check('key', undefined, 0).allowed).toBe(false);
    });
  });
});

