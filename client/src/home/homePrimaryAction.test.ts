// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { selectHomePrimaryAction, type HomePrimaryActionContext } from './homePrimaryAction';
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
    social: {
      presence: source([]),
      activity: source([]),
      rivals: source([]),
    },
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

function context(overrides: Partial<HomeCommandCenterModel> = {}, authStatus: 'loading' | 'ready' = 'ready'): HomePrimaryActionContext {
  return { model: model(overrides), authStatus };
}

function daily(overrides: Partial<HomeCommandCenterModel['daily']>): Pick<HomeCommandCenterModel, 'daily'> {
  return { daily: { ...model().daily, ...overrides } };
}

describe('selectHomePrimaryAction', () => {
  const cases: Array<{ name: string; input: HomePrimaryActionContext; expectedType: string }> = [
    {
      name: 'guest with both dailies unstarted chooses the guest-safe puzzle',
      input: context({ identity: { kind: 'guest', userId: null, displayName: null } }),
      expectedType: 'play_daily_puzzle',
    },
    { name: 'authenticated new player starts Daily Fritz', input: context(), expectedType: 'play_daily_fritz' },
    {
      name: 'started Daily Fritz continues before an unstarted Puzzle',
      input: context(daily({ fritz: source({ state: 'started', outcome: null, rank: null, currentGame: 2, streak: 2, runDate: '2026-07-10' }) })),
      expectedType: 'continue_daily_fritz',
    },
    {
      name: 'started Daily Puzzle continues when Fritz is complete',
      input: context(daily({
        fritz: source({ state: 'completed', outcome: 'win', rank: 3, currentGame: null, streak: 2, runDate: '2026-07-10' }),
        puzzle: source({ state: 'started', score: 20, runDate: '2026-07-10', nextAvailableSlotIndex: 2 }),
      })),
      expectedType: 'continue_daily_puzzle',
    },
    {
      name: 'both started dailies keep Fritz ahead of Puzzle',
      input: context(daily({
        fritz: source({ state: 'started', outcome: null, rank: null, currentGame: 1, streak: 2, runDate: '2026-07-10' }),
        puzzle: source({ state: 'started', score: 20, runDate: '2026-07-10', nextAvailableSlotIndex: 2 }),
      })),
      expectedType: 'continue_daily_fritz',
    },
    {
      name: 'one completed daily never blocks the other unstarted daily',
      input: context(daily({
        fritz: source({ state: 'completed', outcome: 'loss', rank: null, currentGame: null, streak: 2, runDate: '2026-07-10' }),
      })),
      expectedType: 'play_daily_puzzle',
    },
    {
      name: 'both completed dailies use the fallback without an invented task',
      input: context(daily({
        fritz: source({ state: 'completed', outcome: 'win', rank: 1, currentGame: null, streak: 2, runDate: '2026-07-10' }),
        puzzle: source({ state: 'completed', score: 95, runDate: '2026-07-10', nextAvailableSlotIndex: null }),
      })),
      expectedType: 'play_recommended_mode',
    },
    {
      name: 'incomplete Journey precedes unstarted dailies',
      input: context({
        ...daily({
          fritz: source({ state: 'completed', outcome: 'win', rank: 1, currentGame: null, streak: 2, runDate: '2026-07-10' }),
          puzzle: source({ state: 'completed', score: 95, runDate: '2026-07-10', nextAvailableSlotIndex: null }),
        }),
        journey: source({ activeChapterId: 'ch2-high-line', activeChapterTitle: 'High Line', completedNodes: 2, totalNodes: 8, totalCompleted: 5, hasAnyProgress: true, lastVisitedNodeId: 'n3', updatedAt: null }),
      }),
      expectedType: 'continue_lesson',
    },
    {
      name: 'ready tournament match outranks every available daily',
      input: context({
        tournament: source({
          upcomingCount: 1, registeredTournamentIds: ['t1'], activeTournamentId: 't1', phase: 'match_ready',
          recoveryMatch: { matchId: 'm1', tournamentId: 't1', round: 1, opponentId: 'r1', opponentUsername: 'Maya', matchStatus: 'ready', readyDeadlineAt: '2026-07-10T13:00:00Z' },
        }),
      }),
      expectedType: 'continue_tournament',
    },
    {
      name: 'fresh online known rival is selected after completed dailies',
      input: context({
        ...daily({
          fritz: source({ state: 'completed', outcome: 'win', rank: 1, currentGame: null, streak: 2, runDate: '2026-07-10' }),
          puzzle: source({ state: 'completed', score: 95, runDate: '2026-07-10', nextAvailableSlotIndex: null }),
        }),
        social: {
          presence: source([{ id: 'f1', userId: 'r1', username: 'Maya', status: 'online', currentMode: null }]),
          activity: source([]),
          rivals: source([{ userId: 'r1', username: 'Maya', gamesPlayed: 4, winsAgainst: 2, lossesAgainst: 2, rating: 810 }]),
        },
      }),
      expectedType: 'challenge_online_rival',
    },
  ];

  it.each(cases)('$name', ({ input, expectedType }) => {
    expect(selectHomePrimaryAction(input, NOW).type).toEqual(expectedType);
  });

  it('does not select a rival from stale presence', () => {
    const action = selectHomePrimaryAction(context({
      ...daily({
        fritz: source({ state: 'completed', outcome: 'win', rank: 1, currentGame: null, streak: 2, runDate: '2026-07-10' }),
        puzzle: source({ state: 'completed', score: 95, runDate: '2026-07-10', nextAvailableSlotIndex: null }),
      }),
      social: {
        presence: source([{ id: 'f1', userId: 'r1', username: 'Maya', status: 'online', currentMode: null }], 'stale'),
        activity: source([]),
        rivals: source([{ userId: 'r1', username: 'Maya', gamesPlayed: 4, winsAgainst: 2, lossesAgainst: 2, rating: 810 }]),
      },
    }), NOW);
    expect(action.type).toEqual('play_recommended_mode');
  });

  it('ignores social errors while retaining a safe daily action', () => {
    const action = selectHomePrimaryAction(context({
      social: { presence: source(null, 'error'), activity: source(null, 'error'), rivals: source(null, 'error') },
    }), NOW);
    expect(action.type).toEqual('play_daily_fritz');
  });

  it('continues Puzzle when Fritz errors and Puzzle is authoritative', () => {
    const action = selectHomePrimaryAction(context(daily({
      fritz: source(null, 'error'),
      puzzle: source({ state: 'started', score: 20, runDate: '2026-07-10', nextAvailableSlotIndex: 2 }),
    })), NOW);
    expect(action.type).toEqual('continue_daily_puzzle');
  });

  it('continues Fritz when Puzzle errors and Fritz is authoritative', () => {
    const action = selectHomePrimaryAction(context(daily({
      fritz: source({ state: 'started', outcome: null, rank: null, currentGame: 1, streak: 2, runDate: '2026-07-10' }),
      puzzle: source(null, 'error'),
    })), NOW);
    expect(action.type).toEqual('continue_daily_fritz');
  });

  it('falls back when both daily sources are unavailable', () => {
    const action = selectHomePrimaryAction(context(daily({ fritz: source(null, 'unavailable'), puzzle: source(null, 'unavailable') })), NOW);
    expect(action).toEqual({
      type: 'play_recommended_mode', title: 'Choose your next game', reason: 'Pick up where you want to play.', cta: 'Play', route: 'singlePlayerHub', priority: 0, expiresAt: null,
    });
  });

  it('uses only the generic fallback while authenticated data is loading', () => {
    expect(selectHomePrimaryAction(context({}, 'loading'), NOW).type).toEqual('play_recommended_mode');
  });

  it('does not reuse a prior authenticated action after logout', () => {
    const action = selectHomePrimaryAction(context({
      identity: { kind: 'guest', userId: null, displayName: null },
      ...daily({ fritz: source(null, 'unavailable'), puzzle: source(null, 'unavailable') }),
    }), NOW);
    expect(action.type).toEqual('play_recommended_mode');
  });

  it('selects from the available partial model without waiting for unrelated sources', () => {
    const action = selectHomePrimaryAction(context(daily({
      fritz: source(null, 'loading'),
      puzzle: source({ state: 'unstarted', score: null, runDate: '2026-07-10', nextAvailableSlotIndex: 1 }),
    })), NOW);
    expect(action.type).toEqual('play_daily_puzzle');
  });

  it('uses stable identifiers to break equal-priority rival ties', () => {
    const shared = {
      ...daily({
        fritz: source({ state: 'completed', outcome: 'win', rank: 1, currentGame: null, streak: 2, runDate: '2026-07-10' }),
        puzzle: source({ state: 'completed', score: 95, runDate: '2026-07-10', nextAvailableSlotIndex: null }),
      }),
      social: {
        presence: source([
          { id: 'f-b', userId: 'r-b', username: 'Beta', status: 'online' as const, currentMode: null },
          { id: 'f-a', userId: 'r-a', username: 'Alpha', status: 'online' as const, currentMode: null },
        ]),
        activity: source([]),
        rivals: source([
          { userId: 'r-b', username: 'Beta', gamesPlayed: 2, winsAgainst: 1, lossesAgainst: 1, rating: 800 },
          { userId: 'r-a', username: 'Alpha', gamesPlayed: 2, winsAgainst: 1, lossesAgainst: 1, rating: 800 },
        ]),
      },
    };
    expect(selectHomePrimaryAction(context(shared), NOW)).toEqual({
      type: 'challenge_online_rival', title: 'Challenge Alpha', reason: 'Alpha is online.', cta: 'Open Friends', route: 'friends', priority: 10, expiresAt: null, rivalId: 'r-a',
    });
  });

  it('returns the same action for identical input and social array completion order', () => {
    const first = context({
      ...daily({
        fritz: source({ state: 'completed', outcome: 'win', rank: 1, currentGame: null, streak: 2, runDate: '2026-07-10' }),
        puzzle: source({ state: 'completed', score: 95, runDate: '2026-07-10', nextAvailableSlotIndex: null }),
      }),
      social: {
        presence: source([{ id: 'f-b', userId: 'r-b', username: 'Beta', status: 'online', currentMode: null }, { id: 'f-a', userId: 'r-a', username: 'Alpha', status: 'online', currentMode: null }]),
        activity: source([]),
        rivals: source([{ userId: 'r-b', username: 'Beta', gamesPlayed: 2, winsAgainst: 1, lossesAgainst: 1, rating: 800 }, { userId: 'r-a', username: 'Alpha', gamesPlayed: 2, winsAgainst: 1, lossesAgainst: 1, rating: 800 }]),
      },
    });
    const second = context({
      ...first.model,
      social: {
        ...first.model.social,
        presence: source([...(first.model.social.presence.data ?? [])].reverse()),
        rivals: source([...(first.model.social.rivals.data ?? [])].reverse()),
      },
    });
    expect(selectHomePrimaryAction(first, NOW)).toEqual(selectHomePrimaryAction(first, NOW));
    expect(selectHomePrimaryAction(first, NOW)).toEqual(selectHomePrimaryAction(second, NOW));
  });

  it('never treats completed or unknown Daily Fritz as an unstarted play candidate', () => {
    const completed = selectHomePrimaryAction(context(daily({
      fritz: source({ state: 'completed', outcome: 'win', rank: 1, currentGame: null, streak: 2, runDate: '2026-07-10' }),
      puzzle: source(null, 'unavailable'),
    })), NOW);
    const unknown = selectHomePrimaryAction(context(daily({
      fritz: source({ state: 'unknown', outcome: null, rank: null, currentGame: null, streak: null, runDate: null }),
      puzzle: source(null, 'unavailable'),
    })), NOW);
    expect(completed.type).not.toEqual('play_daily_fritz');
    expect(unknown.type).not.toEqual('play_daily_fritz');
  });

  it('does not invent runtime resume or pending-challenge actions while those sources are unavailable', () => {
    const action = selectHomePrimaryAction(context({
      runtime: source({ activeMatch: null, source: 'app-runtime-not-exposed' }, 'unavailable'),
    }), NOW);
    expect(action.type).toEqual('play_daily_fritz');
  });
});
