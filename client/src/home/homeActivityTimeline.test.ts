// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildHomeActivityTimeline, HOME_ACTIVITY_EVENT_PRIORITIES } from './homeActivityTimeline';
import { createHomeSourceState, type HomeCommandCenterModel, type HomeSourceStatus } from './homeTypes';

const NOW = Date.parse('2026-07-10T12:00:00Z');

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

describe('buildHomeActivityTimeline', () => {
  it('emits no events for an authenticated new player', () => {
    expect(buildHomeActivityTimeline(model(), NOW).events).toEqual([]);
  });

  it('does not emit authenticated-only events for a guest', () => {
    const result = buildHomeActivityTimeline(model({
      identity: { kind: 'guest', userId: null, displayName: null },
      daily: { ...model().daily, fritz: source({ state: 'completed', outcome: 'win', rank: 1, currentGame: null, streak: 1, runDate: '2026-07-10', completedAt: '2026-07-10T10:00:00Z' }) },
      tournament: source({ upcomingCount: 1, registeredTournamentIds: ['t1'], activeTournamentId: 't1', phase: 'match_ready', recoveryMatch: { matchId: 'm1', tournamentId: 't1', round: 1, opponentId: 'u1', opponentUsername: 'Maya', matchStatus: 'ready', readyDeadlineAt: null } }),
      social: { presence: source([{ id: 'f1', userId: 'u1', username: 'Maya', status: 'online', currentMode: null }]), activity: source([{ id: 'a1', userId: 'u1', username: 'Maya', type: 'win', metadata: {}, createdAt: '2026-07-10T10:00:00Z' }]), rivals: source([]) },
    }), NOW);
    expect(result.events).toEqual([]);
  });

  it('emits Daily Fritz started and completed events with stable IDs', () => {
    const started = buildHomeActivityTimeline(model({ daily: { ...model().daily, fritz: source({ state: 'started', outcome: null, rank: null, currentGame: 2, streak: 1, runDate: '2026-07-10', completedAt: null }) } }), NOW);
    expect(started.events).toEqual([expect.objectContaining({ id: 'daily-fritz:2026-07-10:started', type: 'daily_fritz_started', status: 'active', payload: { currentGame: 2, runDate: '2026-07-10' } })]);

    const completed = buildHomeActivityTimeline(model({ daily: { ...model().daily, fritz: source({ state: 'completed', outcome: 'win', rank: 4, currentGame: null, streak: 2, runDate: '2026-07-10', completedAt: '2026-07-10T10:00:00Z' }) } }), NOW);
    expect(completed.events).toEqual([expect.objectContaining({ id: 'daily-fritz:2026-07-10:completed', type: 'daily_fritz_completed', occurredAt: '2026-07-10T10:00:00Z' })]);
  });

  it('emits Daily Puzzle started and completed events', () => {
    const result = buildHomeActivityTimeline(model({ daily: { ...model().daily, puzzle: source({ state: 'started', score: 20, runDate: '2026-07-10', nextAvailableSlotIndex: 2, completedAt: null }) } }), NOW);
    expect(result.events[0]).toMatchObject({ id: 'daily-puzzle:2026-07-10:started', type: 'daily_puzzle_started', priority: HOME_ACTIVITY_EVENT_PRIORITIES.daily_puzzle_started });

    const completed = buildHomeActivityTimeline(model({ daily: { ...model().daily, puzzle: source({ state: 'completed', score: 90, runDate: '2026-07-10', nextAvailableSlotIndex: null, completedAt: '2026-07-10T11:00:00Z' }) } }), NOW);
    expect(completed.events[0]).toMatchObject({ id: 'daily-puzzle:2026-07-10:completed', type: 'daily_puzzle_completed', occurredAt: '2026-07-10T11:00:00Z' });
  });

  it('emits both completed Daily events and omits unknown states', () => {
    const result = buildHomeActivityTimeline(model({ daily: {
      summary: model().daily.summary,
      fritz: source({ state: 'completed', outcome: 'win', rank: 1, currentGame: null, streak: 1, runDate: '2026-07-10', completedAt: '2026-07-10T10:00:00Z' }),
      puzzle: source({ state: 'completed', score: 90, runDate: '2026-07-10', nextAvailableSlotIndex: null, completedAt: '2026-07-10T11:00:00Z' }),
    } }), NOW);
    expect(result.events.map((event) => event.type)).toEqual(['daily_fritz_completed', 'daily_puzzle_completed']);
    const unknown = buildHomeActivityTimeline(model({ daily: { ...model().daily, fritz: source({ state: 'unknown', outcome: null, rank: null, currentGame: null, streak: null, runDate: null, completedAt: null }), puzzle: source({ state: 'unknown', score: null, runDate: null, nextAvailableSlotIndex: null, completedAt: null }) } }), NOW);
    expect(unknown.events).toEqual([]);
  });

  it('emits Journey progress with and without a timestamp', () => {
    const dated = buildHomeActivityTimeline(model({ journey: source({ activeChapterId: 'ch2-high-line', activeChapterTitle: 'High Line', completedNodes: 2, totalNodes: 8, totalCompleted: 2, hasAnyProgress: true, lastVisitedNodeId: 'n2', updatedAt: '2026-07-10T09:00:00Z' }) }), NOW);
    expect(dated.events[0]).toMatchObject({ type: 'journey_progressed', occurredAt: '2026-07-10T09:00:00Z', status: 'active' });
    const undated = buildHomeActivityTimeline(model({ journey: source({ activeChapterId: 'ch2-high-line', activeChapterTitle: 'High Line', completedNodes: 8, totalNodes: 8, totalCompleted: 8, hasAnyProgress: true, lastVisitedNodeId: null, updatedAt: null }) }), NOW);
    expect(undated.events[0]).toMatchObject({ type: 'journey_progressed', occurredAt: null, status: 'completed' });
  });

  it('emits ready and in-progress tournament events but filters expired matches', () => {
    const ready = buildHomeActivityTimeline(model({ tournament: source({ upcomingCount: 1, registeredTournamentIds: ['t1'], activeTournamentId: 't1', phase: 'match_ready', recoveryMatch: { matchId: 'm1', tournamentId: 't1', round: 1, opponentId: 'u1', opponentUsername: 'Maya', matchStatus: 'ready', readyDeadlineAt: '2026-07-10T13:00:00Z' } }) }), NOW);
    expect(ready.events[0]).toMatchObject({ type: 'tournament_match_ready', status: 'pending', expiresAt: '2026-07-10T13:00:00Z' });
    const inProgress = buildHomeActivityTimeline(model({ tournament: source({ upcomingCount: 1, registeredTournamentIds: ['t1'], activeTournamentId: 't1', phase: 'in_match', recoveryMatch: { matchId: 'm1', tournamentId: 't1', round: 1, opponentId: 'u1', opponentUsername: 'Maya', matchStatus: 'in_progress', readyDeadlineAt: '2026-07-10T13:00:00Z' } }) }), NOW);
    expect(inProgress.events[0]?.type).toBe('tournament_match_in_progress');
    const expired = buildHomeActivityTimeline(model({ tournament: source({ upcomingCount: 1, registeredTournamentIds: ['t1'], activeTournamentId: 't1', phase: 'match_ready', recoveryMatch: { matchId: 'm1', tournamentId: 't1', round: 1, opponentId: 'u1', opponentUsername: 'Maya', matchStatus: 'ready', readyDeadlineAt: '2026-07-10T11:00:00Z' } }) }), NOW);
    expect(expired.events).toEqual([]);
  });

  it('emits fresh named friends and suppresses stale presence', () => {
    const fresh = buildHomeActivityTimeline(model({ social: { presence: source([{ id: 'f1', userId: 'u1', username: 'Maya', status: 'online', currentMode: 'daily' }]), activity: source([]), rivals: source([]) } }), NOW);
    expect(fresh.events[0]).toMatchObject({ id: 'friend-online:u1', type: 'friend_online', payload: { username: 'Maya', currentMode: 'daily' } });
    const stale = buildHomeActivityTimeline(model({ social: { presence: source([{ id: 'f1', userId: 'u1', username: 'Maya', status: 'online', currentMode: null }], 'stale'), activity: source([]), rivals: source([]) } }), NOW);
    expect(stale.events).toEqual([]);
  });

  it('emits only current player social activity and deduplicates duplicate IDs', () => {
    const result = buildHomeActivityTimeline(model({ social: { presence: source([]), activity: source([
      { id: 'a1', userId: 'other', username: 'Other', type: 'win', metadata: {}, createdAt: '2026-07-10T09:00:00Z' },
      { id: 'a2', userId: 'player-1', username: 'Player', type: 'tournament', metadata: {}, createdAt: '2026-07-10T10:00:00Z' },
      { id: 'a2', userId: 'player-1', username: 'Player', type: 'tournament', metadata: {}, createdAt: '2026-07-10T10:00:00Z' },
    ]), rivals: source([]) } }), NOW);
    expect(result.events).toEqual([expect.objectContaining({ id: 'social-activity:a2', type: 'player_social_activity', occurredAt: '2026-07-10T10:00:00Z' })]);
  });

  it('emits weekly goal only from ready summary state and reports exact source coverage', () => {
    const result = buildHomeActivityTimeline(model({ daily: { ...model().daily, summary: source({ dateKey: '2026-07-10', week: [], weeklyCompletedCount: 7, currentStreakCount: 7, todayComplete: true }) }, social: { presence: source([], 'loading'), activity: source([], 'error'), rivals: source([], 'unavailable') } }), NOW);
    expect(result.events).toEqual([expect.objectContaining({ type: 'weekly_daily_goal_completed' })]);
    expect(result.sourceCoverage).toEqual({ dailySummary: 'ready', dailyFritz: 'ready', dailyPuzzle: 'ready', socialPresence: 'loading', socialActivity: 'error', socialRivals: 'unavailable', tournament: 'ready', journey: 'ready', ranking: 'ready', runtime: 'unavailable' });
  });

  it('orders by priority, then timestamp, then stable identity and is array-order invariant', () => {
    const first = model({
      daily: { ...model().daily, fritz: source({ state: 'completed', outcome: 'win', rank: 1, currentGame: null, streak: 1, runDate: '2026-07-10', completedAt: '2026-07-10T10:00:00Z' }), puzzle: source({ state: 'completed', score: 90, runDate: '2026-07-10', nextAvailableSlotIndex: null, completedAt: '2026-07-10T11:00:00Z' }) },
      social: { presence: source([{ id: 'f2', userId: 'u2', username: 'Beta', status: 'online', currentMode: null }, { id: 'f1', userId: 'u1', username: 'Alpha', status: 'online', currentMode: null }]), activity: source([]), rivals: source([]) },
    });
    const second = model({ ...first, social: { ...first.social, presence: source([...(first.social.presence.data ?? [])].reverse()) } });
    const firstTimeline = buildHomeActivityTimeline(first, NOW);
    expect(firstTimeline.events.map((event) => event.type)).toEqual(['daily_fritz_completed', 'daily_puzzle_completed', 'friend_online', 'friend_online']);
    expect(firstTimeline.latestOccurredAt).toBe('2026-07-10T11:00:00Z');
    expect(firstTimeline).toEqual(buildHomeActivityTimeline(second, NOW));
    expect(firstTimeline).toEqual(buildHomeActivityTimeline(first, NOW));
  });
});
