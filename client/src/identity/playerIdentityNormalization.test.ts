import { describe, expect, it } from 'vitest';
import { applyPublicProfile, createEmptyPlayerIdentityModel, deriveWinRate, normalizeRecentForm } from './playerIdentityNormalization';
import { applyPersonalInsights } from './playerIdentityNormalization';

const publicProfile = {
  ok: true, userId: 'u1', username: 'Maya', glicko_rating: 1200, peak_rating: 1250, provisional: false,
  ranked_games_played: 10, global_rank: 4, wins: 7, losses: 3, win_rate: 70, puzzles_completed: 8,
  best_puzzle_score: 95, fritz_wins: 4, fritz_losses: 2, best_streak: 5, is_self: false,
  is_friend: true, has_pending_request: false, h2h: { wins: 2, losses: 1 },
  presence: { status: 'online' as const, current_mode: null },
  recent_matches: [
    { opponent_username: 'Alex', result: 'win' as const, score: 100, opponent_score: 80, mode: 'online', played_at: '2026-07-10T12:00:00Z' },
    { opponent_username: 'Lee', result: 'loss' as const, score: null, opponent_score: null, mode: 'online', played_at: '2026-07-09T12:00:00Z' },
  ],
};

describe('player identity normalization', () => {
  it('derives valid win rates and rejects invalid records', () => {
    expect(deriveWinRate(7, 3)).toBe(70);
    expect(deriveWinRate(0, 0)).toBeNull();
    expect(deriveWinRate(-1, 2)).toBeNull();
  });

  it('normalizes public identity, privacy-safe H2H, presence, and recent form', () => {
    const model = applyPublicProfile(createEmptyPlayerIdentityModel(100), publicProfile, 'viewer');
    expect(model.subject).toMatchObject({ userId: 'u1', username: 'Maya', presence: 'online', isCurrentUser: false, friendshipStatus: 'friends' });
    expect(model.competitive.winRate).toBe(70);
    expect(model.competitive.recentForm).toEqual(['win', 'loss']);
    expect(model.rivalry.currentViewerHeadToHead).toEqual({ wins: 2, losses: 1 });
    expect(model.sourceStatus.public_profile).toBe('ready');
  });

  it('preserves nulls instead of inventing zero values', () => {
    const model = applyPublicProfile(createEmptyPlayerIdentityModel(100), { ...publicProfile, global_rank: null, best_puzzle_score: null, h2h: null, recent_matches: [], fritz_wins: 0, fritz_losses: 0 }, null);
    expect(model.competitive.globalRank).toBeNull();
    expect(model.puzzle.bestScore).toBeNull();
    expect(model.rivalry.currentViewerHeadToHead).toBeNull();
    expect(model.fritz.winRate).toBeNull();
    expect(normalizeRecentForm(null)).toEqual([]);
  });

  it('preserves Stats score semantics in the identity model', () => {
    const insights = {
      base: { onlineGamesPlayed: 4, wins: 3, losses: 1, avgMoveQuality: null, longestWinStreak: 3, winRate: 75, currentWinStreak: 2, gamesThisWeek: 1, ghostRating: null, ghostGamesThisWeek: 0, ghostRatingChangeThisWeek: 0, ghostBestWinMarginThisWeek: null },
      rankingProfile: { glicko_rating: 1400, glicko_rd: 80, provisional: false, ranked_games_played: 4, peak_rating: 1450, rank: null, currentWinStreak: 2 },
      fritz: { gamesPlayed: 2, wins: 1, losses: 1, winRate: 50, currentStreak: 0, bestStreak: 1, bestWinMargin: null, averagePointsScored: 87.5, highestScore: 100, gamesThisWeek: 0, ratingChangeThisWeek: 0, bestWinMarginThisWeek: null, tierRecords: { rookie: { wins: 1, losses: 0, gamesPlayed: 1 }, standard: { wins: 0, losses: 1, gamesPlayed: 1 }, elite: { wins: 0, losses: 0, gamesPlayed: 0 }, master: { wins: 0, losses: 0, gamesPlayed: 0 } } },
      ghost: { rating: 900, gamesPlayed: 2, wins: 1, losses: 1, winRate: 50, bestWinMargin: 12, gamesThisWeek: 0, ratingChangeThisWeek: 0, bestWinMarginThisWeek: null },
      puzzle: { currentStreak: 2, completions: 4, completionsThisWeek: 1, bestScoreToday: 61, bestScoreEver: 95, perfectDays: 1 },
    };
    const model = applyPersonalInsights(createEmptyPlayerIdentityModel(100), insights);
    expect(model.fritz.averageScore).toBe(87.5);
    expect(model.puzzle.bestScoreToday).toBe(61);
    expect(model.puzzle.bestScoreEver).toBe(95);
    expect(model.puzzle.bestScore).toBe(95);
  });
});
