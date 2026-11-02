import { describe, it, expect, vi, beforeEach } from 'vitest';

const supabaseFetch = vi.fn();
vi.mock('../supabaseUtils', () => ({ supabaseFetch: (...args: unknown[]) => supabaseFetch(...args) }));
vi.mock('../logger', () => ({ childLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }) }));

import {
  fetchGuestUserIds,
  fetchProfilesExcludingGuests,
  removeGuests,
  resetGuestEligibilityForTests,
} from './guestEligibility';

const MISSING = new Error('Supabase request failed: 400 {"code":"42703","message":"column profiles.is_guest does not exist"}');

beforeEach(() => {
  supabaseFetch.mockReset();
  resetGuestEligibilityForTests();
});

describe('fetchGuestUserIds', () => {
  it('returns the ids the database says are guests', async () => {
    supabaseFetch.mockResolvedValueOnce([{ id: 'g1' }]);
    const guests = await fetchGuestUserIds(['g1', 'u1']);
    expect([...guests]).toEqual(['g1']);
    expect(String(supabaseFetch.mock.calls[0][0])).toContain('is_guest=eq.true');
  });

  it('asks nothing when there is nobody to ask about', async () => {
    expect((await fetchGuestUserIds(['', ''])).size).toBe(0);
    expect(supabaseFetch).not.toHaveBeenCalled();
  });

  it('asks in chunks of 100', async () => {
    supabaseFetch.mockResolvedValue([]);
    await fetchGuestUserIds(Array.from({ length: 230 }, (_, i) => `u${i}`));
    expect(supabaseFetch).toHaveBeenCalledTimes(3);
  });

  it('treats a missing column as "no guests" and then stops asking for a while', async () => {
    supabaseFetch.mockRejectedValueOnce(MISSING);
    expect((await fetchGuestUserIds(['u1'])).size).toBe(0);
    expect((await fetchGuestUserIds(['u2'])).size).toBe(0);
    expect(supabaseFetch).toHaveBeenCalledTimes(1);
  });

  it('does NOT swallow any other failure (a board must not quietly show guests)', async () => {
    supabaseFetch.mockRejectedValueOnce(new Error('Supabase request failed: 500 boom'));
    await expect(fetchGuestUserIds(['u1'])).rejects.toThrow('boom');
  });
});

describe('removeGuests', () => {
  it('drops items belonging to guests and keeps the rest in order', async () => {
    supabaseFetch.mockResolvedValueOnce([{ id: 'g1' }]);
    const kept = await removeGuests([{ u: 'a' }, { u: 'g1' }, { u: 'b' }], (x) => x.u);
    expect(kept.map((x) => x.u)).toEqual(['a', 'b']);
  });

  it('returns everything when the column is missing', async () => {
    supabaseFetch.mockRejectedValueOnce(MISSING);
    const items = [{ u: 'a' }, { u: 'g1' }];
    expect(await removeGuests(items, (x) => x.u)).toEqual(items);
  });
});

describe('fetchProfilesExcludingGuests', () => {
  it('appends the filter to a query that already has parameters', async () => {
    supabaseFetch.mockResolvedValueOnce([{ id: 'u1' }]);
    await fetchProfilesExcludingGuests('/rest/v1/profiles?provisional=eq.false&limit=5');
    expect(supabaseFetch).toHaveBeenCalledWith('/rest/v1/profiles?provisional=eq.false&limit=5&is_guest=eq.false');
  });

  it('retries the same query without the filter when the column is missing, then skips the filter without asking again', async () => {
    supabaseFetch.mockRejectedValueOnce(MISSING).mockResolvedValue([{ id: 'u1' }]);
    expect(await fetchProfilesExcludingGuests('/rest/v1/profiles?limit=5')).toEqual([{ id: 'u1' }]);
    expect(supabaseFetch).toHaveBeenNthCalledWith(2, '/rest/v1/profiles?limit=5');
    await fetchProfilesExcludingGuests('/rest/v1/profiles?limit=5');
    expect(supabaseFetch).toHaveBeenNthCalledWith(3, '/rest/v1/profiles?limit=5');
    expect(supabaseFetch).toHaveBeenCalledTimes(3);
  });

  it('rethrows any other failure', async () => {
    supabaseFetch.mockRejectedValueOnce(new Error('Supabase request failed: 500 boom'));
    await expect(fetchProfilesExcludingGuests('/rest/v1/profiles?limit=5')).rejects.toThrow('boom');
  });
});
