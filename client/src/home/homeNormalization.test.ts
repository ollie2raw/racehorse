import { describe, expect, it } from 'vitest';
import {
  normalizeDailyFritz,
  normalizeDailyPuzzle,
  normalizeDailySummary,
  normalizeJourney,
  normalizeRanking,
  normalizeSocial,
  normalizeTournament,
} from './homeNormalization';
import { createHomeSourceState } from './homeTypes';

describe('Home command-center normalization', () => {
  it('normalizes Daily Fritz status, outcome, rank, and game', () => {
    expect(normalizeDailyFritz({
      ok: true,
      run_date: '2026-07-10',
      fritz_tier: 'elite',
      deal_size: 7,
      winning_score: 60,
      attempt_status: 'completed',
      current_game_number: 3,
      needs_completion: false,
      streak: 8,
      result: null,
      set_result: { version: 2, format: 'best_of_3', playerGamesWon: 2, fritzGamesWon: 1, totalPointDiff: 9, games: [], setWinner: 'player' },
      rank: 12,
      leaderboard_preview: [],
    })).toEqual({
      state: 'completed', outcome: 'win', rank: 12, currentGame: 3, streak: 8, runDate: '2026-07-10', completedAt: null,
    });
  });

  it('normalizes Daily Puzzle progress without treating missing payload as complete', () => {
    expect(normalizeDailyPuzzle({
      ok: true,
      runDate: '2026-07-10',
      setVersion: 1,
      slots: [],
      attemptStatus: 'started',
      attempt: { id: 'a1', userId: 'u1', username: 'player', puzzleDate: '2026-07-10', setVersion: 1, status: 'started', currentSlotIndex: 2, puzzlesCompleted: 1, totalScore: 41, masterChainScore: 0, startedAt: '2026-07-10T10:00:00Z', completedAt: null, updatedAt: '2026-07-10T10:00:00Z', reviewUnlocked: false, practiceMode: 'none', result: { slots: [] } },
      nextAvailableSlotIndex: 2,
      leaderboardPreview: [],
      legacySinglePuzzleDay: false,
    })).toMatchObject({ state: 'started', score: 41, runDate: '2026-07-10', nextAvailableSlotIndex: 2 });
  });

  it('normalizes the Home daily summary and preserves its week entries', () => {
    expect(normalizeDailySummary({
      ok: true,
      today: '2026-07-10',
      week: [{ dateKey: '2026-07-10', label: 'Fri', fritzCompleted: true, puzzleCompleted: false, complete: true, isToday: true, isFuture: false }],
      weeklyCompletedCount: 4,
      currentStreakCount: 3,
      todayComplete: true,
    })).toEqual({
      dateKey: '2026-07-10',
      week: [{ dateKey: '2026-07-10', label: 'Fri', fritzCompleted: true, puzzleCompleted: false, complete: true, isToday: true, isFuture: false }],
      weeklyCompletedCount: 4,
      currentStreakCount: 3,
      todayComplete: true,
    });
  });

  it('normalizes social payloads into presentation-neutral fields', () => {
    expect(normalizeSocial(
      [{ id: 'f1', userId: 'u2', username: 'Maya', presence_status: 'in_game', current_mode: 'daily' }],
      [{ id: 'a1', user_id: 'u2', username: 'Maya', type: 'streak', metadata: { days: 5 }, created_at: '2026-07-10T10:00:00Z' }],
      [{ userId: 'u2', username: 'Maya', gamesPlayed: 4, winsAgainst: 2, lossesAgainst: 2, rating: 812 }],
    )).toEqual({
      friends: [{ id: 'f1', userId: 'u2', username: 'Maya', status: 'in_game', currentMode: 'daily' }],
      activity: [{ id: 'a1', userId: 'u2', username: 'Maya', type: 'streak', metadata: { days: 5 }, createdAt: '2026-07-10T10:00:00Z' }],
      rivals: [{ userId: 'u2', username: 'Maya', gamesPlayed: 4, winsAgainst: 2, lossesAgainst: 2, rating: 812 }],
    });
  });

  it('normalizes tournament, Journey, and ranking sources', () => {
    expect(normalizeTournament({
      upcoming: [{ id: 't1' }],
      registrations: [{ tournament_id: 't1', status: 'registered' }, { tournament_id: 't2', status: 'withdrawn' }],
      activeTournamentId: 't1',
      tournamentPhase: 'match_ready',
      recoveryMatch: { matchId: 'm1', tournamentId: 't1', round: 1, opponentId: 'u2', opponentUsername: 'Maya', matchStatus: 'ready', readyDeadlineAt: null },
    })).toMatchObject({ upcomingCount: 1, registeredTournamentIds: ['t1'], activeTournamentId: 't1', recoveryMatch: { matchId: 'm1' } });

    expect(normalizeJourney({
      version: 2,
      activeChapterId: 'ch1-fritz-trail',
      chapters: { 'ch1-fritz-trail': { completedNodeIds: ['n1'], lastVisitedNodeId: 'n2', completedAt: null, completionCelebrated: false } },
      updatedAt: '2026-07-10T10:00:00Z',
    }, { activeChapter: { chapterId: 'ch1-fritz-trail', title: 'Fritz Trail' }, activeChapterCompleted: 1, activeChapterTotal: 8, totalCompleted: 1, hasAnyProgress: true })).toMatchObject({ activeChapterId: 'ch1-fritz-trail', completedNodes: 1, lastVisitedNodeId: 'n2' });

    expect(normalizeRanking({ glicko_rating: 900, glicko_rd: 100, provisional: false, ranked_games_played: 20, peak_rating: 940, rank: 55, currentWinStreak: 3 })).toEqual({ rating: 900, peakRating: 940, globalRank: 55, rankedGamesPlayed: 20, currentWinStreak: 3, provisional: false });
  });
});

describe('Home source freshness states', () => {
  it('represents loading, ready, stale, error, and unavailable distinctly', () => {
    expect(createHomeSourceState('loading').status).toBe('loading');
    expect(createHomeSourceState('ready', { value: 1 }).status).toBe('ready');
    expect(createHomeSourceState('stale', { value: 1 }).stale).toBe(true);
    expect(createHomeSourceState('error', null, 'network').error).toBe('network');
    expect(createHomeSourceState('unavailable').status).toBe('unavailable');
    expect(createHomeSourceState('error').data).toBeNull();
  });
});
