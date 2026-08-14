// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlayerIdentityModel } from './usePlayerIdentityModel';

const { fetchPublicProfile, fetchPersonalStatsInsightsByUserId, fetchRivals, loadJourney } = vi.hoisted(() => ({
  fetchPublicProfile: vi.fn(),
  fetchPersonalStatsInsightsByUserId: vi.fn(),
  fetchRivals: vi.fn(),
  loadJourney: vi.fn(),
}));

vi.mock('../social/socialApi', () => ({ fetchPublicProfile, fetchRivals }));
vi.mock('../stats/statsApi', () => ({ fetchPersonalStatsInsightsByUserId }));
vi.mock('../home/homeDataLoaders', () => ({ loadJourney }));

const profile = (userId: string, username: string) => ({
  ok: true,
  userId,
  username,
  glicko_rating: 1200,
  peak_rating: 1250,
  provisional: false,
  ranked_games_played: 2,
  global_rank: null,
  wins: 1,
  losses: 1,
  win_rate: 50,
  puzzles_completed: 0,
  best_puzzle_score: null,
  fritz_wins: 0,
  fritz_losses: 0,
  best_streak: 1,
  is_self: false,
  is_friend: false,
  has_pending_request: false,
  h2h: null,
  presence: { status: 'offline' as const, current_mode: null },
  recent_matches: [],
});

describe('usePlayerIdentityModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchPersonalStatsInsightsByUserId.mockResolvedValue({ data: null, error: null });
    fetchRivals.mockResolvedValue({ rivals: [], error: null });
    loadJourney.mockResolvedValue({ completedNodes: 0, totalNodes: 0, activeChapterId: null, activeChapterTitle: null });
  });

  it('keeps public subjects isolated from current-user-only sources', async () => {
    fetchPublicProfile.mockResolvedValue({ profile: profile('public-1', 'Maya'), error: null });
    const { result } = renderHook(() => usePlayerIdentityModel({
      subjectUserId: null,
      subjectUsername: 'Maya',
      currentUserId: 'viewer-1',
    }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.model?.subject.userId).toBe('public-1');
    expect(result.current.model?.sourceStatus.personal_insights).toBe('unavailable');
    expect(fetchPersonalStatsInsightsByUserId).not.toHaveBeenCalled();
    expect(loadJourney).not.toHaveBeenCalled();
    expect(fetchRivals).not.toHaveBeenCalled();
  });

  it('ignores a late response from a previous subject after a route change', async () => {
    let resolveFirst: ((value: unknown) => void) | undefined;
    fetchPublicProfile
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce({ profile: profile('public-2', 'Lee'), error: null });

    const { result, rerender } = renderHook(
      ({ username }) => usePlayerIdentityModel({ subjectUserId: null, subjectUsername: username, currentUserId: null }),
      { initialProps: { username: 'Maya' } },
    );

    rerender({ username: 'Lee' });
    await waitFor(() => expect(result.current.model?.subject.userId).toBe('public-2'));
    expect(result.current.model?.subject.username).toBe('Lee');

    await act(async () => {
      resolveFirst?.({ profile: profile('public-1', 'Maya'), error: null });
    });
    expect(result.current.model?.subject.username).toBe('Lee');
  });

  it('clears personalized identity when the request becomes unauthenticated', async () => {
    fetchPersonalStatsInsightsByUserId.mockResolvedValue({ data: null, error: null });
    const { result, rerender } = renderHook(
      ({ userId }) => usePlayerIdentityModel({ subjectUserId: userId, subjectUsername: null, currentUserId: userId }),
      { initialProps: { userId: 'user-1' as string | null } },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender({ userId: null });
    expect(result.current.model?.subject.userId).toBeNull();
    expect(result.current.model?.sourceStatus.personal_insights).toBe('unavailable');
  });
});
