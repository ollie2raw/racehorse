// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { calculateHomePersonalization, HOME_PERSONALIZATION_WEIGHTS } from './homePersonalization';
import { createHomeSourceState, type HomeCommandCenterModel, type HomeSourceStatus } from './homeTypes';

const NOW = Date.parse('2026-07-10T12:00:00Z');

function source<T>(data: T | null, status: HomeSourceStatus = 'ready') {
  return createHomeSourceState(status, data, status === 'error' ? 'unavailable' : null, NOW);
}

function model(overrides: Partial<HomeCommandCenterModel> = {}): HomeCommandCenterModel {
  const base: HomeCommandCenterModel = {
    identity: { kind: 'authenticated', userId: 'player-1', displayName: 'Player' },
    daily: {
      summary: source({ dateKey: '2026-07-10', week: [], weeklyCompletedCount: 0, currentStreakCount: 0, todayComplete: false }),
      fritz: source({ state: 'unstarted', outcome: null, rank: null, currentGame: null, streak: 0, runDate: '2026-07-10' }),
      puzzle: source({ state: 'unstarted', score: null, runDate: '2026-07-10', nextAvailableSlotIndex: 1 }),
    },
    social: { presence: source([]), activity: source([]), rivals: source([]) },
    tournament: source({ upcomingCount: 0, registeredTournamentIds: [], activeTournamentId: null, phase: null, recoveryMatch: null }),
    journey: source({ activeChapterId: 'chapter-1', activeChapterTitle: 'Opening Table', completedNodes: 0, totalNodes: 8, totalCompleted: 0, hasAnyProgress: false, lastVisitedNodeId: null, updatedAt: null }),
    stats: source({ rating: 800, peakRating: 800, globalRank: null, rankedGamesPlayed: 0, currentWinStreak: 0, provisional: true }),
    runtime: source({ activeMatch: null, source: 'app-runtime-not-exposed' }, 'unavailable'),
    continueItems: [], primaryAction: null, momentum: null, welcomeBack: null, activityTimeline: null, personalization: null,
    freshness: { generatedAt: NOW, stale: false },
    sourceStatus: { dailySummary: 'ready', dailyFritz: 'ready', dailyPuzzle: 'ready', socialPresence: 'ready', socialActivity: 'ready', socialRivals: 'ready', tournament: 'ready', journey: 'ready', ranking: 'ready', runtime: 'unavailable' },
  };
  return { ...base, ...overrides };
}

