// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchRankingProfile, maybeSingle } = vi.hoisted(() => ({
  fetchRankingProfile: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock('../stats/statsApi', () => ({ fetchRankingProfile }));
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  },
}));

import { usePrivateMatchLobbyGuestProfile } from './usePrivateMatchLobbyGuestProfile';

const REGISTERED_ID = '11111111-1111-4111-8111-111111111111';

describe('usePrivateMatchLobbyGuestProfile', () => {
  beforeEach(() => {
    fetchRankingProfile.mockReset();
    maybeSingle.mockReset();
  });

  it('renders the unrated guest state for a signed-out guest seat without requesting a ranked profile', async () => {
    const { result } = renderHook(() =>
      usePrivateMatchLobbyGuestProfile({
        guestPresent: true,
        roomGuestUserId: 'guest_mabc123_x7y8z9q0',
        roomGuestUsername: 'Guest 4821',
      }),
    );

    await waitFor(() => expect(result.current.guestRankedLoading).toBe(false));
    // Let the effect's async body settle before asserting nothing was fetched.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current.guestRating).toBeNull();
    expect(result.current.guestWinStreak).toBeNull();
    expect(fetchRankingProfile).not.toHaveBeenCalled();
    // A guest id must not fall back to a username lookup — a guest's display
    // name can collide with a registered player's handle.
    expect(maybeSingle).not.toHaveBeenCalled();
  });

  it('fetches the ranked profile for a registered player seat', async () => {
    fetchRankingProfile.mockResolvedValue({
      data: { glicko_rating: 1612.4, currentWinStreak: 2 },
      error: null,
    });

    const { result } = renderHook(() =>
      usePrivateMatchLobbyGuestProfile({
        guestPresent: true,
        roomGuestUserId: REGISTERED_ID,
        roomGuestUsername: 'oliver',
      }),
    );

    await waitFor(() => expect(result.current.guestRating).toBe(1612));
    expect(result.current.guestWinStreak).toBe(2);
    expect(fetchRankingProfile).toHaveBeenCalledWith(REGISTERED_ID);
  });
});
