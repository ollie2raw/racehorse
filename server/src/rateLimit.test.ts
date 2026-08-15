import { describe, expect, it } from 'vitest';
import { InMemoryRateLimiter } from './rateLimit';

describe('InMemoryRateLimiter', () => {
  it('allows requests until the rule max is reached', async () => {
    const limiter = new InMemoryRateLimiter({ windowMs: 1000, max: 2 });

    expect((await limiter.take('key', undefined, 0)).allowed).toBe(true);
    expect((await limiter.take('key', undefined, 100)).allowed).toBe(true);

    const denied = await limiter.take('key', undefined, 200);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBe(800);
  });

  it('resets a bucket after the window expires', async () => {
    const limiter = new InMemoryRateLimiter({ windowMs: 1000, max: 1 });

    expect((await limiter.take('key', undefined, 0)).allowed).toBe(true);
    expect((await limiter.take('key', undefined, 999)).allowed).toBe(false);
    expect((await limiter.take('key', undefined, 1000)).allowed).toBe(true);
  });

  it('keeps separate keys isolated', async () => {
    const limiter = new InMemoryRateLimiter({ windowMs: 1000, max: 1 });

    expect((await limiter.take('a', undefined, 0)).allowed).toBe(true);
    expect((await limiter.take('b', undefined, 0)).allowed).toBe(true);
    expect((await limiter.take('a', undefined, 0)).allowed).toBe(false);
  });

  describe('check and increment', () => {
    it('check does not increment count but correctly reports permission state', async () => {
      const limiter = new InMemoryRateLimiter({ windowMs: 1000, max: 2 });

      // Initially allowed
      expect((await limiter.check('key', undefined, 0)).allowed).toBe(true);

      // Take 1
      await limiter.take('key', undefined, 0);
      expect((await limiter.check('key', undefined, 0)).allowed).toBe(true);
      expect((await limiter.check('key', undefined, 0)).remaining).toBe(1);

      // Take 2 (reaches max)
      await limiter.take('key', undefined, 0);
      expect((await limiter.check('key', undefined, 0)).allowed).toBe(false);
      expect((await limiter.check('key', undefined, 0)).remaining).toBe(0);
    });

    it('increment increases count manually without calling take', async () => {
      const limiter = new InMemoryRateLimiter({ windowMs: 1000, max: 2 });

      await limiter.increment('key', undefined, 0);
      expect((await limiter.check('key', undefined, 0)).remaining).toBe(1);

      await limiter.increment('key', undefined, 0);
      expect((await limiter.check('key', undefined, 0)).allowed).toBe(false);
    });
  });
});
