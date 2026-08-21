import { describe, it, expect, vi, beforeEach } from 'vitest';

// The cache is keyed by signed-in user, so each test uses a distinct identity.
// That keeps them order-independent and exercises the scoping at the same time.
let currentUserId = 'user-0';
vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: currentUserId } } } }),
    },
  },
}));

const apiGet = vi.fn();
vi.mock('../api/client', () => ({
  apiGet: (...args: unknown[]) => apiGet(...args),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
}));

import { fetchRivals } from './socialApi';
import { clearCachedSession } from '../auth/sessionToken';

let testCounter = 0;

beforeEach(() => {
  testCounter += 1;
  currentUserId = `user-${testCounter}`;
  // The session cache is module-level and only auth events invalidate it.
  clearCachedSession();
  apiGet.mockReset();
  apiGet.mockResolvedValue({
    data: { ok: true, rivals: [{ userId: 'r1', username: 'Maya', gamesPlayed: 4, winsAgainst: 2, lossesAgainst: 2, rating: 810 }] },
    error: null,
  });
});

describe('fetchRivals caching', () => {
  it('collapses concurrent callers onto one in-flight request', async () => {
    const [a, b, c] = await Promise.all([fetchRivals(), fetchRivals(), fetchRivals()]);

    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(a.rivals).toHaveLength(1);
    expect(b.rivals).toEqual(a.rivals);
    expect(c.rivals).toEqual(a.rivals);
  });

  it('serves a subsequent caller from cache', async () => {
    await fetchRivals();
    const callsAfterFirst = apiGet.mock.calls.length;
    const second = await fetchRivals();

    expect(apiGet.mock.calls.length).toBe(callsAfterFirst);
    expect(second.rivals).toHaveLength(1);
  });

  it('still surfaces an error result rather than throwing', async () => {
    apiGet.mockReset();
    apiGet.mockResolvedValue({ data: null, error: 'boom' });

    const result = await fetchRivals();

    expect(result.rivals).toEqual([]);
    expect(result.error).toBeTruthy();
  });

  it('does not serve one user the previous user\'s rivals', async () => {
    const first = await fetchRivals();
    expect(first.rivals[0]?.username).toBe('Maya');

    // A different signed-in identity must miss the cache and refetch. In the app
    // the SIGNED_OUT/SIGNED_IN event resets the session cache; do the same here.
    currentUserId = 'someone-else';
    clearCachedSession();
    apiGet.mockResolvedValue({
      data: { ok: true, rivals: [{ userId: 'r2', username: 'Rob', gamesPlayed: 1, winsAgainst: 1, lossesAgainst: 0, rating: 900 }] },
      error: null,
    });

    const second = await fetchRivals();
    expect(second.rivals[0]?.username).toBe('Rob');
    expect(apiGet).toHaveBeenCalledTimes(2);
  });
});
