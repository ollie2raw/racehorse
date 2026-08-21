import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  clearCachedSession,
  getCachedSession,
  peekCachedSession,
  setCachedSession,
} from './sessionToken';

beforeEach(() => { clearCachedSession(); });

describe('sessionToken cache', () => {
  it('serves a set session without calling the loader', async () => {
    const loader = vi.fn();
    setCachedSession('tok-1', 'user-1');

    const session = await getCachedSession(loader);

    expect(session).toEqual({ token: 'tok-1', userId: 'user-1' });
    expect(loader).not.toHaveBeenCalled();
  });

  it('loads once on a cold read and serves the rest from cache', async () => {
    const loader = vi.fn().mockResolvedValue({ token: 'tok-1', userId: 'user-1' });

    await getCachedSession(loader);
    await getCachedSession(loader);
    await getCachedSession(loader);

    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('collapses concurrent cold reads onto one loader call', async () => {
    const loader = vi.fn().mockImplementation(
      () => new Promise((resolve) => { setTimeout(() => resolve({ token: 'tok-1', userId: 'user-1' }), 10); }),
    );

    const results = await Promise.all([
      getCachedSession(loader),
      getCachedSession(loader),
      getCachedSession(loader),
    ]);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r.token === 'tok-1')).toBe(true);
  });

  it('reloads after the session is cleared', async () => {
    const loader = vi.fn().mockResolvedValue({ token: 'tok-1', userId: 'user-1' });
    await getCachedSession(loader);
    clearCachedSession();
    await getCachedSession(loader);

    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('does not cache a loader failure as a valid session', async () => {
    const failing = vi.fn().mockRejectedValue(new Error('offline'));
    const session = await getCachedSession(failing);

    expect(session).toEqual({ token: null, userId: null });
    // The failure was not retained, so a later read tries again.
    expect(peekCachedSession()).toBeNull();

    const working = vi.fn().mockResolvedValue({ token: 'tok-2', userId: 'user-2' });
    expect(await getCachedSession(working)).toEqual({ token: 'tok-2', userId: 'user-2' });
  });

  it('a later auth event overrides what was loaded', async () => {
    const loader = vi.fn().mockResolvedValue({ token: 'tok-1', userId: 'user-1' });
    await getCachedSession(loader);

    setCachedSession('tok-rotated', 'user-1');

    expect(await getCachedSession(loader)).toEqual({ token: 'tok-rotated', userId: 'user-1' });
    expect(loader).toHaveBeenCalledTimes(1);
  });
});
