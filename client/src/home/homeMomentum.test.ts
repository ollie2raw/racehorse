import { describe, expect, it } from 'vitest';
import { calculateHomeMomentum, HOME_MOMENTUM_WEIGHTS } from './homeMomentum';
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
      fritz: source({ state: 'unstarted', outcome: null, rank: null, currentGame: null, streak: 0, runDate: '2026-07-10' }),
      puzzle: source({ state: 'unstarted', score: null, runDate: '2026-07-10', nextAvailableSlotIndex: 1 }),
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

function daily(overrides: Partial<HomeCommandCenterModel['daily']>): Pick<HomeCommandCenterModel, 'daily'> {
  return { daily: { ...model().daily, ...overrides } };
}

describe('calculateHomeMomentum', () => {
  const cases: Array<{ name: string; input: HomeCommandCenterModel; level: string; score: number; progress: number }> = [
    { name: 'brand new player is cold with real daily opportunities', input: model(), level: 'cold', score: 0, progress: 0 },
    {
      name: 'guest excludes authenticated Daily Fritz opportunity',
      input: model({ identity: { kind: 'guest', userId: null, displayName: null }, ...daily({ fritz: source(null, 'unavailable') }) }),
      level: 'cold', score: 0, progress: 0,
    },
    {
      name: 'Daily Fritz only locks in engagement',
      input: model(daily({
        fritz: source({ state: 'completed', outcome: 'win', rank: 3, currentGame: null, streak: 2, runDate: '2026-07-10' }),
        puzzle: source(null, 'unavailable'),
      })),
      level: 'locked_in', score: 40, progress: 62,
    },
    {
      name: 'Daily Puzzle only is active',
      input: model(daily({
        fritz: source(null, 'unavailable'),
        puzzle: source({ state: 'completed', score: 80, runDate: '2026-07-10', nextAvailableSlotIndex: null }),
      })),
      level: 'active', score: 25, progress: 38,
    },
    {
      name: 'both completed dailies complete the primary day journey',
      input: model(daily({
        fritz: source({ state: 'completed', outcome: 'win', rank: 3, currentGame: null, streak: 2, runDate: '2026-07-10' }),
        puzzle: source({ state: 'completed', score: 80, runDate: '2026-07-10', nextAvailableSlotIndex: null }),
      })),
      level: 'completed', score: 65, progress: 100,
    },
    {
      name: 'Journey progress today warms up the player',
      input: model({
        journey: source({ activeChapterId: 'ch2-high-line', activeChapterTitle: 'High Line', completedNodes: 2, totalNodes: 8, totalCompleted: 5, hasAnyProgress: true, lastVisitedNodeId: 'n3', updatedAt: '2026-07-10T08:00:00Z' }),
      }),
      level: 'warming_up', score: 15, progress: 23,
    },
    {
      name: 'an assigned tournament match is active',
      input: model({
        tournament: source({
          upcomingCount: 1, registeredTournamentIds: ['t1'], activeTournamentId: 't1', phase: 'match_ready',
          recoveryMatch: { matchId: 'm1', tournamentId: 't1', round: 1, opponentId: 'r1', opponentUsername: 'Maya', matchStatus: 'ready', readyDeadlineAt: null },
        }),
      }),
      level: 'active', score: 20, progress: 31,
    },
    {
      name: 'self-authored fresh activity locks in social engagement',
      input: model({
        social: {
          presence: source([]),
          activity: source([{ id: 'a1', userId: 'player-1', username: 'Player', type: 'win', metadata: {}, createdAt: '2026-07-10T09:00:00Z' }]),
          rivals: source([]),
        },
      }),
      level: 'locked_in', score: 10, progress: 15,
    },
    {
      name: 'stale social presence does not create engagement points',
      input: model({
        social: {
          presence: source([{ id: 'f1', userId: 'r1', username: 'Maya', status: 'online', currentMode: null }], 'stale'),
          activity: source([], 'stale'),
          rivals: source([{ userId: 'r1', username: 'Maya', gamesPlayed: 3, winsAgainst: 1, lossesAgainst: 2, rating: 800 }], 'stale'),
        },
      }),
      level: 'cold', score: 0, progress: 0,
    },
    {
      name: 'unavailable and errored sources remain cold instead of becoming empty success',
      input: model({
        daily: {
          summary: source(null, 'error'),
          fritz: source(null, 'error'),
          puzzle: source(null, 'unavailable'),
        },
        journey: source(null, 'error'),
        tournament: source(null, 'unavailable'),
      }),
      level: 'cold', score: 0, progress: 0,
    },
  ];

  it.each(cases)('$name', ({ input, level, score, progress }) => {
    const result = calculateHomeMomentum(input, NOW);
    expect(result.level).toEqual(level);
    expect(result.score).toEqual(score);
    expect(result.progressPercent).toEqual(progress);
  });

  it('uses the published deterministic scoring table', () => {
    const result = calculateHomeMomentum(model({
      ...daily({
        fritz: source({ state: 'completed', outcome: 'win', rank: 3, currentGame: null, streak: 2, runDate: '2026-07-10' }),
        puzzle: source({ state: 'started', score: 20, runDate: '2026-07-10', nextAvailableSlotIndex: 2 }),
      }),
      journey: source({ activeChapterId: 'ch2-high-line', activeChapterTitle: 'High Line', completedNodes: 2, totalNodes: 8, totalCompleted: 5, hasAnyProgress: true, lastVisitedNodeId: 'n3', updatedAt: '2026-07-10T08:00:00Z' }),
    }), NOW);
    expect(result.score).toEqual(
      HOME_MOMENTUM_WEIGHTS.daily_fritz_completed +
      HOME_MOMENTUM_WEIGHTS.daily_puzzle_started +
      HOME_MOMENTUM_WEIGHTS.journey_progressed,
    );
    expect(result.reasons.map((entry) => entry.id)).toEqual([
      'daily_fritz_completed', 'daily_puzzle_started', 'journey_progressed',
    ]);
    expect(result.missingOpportunities.map((entry) => entry.id)).toEqual(['daily_puzzle', 'journey']);
  });

  it('does not declare a completed day while a supported Journey continuation remains', () => {
    const result = calculateHomeMomentum(model({
      ...daily({
        fritz: source({ state: 'completed', outcome: 'win', rank: 3, currentGame: null, streak: 2, runDate: '2026-07-10' }),
        puzzle: source({ state: 'completed', score: 80, runDate: '2026-07-10', nextAvailableSlotIndex: null }),
      }),
      journey: source({ activeChapterId: 'ch2-high-line', activeChapterTitle: 'High Line', completedNodes: 2, totalNodes: 8, totalCompleted: 5, hasAnyProgress: true, lastVisitedNodeId: 'n3', updatedAt: '2026-07-09T08:00:00Z' }),
    }), NOW);
    expect(result.level).toEqual('locked_in');
    expect(result.missingOpportunities).toContainEqual({ id: 'journey', label: 'Continue Journey' });
  });

  it('includes only authoritative missing opportunities', () => {
    const result = calculateHomeMomentum(model({
      social: {
        presence: source([{ id: 'f1', userId: 'r1', username: 'Maya', status: 'online', currentMode: null }]),
        activity: source([]),
        rivals: source([{ userId: 'r1', username: 'Maya', gamesPlayed: 3, winsAgainst: 1, lossesAgainst: 2, rating: 800 }]),
      },
    }), NOW);
    expect(result.missingOpportunities).toEqual([
      { id: 'daily_fritz', label: 'Today’s Daily Fritz' },
      { id: 'daily_puzzle', label: 'Today’s Daily Puzzle' },
      { id: 'challenge_rival', label: 'Challenge Maya' },
    ]);
  });

  it('is deterministic when inputs are identical and activity arrays resolve in a different order', () => {
    const first = model({
      social: {
        presence: source([]),
        activity: source([
          { id: 'a2', userId: 'player-1', username: 'Player', type: 'win', metadata: {}, createdAt: '2026-07-10T10:00:00Z' },
          { id: 'a1', userId: 'player-1', username: 'Player', type: 'tournament', metadata: {}, createdAt: '2026-07-10T09:00:00Z' },
        ]),
        rivals: source([]),
      },
    });
    const second = model({
      ...first,
      social: { ...first.social, activity: source([...(first.social.activity.data ?? [])].reverse()) },
    });
    expect(calculateHomeMomentum(first, NOW)).toEqual(calculateHomeMomentum(first, NOW));
    expect(calculateHomeMomentum(first, NOW)).toEqual(calculateHomeMomentum(second, NOW));
  });
});
