import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock('../api/client', () => ({ apiGet, apiPost: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: null }));

import { hasRankedProfile } from './rankedProfileId';
import { fetchRankingProfile } from './statsApi';

const REGISTERED_ID = '11111111-1111-4111-8111-111111111111';

describe('hasRankedProfile', () => {
  it('accepts registered account uuids only', () => {
    expect(hasRankedProfile(REGISTERED_ID)).toBe(true);
    expect(hasRankedProfile('guest_mabc123_x7y8z9q0')).toBe(false);
    expect(hasRankedProfile('fritz')).toBe(false);
    expect(hasRankedProfile('')).toBe(false);
    expect(hasRankedProfile(null)).toBe(false);
    expect(hasRankedProfile(undefined)).toBe(false);
  });
});

describe('fetchRankingProfile', () => {
  beforeEach(() => apiGet.mockReset());

  it('never requests a ranked profile for a guest id', async () => {
    const result = await fetchRankingProfile('guest_mabc123_x7y8z9q0');
    expect(result).toEqual({ data: null, error: null });
    expect(apiGet).not.toHaveBeenCalled();
  });

  it('requests the profile for a registered id', async () => {
    apiGet.mockResolvedValue({ data: { ok: true, glicko_rating: 1500, rank: 4 }, error: null });
    const result = await fetchRankingProfile(REGISTERED_ID);
    expect(apiGet).toHaveBeenCalledWith(`/api/ranking/profile/${REGISTERED_ID}`, { auth: false });
    expect(result.data?.rank).toBe(4);
  });
});
