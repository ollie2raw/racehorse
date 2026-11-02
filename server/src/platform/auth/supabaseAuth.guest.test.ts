import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config', () => ({
  config: { supabaseUrl: 'https://example.supabase.co', supabaseServiceKey: 'service-key' },
}));

import { getAuthenticatedUserIdFromToken, isGuestBearerToken, resetAuthenticatedUserIdCache } from './supabaseAuth';

/**
 * A guest is a Supabase anonymous session (docs/guest-play-design.md): a real signed-in user with `is_anonymous: true` on the user object the auth
 * service returns. The server keeps that from the same cached validation it already does for every request.
 */

const fetchMock = vi.fn();

beforeEach(() => {
  resetAuthenticatedUserIdCache();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetAuthenticatedUserIdCache();
});

const upstreamUser = (user: Record<string, unknown>) => fetchMock.mockResolvedValue({ ok: true, json: async () => user });

describe('isGuestBearerToken', () => {
  it('is true for an anonymous session', async () => {
    upstreamUser({ id: 'guest-1', is_anonymous: true });
    expect(await isGuestBearerToken('tok-guest')).toBe(true);
  });

  it('is false for a permanent account, whether the flag is false or absent', async () => {
    upstreamUser({ id: 'user-1', is_anonymous: false });
    expect(await isGuestBearerToken('tok-a')).toBe(false);
    upstreamUser({ id: 'user-2' });
    expect(await isGuestBearerToken('tok-b')).toBe(false);
  });

  it('is false, never true, for a token that does not verify, or no token at all', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ id: 'x', is_anonymous: true }) });
    expect(await isGuestBearerToken('tok-bad')).toBe(false);
    expect(await isGuestBearerToken(null)).toBe(false);
    expect(await isGuestBearerToken(undefined)).toBe(false);
    expect(await isGuestBearerToken('')).toBe(false);
  });

  it('does not treat a truthy non-boolean as a guest: only the exact boolean true counts', async () => {
    for (const odd of ['true', 1, 'yes', {}]) {
      resetAuthenticatedUserIdCache();
      upstreamUser({ id: 'user-odd', is_anonymous: odd });
      expect(await isGuestBearerToken('tok-odd'), JSON.stringify(odd)).toBe(false);
    }
  });

  it('costs no extra upstream call: it shares the validation the id check already did', async () => {
    upstreamUser({ id: 'guest-1', is_anonymous: true });
    expect(await getAuthenticatedUserIdFromToken('tok-shared')).toBe('guest-1');
    expect(await isGuestBearerToken('tok-shared')).toBe(true);
    expect(await isGuestBearerToken('tok-shared')).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the guest and the permanent user apart, even when their tokens are checked together', async () => {
    fetchMock.mockImplementation(async (_url: URL, init: { headers: { Authorization: string } }) => {
      const guest = init.headers.Authorization.endsWith('tok-guest');
      return { ok: true, json: async () => (guest ? { id: 'guest-1', is_anonymous: true } : { id: 'user-1', is_anonymous: false }) };
    });
    const [guest, member] = await Promise.all([isGuestBearerToken('tok-guest'), isGuestBearerToken('tok-member')]);
    expect([guest, member]).toEqual([true, false]);
  });
});