describe('calculateHomePersonalization', () => {
  it.each([
    ['new authenticated player', model(), 'new_player', 'daily_puzzle'],
    ['new guest', model({ identity: { kind: 'guest', userId: null, displayName: null } }), 'new_player', 'daily_puzzle'],
    ['Journey player', model({ journey: source({ activeChapterId: 'chapter-1', activeChapterTitle: 'Opening Table', completedNodes: 3, totalNodes: 8, totalCompleted: 3, hasAnyProgress: true, lastVisitedNodeId: 'node-3', updatedAt: '2026-07-10T10:00:00Z' }) }), 'learning_player', 'journey'],
    ['Daily player', model({ daily: { summary: source({ dateKey: '2026-07-10', week: [], weeklyCompletedCount: 5, currentStreakCount: 5, todayComplete: true }), fritz: source({ state: 'completed', outcome: 'win', rank: 2, currentGame: null, streak: 5, runDate: '2026-07-10', completedAt: '2026-07-10T09:00:00Z' }), puzzle: source({ state: 'completed', score: 90, runDate: '2026-07-10', nextAvailableSlotIndex: null, completedAt: '2026-07-10T09:30:00Z' }) } }), 'daily_player', 'daily_fritz'],
    ['Competitive player', model({ tournament: source({ upcomingCount: 1, registeredTournamentIds: ['t1'], activeTournamentId: 't1', phase: 'match_ready', recoveryMatch: { matchId: 'm1', tournamentId: 't1', round: 1, opponentId: 'p2', opponentUsername: 'Maya', matchStatus: 'ready', readyDeadlineAt: '2026-07-10T18:00:00Z' } }), stats: source({ rating: 1200, peakRating: 1250, globalRank: 50, rankedGamesPlayed: 20, currentWinStreak: 2, provisional: false }) }), 'competitive_player', 'tournament'],
    ['Social player', model({ social: { presence: source([{ id: 'f1', userId: 'f1', username: 'Maya', status: 'online', currentMode: 'daily' }]), activity: source([{ id: 'a1', userId: 'player-1', username: 'Player', type: 'win', metadata: {}, createdAt: '2026-07-10T11:00:00Z' }]), rivals: source([]) } }), 'social_player', 'friends'],
  ] as const)('$name', (_name, input, profile, primaryMode) => {
    const result = calculateHomePersonalization(input, NOW);
    expect(result.profile).toBe(profile);
    expect(result.primaryMode).toBe(primaryMode);
  });

  it('classifies conflicting strong signals as mixed', () => {
    const result = calculateHomePersonalization(model({
      journey: source({ activeChapterId: 'chapter-1', activeChapterTitle: 'Opening Table', completedNodes: 3, totalNodes: 8, totalCompleted: 3, hasAnyProgress: true, lastVisitedNodeId: 'node-3', updatedAt: '2026-07-10T10:00:00Z' }),
      tournament: source({ upcomingCount: 1, registeredTournamentIds: ['t1'], activeTournamentId: 't1', phase: 'match_ready', recoveryMatch: { matchId: 'm1', tournamentId: 't1', round: 1, opponentId: 'p2', opponentUsername: 'Maya', matchStatus: 'ready', readyDeadlineAt: '2026-07-10T18:00:00Z' } }),
    }), NOW);
    expect(result.profile).toBe('mixed_player');
    expect(result.secondaryModes).toContain('journey');
  });

  it('ignores stale and unavailable signals', () => {
    const result = calculateHomePersonalization(model({
      journey: source({ activeChapterId: 'chapter-1', activeChapterTitle: 'Opening Table', completedNodes: 3, totalNodes: 8, totalCompleted: 3, hasAnyProgress: true, lastVisitedNodeId: 'node-3', updatedAt: '2026-07-10T10:00:00Z' }, 'stale'),
      tournament: source({ upcomingCount: 1, registeredTournamentIds: ['t1'], activeTournamentId: 't1', phase: 'match_ready', recoveryMatch: { matchId: 'm1', tournamentId: 't1', round: 1, opponentId: 'p2', opponentUsername: 'Maya', matchStatus: 'ready', readyDeadlineAt: '2026-07-10T18:00:00Z' } }, 'unavailable'),
      stats: source({ rating: 1200, peakRating: 1250, globalRank: 50, rankedGamesPlayed: 20, currentWinStreak: 2, provisional: false }, 'error'),
    }), NOW);
    expect(result.profile).toBe('new_player');
    expect(result.reasoning).toEqual([]);
  });

  it('uses returning_player for historical evidence without current signals', () => {
    const result = calculateHomePersonalization(model({ stats: source({ rating: 1000, peakRating: 1100, globalRank: 100, rankedGamesPlayed: 12, currentWinStreak: 0, provisional: false }) }), NOW);
    expect(result.profile).toBe('returning_player');
    expect(result.primaryMode).toBe('multiplayer');
  });

  it('uses deterministic weights, tie-breaking, and confidence', () => {
    const first = calculateHomePersonalization(model({
      daily: { summary: source({ dateKey: '2026-07-10', week: [], weeklyCompletedCount: 0, currentStreakCount: 0, todayComplete: false }), fritz: source({ state: 'completed', outcome: 'win', rank: 1, currentGame: null, streak: 1, runDate: '2026-07-10', completedAt: '2026-07-10T09:00:00Z' }), puzzle: source({ state: 'unstarted', score: null, runDate: '2026-07-10', nextAvailableSlotIndex: 1 }) },
      journey: source({ activeChapterId: 'chapter-1', activeChapterTitle: 'Opening Table', completedNodes: 1, totalNodes: 8, totalCompleted: 1, hasAnyProgress: true, lastVisitedNodeId: 'node-1', updatedAt: '2026-07-10T10:00:00Z' }),
    }), NOW);
    const second = calculateHomePersonalization(model({
      journey: source({ activeChapterId: 'chapter-1', activeChapterTitle: 'Opening Table', completedNodes: 1, totalNodes: 8, totalCompleted: 1, hasAnyProgress: true, lastVisitedNodeId: 'node-1', updatedAt: '2026-07-10T10:00:00Z' }),
      daily: { summary: source({ dateKey: '2026-07-10', week: [], weeklyCompletedCount: 0, currentStreakCount: 0, todayComplete: false }), fritz: source({ state: 'completed', outcome: 'win', rank: 1, currentGame: null, streak: 1, runDate: '2026-07-10', completedAt: '2026-07-10T09:00:00Z' }), puzzle: source({ state: 'unstarted', score: null, runDate: '2026-07-10', nextAvailableSlotIndex: 1 }) },
    }), NOW);
    expect(first).toEqual(second);
    expect(first.confidence).toBeGreaterThanOrEqual(50);
    expect(HOME_PERSONALIZATION_WEIGHTS.journeyProgress).toBe(5);
  });

  it('is identical for identical input and gives normalized emphasis', () => {
    const input = model();
    const first = calculateHomePersonalization(input, NOW);
    expect(first).toEqual(calculateHomePersonalization(input, NOW));
    expect(Object.values(first.emphasis).every((value) => value >= 0 && value <= 100)).toBe(true);
  });
});
