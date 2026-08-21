import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../config', () => ({
  config: { supabaseUrl: 'https://example.supabase.co', supabaseServiceKey: 'service-key' },
}));

import {
  authenticatedUserIdCacheSize,
  getAuthenticatedUserIdFromToken,
  resetAuthenticatedUserIdCache,
} from './supabaseAuth';

const fetchMock = vi.fn();

beforeEach(() => {
  resetAuthenticatedUserIdCache();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: 'user-1' }) });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetAuthenticatedUserIdCache();
});

describe('getAuthenticatedUserIdFromToken', () => {
  it('validates a token once and serves repeats from cache', async () => {
    expect(await getAuthenticatedUserIdFromToken('tok-a')).toBe('user-1');
    expect(await getAuthenticatedUserIdFromToken('tok-a')).toBe('user-1');
    expect(await getAuthenticatedUserIdFromToken('tok-a')).toBe('user-1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('collapses a concurrent burst on the same token into one upstream call', async () => {
    let release!: (v: unknown) => void;
    fetchMock.mockImplementation(
      () => new Promise((resolve) => { release = resolve; }),
    );

    // A page load fans out to roughly nine requests, all carrying one token.
    const pending = Promise.all(
      Array.from({ length: 9 }, () => getAuthenticatedUserIdFromToken('tok-burst')),
    );
    await Promise.resolve();
    release({ ok: true, json: async () => ({ id: 'user-1' }) });

    expect(await pending).toEqual(Array.from({ length: 9 }, () => 'user-1'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not store the raw bearer token as a cache key', async () => {
    await getAuthenticatedUserIdFromToken('super-secret-token');
    // The cache is keyed by digest; a lookup by the raw token must not hit.
    expect(authenticatedUserIdCacheSize()).toBe(1);
    await getAuthenticatedUserIdFromToken('super-secret-token');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stays bounded when many distinct tokens are seen', async () => {
    for (let i = 0; i < 1_200; i += 1) {
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ id: `user-${i}` }) });
      await getAuthenticatedUserIdFromToken(`tok-${i}`);
    }

    // Previously this grew one permanent entry per token ever seen.
    expect(authenticatedUserIdCacheSize()).toBeLessThanOrEqual(1_000);
  });

  it('caches a rejection briefly and returns null', async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: false, text: async () => 'nope' });

    expect(await getAuthenticatedUserIdFromToken('bad')).toBeNull();
    expect(await getAuthenticatedUserIdFromToken('bad')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns null without calling upstream for an empty token', async () => {
    expect(await getAuthenticatedUserIdFromToken(null)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
