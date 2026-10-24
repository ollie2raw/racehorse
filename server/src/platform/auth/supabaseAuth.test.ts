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

describe('e2e identity shim fails closed', () => {
  const PROD_URL = 'https://fisfadjqllojdzibcdfx.supabase.co';
  const on = { E2E_AUTH_SHIM: '1' };

  it('requires the explicit opt-in even on a plain local process', async () => {
    const { isE2eAuthBypassAllowed } = await import('./supabaseAuth');
    expect(isE2eAuthBypassAllowed({})).toBe(false);
    expect(isE2eAuthBypassAllowed({ NODE_ENV: 'development' })).toBe(false);
    expect(isE2eAuthBypassAllowed({ NODE_ENV: 'test', E2E_AUTH_SHIM: '0' })).toBe(false);
    expect(isE2eAuthBypassAllowed({ NODE_ENV: 'test', E2E_AUTH_SHIM: '' })).toBe(false);
    expect(isE2eAuthBypassAllowed({ NODE_ENV: 'development', ...on })).toBe(true);
    expect(isE2eAuthBypassAllowed({ ...on, SUPABASE_URL: 'https://some-dev-project.supabase.co' })).toBe(true);
  });

  it.each([
    ['NODE_ENV=production', { NODE_ENV: 'production' }],
    ['Render with NODE_ENV unset', { RENDER: 'true' }],
    ['Render with NODE_ENV accidentally development', { RENDER: 'true', NODE_ENV: 'development' }],
    ['Vercel with a custom NODE_ENV', { VERCEL: '1', NODE_ENV: 'staging' }],
    ['production Supabase URL', { SUPABASE_URL: PROD_URL }],
    ['production Supabase via the client var', { VITE_SUPABASE_URL: PROD_URL }],
    ['production Supabase even with the throwaway-user allow flag', { SUPABASE_URL: PROD_URL, RACEHORSE_ALLOW_PRODUCTION_SUPABASE: '1' }],
  ])('refuses even when opted in: %s', async (_name, env) => {
    const { isE2eAuthBypassAllowed } = await import('./supabaseAuth');
    expect(isE2eAuthBypassAllowed({ ...on, ...env })).toBe(false);
  });

  it('getAuthenticatedUserId honors the shim only when allowed, otherwise validates the literal token upstream', async () => {
    const { getAuthenticatedUserId, resetAuthenticatedUserIdCache } = await import('./supabaseAuth');
    const req = { headers: { authorization: 'Bearer e2e-daily-fritz', 'x-e2e-daily-fritz-user': '11111111-1111-4111-8111-111111111111' } } as never;
    const names = ['E2E_AUTH_SHIM', 'RENDER', 'VERCEL', 'NODE_ENV'] as const;
    const keep = Object.fromEntries(names.map((n) => [n, process.env[n]]));
    try {
      resetAuthenticatedUserIdCache();
      delete process.env.E2E_AUTH_SHIM;
      fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
      expect(await getAuthenticatedUserId(req)).toBeNull(); // no opt-in: treated as an ordinary (invalid) token
      process.env.E2E_AUTH_SHIM = '1';
      delete process.env.RENDER;
      delete process.env.VERCEL;
      process.env.NODE_ENV = 'development';
      expect(await getAuthenticatedUserId(req)).toBe('11111111-1111-4111-8111-111111111111');
      process.env.RENDER = 'true';
      resetAuthenticatedUserIdCache();
      expect(await getAuthenticatedUserId(req)).toBeNull();
    } finally {
      for (const n of names) {
        if (keep[n] === undefined) delete process.env[n];
        else process.env[n] = keep[n];
      }
    }
  });
});
