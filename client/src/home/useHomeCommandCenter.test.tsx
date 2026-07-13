import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useHomeCommandCenter } from './useHomeCommandCenter';
import type { AppRoutesTournamentProps } from '../appRouteTypes';

let authUser: { id: string; email: string } | null = { id: 'user-a', email: 'a@example.com' };
const loadDailySummary = vi.hoisted(() => vi.fn());
const loadDailyFritz = vi.hoisted(() => vi.fn());
const loadDailyPuzzle = vi.hoisted(() => vi.fn());
const loadSocialPresence = vi.hoisted(() => vi.fn());
const loadSocialActivity = vi.hoisted(() => vi.fn());
const loadSocialRivals = vi.hoisted(() => vi.fn());
const loadRanking = vi.hoisted(() => vi.fn());
const loadJourney = vi.hoisted(() => vi.fn());
const loadTournament = vi.hoisted(() => vi.fn());

vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({
    user: authUser,
    profile: authUser ? { id: authUser.id, username: authUser.id } : null,
    loading: false,
  }),
}));

vi.mock('./homeDataLoaders', () => ({
  loadDailySummary,
  loadDailyFritz,
  loadDailyPuzzle,
  loadSocialPresence,
  loadSocialActivity,
  loadSocialRivals,
  loadRanking,
  loadJourney,
  loadTournament,
}));

const tournament = {
  upcoming: [],
  registrations: [],
  activeBracket: null,
  pendingMatch: null,
  recoveryMatch: null,
  tournamentPhase: null,
  activeTournamentId: null,
  assignedMatch: null,
  countdown: null,
  error: null,
  isLoading: false,
  hasLoaded: true,
} as unknown as AppRoutesTournamentProps['tournament'];

function configureSuccessfulLoaders() {
  loadDailySummary.mockResolvedValue({ dateKey: '2026-07-10', week: [], weeklyCompletedCount: 1, currentStreakCount: 1, todayComplete: false });
  loadDailyFritz.mockResolvedValue({ state: 'started', outcome: null, rank: null, currentGame: 1, streak: 1, runDate: '2026-07-10' });
  loadDailyPuzzle.mockResolvedValue({ state: 'unstarted', score: null, runDate: '2026-07-10', nextAvailableSlotIndex: 1 });
  loadSocialPresence.mockResolvedValue([{ id: 'f1', userId: 'friend-a', username: 'Maya', status: 'online', currentMode: null }]);
  loadSocialActivity.mockResolvedValue([]);
  loadSocialRivals.mockResolvedValue([]);
  loadRanking.mockResolvedValue({ rating: 800, peakRating: 800, globalRank: null, rankedGamesPlayed: 0, currentWinStreak: 0, provisional: true });
  loadJourney.mockResolvedValue({ activeChapterId: 'ch1-fritz-trail', activeChapterTitle: 'Fritz Trail', completedNodes: 0, totalNodes: 8, totalCompleted: 0, hasAnyProgress: false, lastVisitedNodeId: null });
  loadTournament.mockResolvedValue({ upcomingCount: 0, registeredTournamentIds: [], activeTournamentId: null, phase: null, recoveryMatch: null });
}

describe('useHomeCommandCenter', () => {
  beforeEach(() => {
    authUser = { id: 'user-a', email: 'a@example.com' };
    vi.clearAllMocks();
    configureSuccessfulLoaders();
  });

  it('keeps source failures isolated and preserves successful sources', async () => {
    loadDailySummary.mockRejectedValueOnce(new Error('daily unavailable'));
    loadSocialPresence.mockResolvedValueOnce([{ id: 'f1', userId: 'friend-a', username: 'Maya', status: 'online', currentMode: null }]);

    const { result } = renderHook(() => useHomeCommandCenter(tournament));
    await waitFor(() => expect(result.current.sourceStatus.dailySummary).toBe('error'));

    expect(result.current.sourceStatus.socialPresence).toBe('ready');
    expect(result.current.social.presence.data).toHaveLength(1);
    expect(result.current.sourceStatus.tournament).toBe('ready');
  });

  it('starts independent sources concurrently', async () => {
    const calls: string[] = [];
    for (const [name, loader] of [
      ['summary', loadDailySummary],
      ['fritz', loadDailyFritz],
      ['puzzle', loadDailyPuzzle],
      ['presence', loadSocialPresence],
      ['activity', loadSocialActivity],
      ['rivals', loadSocialRivals],
      ['ranking', loadRanking],
      ['journey', loadJourney],
      ['tournament', loadTournament],
    ] as const) {
      loader.mockImplementationOnce(() => {
        calls.push(name);
        return Promise.resolve(loader === loadDailySummary ? { dateKey: null, week: [], weeklyCompletedCount: null, currentStreakCount: null, todayComplete: null } : loader === loadDailyFritz ? { state: 'unstarted', outcome: null, rank: null, currentGame: null, streak: null, runDate: null } : loader === loadDailyPuzzle ? { state: 'unstarted', score: null, runDate: null, nextAvailableSlotIndex: null } : loader === loadSocialPresence ? [] : loader === loadSocialActivity ? [] : loader === loadSocialRivals ? [] : loader === loadRanking ? { rating: null, peakRating: null, globalRank: null, rankedGamesPlayed: null, currentWinStreak: null, provisional: null } : loader === loadJourney ? { activeChapterId: null, activeChapterTitle: null, completedNodes: 0, totalNodes: 0, totalCompleted: 0, hasAnyProgress: false, lastVisitedNodeId: null } : { upcomingCount: 0, registeredTournamentIds: [], activeTournamentId: null, phase: null, recoveryMatch: null });
      });
    }

    renderHook(() => useHomeCommandCenter(tournament));
    await waitFor(() => expect(calls).toHaveLength(9));
    expect(new Set(calls)).toEqual(new Set(['summary', 'fritz', 'puzzle', 'presence', 'activity', 'rivals', 'ranking', 'journey', 'tournament']));
  });

  it('clears personalized data on logout and builds a new model on login', async () => {
    const { result, rerender } = renderHook(() => useHomeCommandCenter(tournament));
    await waitFor(() => expect(result.current.social.presence.data).toHaveLength(1));

    authUser = null;
    rerender();
    expect(result.current.identity).toMatchObject({ kind: 'guest', userId: null });
    expect(result.current.social.presence.data).toBeNull();
    expect(result.current.stats.data).toBeNull();

    authUser = { id: 'user-b', email: 'b@example.com' };
    rerender();
    await waitFor(() => expect(result.current.identity.userId).toBe('user-b'));
    expect(loadRanking).toHaveBeenCalledWith('user-b');
  });

  it('ignores late results after the identity changes', async () => {
    let resolveOldSummary!: (value: unknown) => void;
    loadDailySummary.mockImplementationOnce(() => new Promise((resolve) => { resolveOldSummary = resolve; }));
    const { result, rerender } = renderHook(() => useHomeCommandCenter(tournament));

    authUser = null;
    rerender();
    resolveOldSummary({ dateKey: 'old-user-date', week: [], weeklyCompletedCount: 7, currentStreakCount: 7, todayComplete: true });
    await waitFor(() => expect(result.current.identity.kind).toBe('guest'));
    expect(result.current.daily.summary.data?.dateKey).not.toBe('old-user-date');
  });
});
