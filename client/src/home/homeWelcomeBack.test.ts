// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { calculateWelcomeBack, HOME_WELCOME_BACK_PRIORITY } from './homeWelcomeBack';
import { createHomeSourceState, type HomeCommandCenterModel, type HomeSourceStatus } from './homeTypes';

const NOW = Date.parse('2026-07-10T12:00:00Z');
const LAST_VISIT = Date.parse('2026-07-10T08:00:00Z');

function source<T>(data: T, status?: HomeSourceStatus): ReturnType<typeof createHomeSourceState<T>>;
function source<T = never>(data: null, status?: HomeSourceStatus): ReturnType<typeof createHomeSourceState<T>>;
function source<T>(data: T | null, status: HomeSourceStatus = 'ready') {
  return createHomeSourceState(status, data, status === 'error' ? 'source unavailable' : null, NOW);
}

function model(overrides: Partial<HomeCommandCenterModel> = {}): HomeCommandCenterModel {
  const base: HomeCommandCenterModel = {
    identity: { kind: 'authenticated', userId: 'player-1', displayName: 'Player' },
    daily: {
      summary: source({ dateKey: '2026-07-10', week: [], weeklyCompletedCount: 0, currentStreakCount: 0, todayComplete: false }),
      fritz: source({ state: 'unstarted', outcome: null, rank: null, currentGame: null, streak: 0, runDate: '2026-07-10', completedAt: null }),
      puzzle: source({ state: 'unstarted', score: null, runDate: '2026-07-10', nextAvailableSlotIndex: 1, completedAt: null }),
    },
    social: { presence: source([]), activity: source([]), rivals: source([]) },
    tournament: source({ upcomingCount: 0, registeredTournamentIds: [], activeTournamentId: null, phase: null, recoveryMatch: null }),
    journey: source({ activeChapterId: 'ch1-fritz-trail', activeChapterTitle: 'Fritz Trail', completedNodes: 0, totalNodes: 8, totalCompleted: 0, hasAnyProgress: false, lastVisitedNodeId: null, updatedAt: null }),
    stats: source({ rating: 800, peakRating: 800, globalRank: null, rankedGamesPlayed: 0, currentWinStreak: 0, provisional: true }),
    runtime: source({ activeMatch: null, source: 'app-runtime-not-exposed' }, 'unavailable'),
    continueItems: [],
    primaryAction: null,
    momentum: null,
    welcomeBack: null,
    activityTimeline: null,
    personalization: null,
    freshness: { generatedAt: NOW, stale: false },
    sourceStatus: {
      dailySummary: 'ready', dailyFritz: 'ready', dailyPuzzle: 'ready', socialPresence: 'ready', socialActivity: 'ready', socialRivals: 'ready', tournament: 'ready', journey: 'ready', ranking: 'ready', runtime: 'unavailable',
    },
  };
  return { ...base, ...overrides };
}

describe('calculateWelcomeBack', () => {
  it('returns no changes for first login without a visit baseline', () => {
    const result = calculateWelcomeBack({ model: model(), lastVisitAt: null }, NOW);
    expect(result).toEqual({ summaryItems: [], headline: null, priority: 0, hasMeaningfulChanges: false, generatedAt: NOW });
  });

  it('curates a returning player’s current meaningful changes', () => {
    const result = calculateWelcomeBack({
      model: model({
        daily: {
          summary: source({ dateKey: '2026-07-10', week: [], weeklyCompletedCount: 0, currentStreakCount: 0, todayComplete: false }),
          fritz: source({ state: 'completed', outcome: 'win', rank: 4, currentGame: null, streak: 2, runDate: '2026-07-10', completedAt: '2026-07-10T10:00:00Z' }),
          puzzle: source({ state: 'unstarted', score: null, runDate: '2026-07-10', nextAvailableSlotIndex: 1, completedAt: null }),
        },
      }),
      lastVisitAt: LAST_VISIT,
    }, NOW);
    expect(result.summaryItems).toEqual([
      expect.objectContaining({ type: 'daily_fritz_result', title: 'Daily Fritz result is ready', route: 'dailyFritz' }),
    ]);
    expect(result.headline).toBe('While you were away');
    expect(result.hasMeaningfulChanges).toBe(true);
  });

  it('prioritizes tournament ready, Fritz result, then Puzzle result', () => {
    const result = calculateWelcomeBack({
      model: model({
        daily: {
          summary: source({ dateKey: '2026-07-10', week: [], weeklyCompletedCount: 0, currentStreakCount: 0, todayComplete: false }),
          fritz: source({ state: 'completed', outcome: 'win', rank: 4, currentGame: null, streak: 2, runDate: '2026-07-10', completedAt: '2026-07-10T10:00:00Z' }),
          puzzle: source({ state: 'completed', score: 90, runDate: '2026-07-10', nextAvailableSlotIndex: null, completedAt: '2026-07-10T10:30:00Z' }),
        },
        tournament: source({
          upcomingCount: 1, registeredTournamentIds: ['t1'], activeTournamentId: 't1', phase: 'match_ready',
          recoveryMatch: { matchId: 'm1', tournamentId: 't1', round: 1, opponentId: 'r1', opponentUsername: 'Maya', matchStatus: 'ready', readyDeadlineAt: '2026-07-10T13:00:00Z' },
        }),
      }),
      lastVisitAt: LAST_VISIT,
    }, NOW);
    expect(result.summaryItems.map((item) => item.type)).toEqual([
      'tournament_ready', 'daily_fritz_result', 'daily_puzzle_result',
    ]);
    expect(result.priority).toBe(HOME_WELCOME_BACK_PRIORITY.tournament_ready);
  });

  it('includes Journey progress with a real updatedAt timestamp', () => {
    const result = calculateWelcomeBack({
      model: model({
        journey: source({ activeChapterId: 'ch2-high-line', activeChapterTitle: 'High Line', completedNodes: 2, totalNodes: 8, totalCompleted: 2, hasAnyProgress: true, lastVisitedNodeId: 'n3', updatedAt: '2026-07-10T09:00:00Z' }),
      }),
      lastVisitAt: LAST_VISIT,
    }, NOW);
    expect(result.summaryItems).toEqual([
      expect.objectContaining({ type: 'journey_progress', title: 'Journey progress recorded', route: 'journey' }),
    ]);
  });

  it('includes fresh named friends but never stale presence', () => {
    const fresh = calculateWelcomeBack({
      model: model({
        social: {
          presence: source([
            { id: 'f2', userId: 'u2', username: 'Maya', status: 'online', currentMode: null },
            { id: 'f1', userId: 'u1', username: 'Hafnerjan', status: 'online', currentMode: null },
          ]),
          activity: source([]),
          rivals: source([]),
        },
      }),
      lastVisitAt: LAST_VISIT,
    }, NOW);
    expect(fresh.summaryItems.map((item) => item.title)).toEqual(['Hafnerjan is online', 'Maya is online']);

    const stale = calculateWelcomeBack({
      model: model({ social: { presence: source([{ id: 'f1', userId: 'u1', username: 'Maya', status: 'online', currentMode: null }], 'stale'), activity: source([]), rivals: source([]) } }),
      lastVisitAt: LAST_VISIT,
    }, NOW);
    expect(stale.summaryItems).toEqual([]);
  });

  it('includes weekly goal only from ready authoritative summary data', () => {
    const result = calculateWelcomeBack({
      model: model({ daily: { ...model().daily, summary: source({ dateKey: '2026-07-10', week: [], weeklyCompletedCount: 7, currentStreakCount: 7, todayComplete: true }) } }),
      lastVisitAt: LAST_VISIT,
    }, NOW);
    expect(result.summaryItems).toEqual([
      expect.objectContaining({ type: 'weekly_goal', title: 'Weekly goal complete', route: 'stats' }),
    ]);
  });

  it('does not emit unsupported new-peak, review, rival-history, or guessed items', () => {
    const result = calculateWelcomeBack({
      model: model({ stats: source({ rating: 900, peakRating: 900, globalRank: 1, rankedGamesPlayed: 10, currentWinStreak: 5, provisional: false }), social: { presence: source([]), activity: source([]), rivals: source([{ userId: 'r1', username: 'Maya', gamesPlayed: 4, winsAgainst: 2, lossesAgainst: 2, rating: 800 }]) } }),
      lastVisitAt: LAST_VISIT,
    }, NOW);
    expect(result.summaryItems).toEqual([]);
  });

  it('does not claim guest tournament, friend, or Fritz changes', () => {
    const result = calculateWelcomeBack({
      model: model({
        identity: { kind: 'guest', userId: null, displayName: null },
        tournament: source({ upcomingCount: 1, registeredTournamentIds: ['t1'], activeTournamentId: 't1', phase: 'match_ready', recoveryMatch: { matchId: 'm1', tournamentId: 't1', round: 1, opponentId: 'u1', opponentUsername: 'Maya', matchStatus: 'ready', readyDeadlineAt: null } }),
        daily: { ...model().daily, fritz: source({ state: 'completed', outcome: 'win', rank: 1, currentGame: null, streak: 1, runDate: '2026-07-10', completedAt: '2026-07-10T10:00:00Z' }) },
        social: { presence: source([{ id: 'f1', userId: 'u1', username: 'Maya', status: 'online', currentMode: null }]), activity: source([]), rivals: source([]) },
      }),
      lastVisitAt: LAST_VISIT,
    }, NOW);
    expect(result.summaryItems).toEqual([]);
  });

  it('deduplicates summaries and caps output at three items', () => {
    const result = calculateWelcomeBack({
      model: model({
        daily: {
          summary: source({ dateKey: '2026-07-10', week: [], weeklyCompletedCount: 7, currentStreakCount: 7, todayComplete: true }),
          fritz: source({ state: 'completed', outcome: 'win', rank: 1, currentGame: null, streak: 1, runDate: '2026-07-10', completedAt: '2026-07-10T10:00:00Z' }),
          puzzle: source({ state: 'completed', score: 90, runDate: '2026-07-10', nextAvailableSlotIndex: null, completedAt: '2026-07-10T10:10:00Z' }),
        },
        social: {
          presence: source([{ id: 'f1', userId: 'u1', username: 'Maya', status: 'online', currentMode: null }, { id: 'f1b', userId: 'u1', username: 'Maya', status: 'online', currentMode: null }]),
          activity: source([]),
          rivals: source([]),
        },
      }),
      lastVisitAt: LAST_VISIT,
    }, NOW);
    expect(result.summaryItems).toHaveLength(3);
    expect(result.summaryItems.filter((item) => item.type === 'friend_online')).toHaveLength(1);
  });

  it('is deterministic for identical input and source completion order', () => {
    const first = model({
      social: {
        presence: source([{ id: 'f2', userId: 'u2', username: 'Maya', status: 'online', currentMode: null }, { id: 'f1', userId: 'u1', username: 'Hafnerjan', status: 'online', currentMode: null }]),
        activity: source([]),
        rivals: source([]),
      },
    });
    const second = model({
      ...first,
      social: { ...first.social, presence: source([...(first.social.presence.data ?? [])].reverse()) },
    });
    const context = { model: first, lastVisitAt: LAST_VISIT };
    expect(calculateWelcomeBack(context, NOW)).toEqual(calculateWelcomeBack(context, NOW));
    expect(calculateWelcomeBack(context, NOW)).toEqual(calculateWelcomeBack({ model: second, lastVisitAt: LAST_VISIT }, NOW));
  });
});
