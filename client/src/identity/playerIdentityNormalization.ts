import type { PersonalStatsInsights } from '../stats/statsTypes';
import type { PublicProfile } from '../social/socialApi';
import type { HomeJourneyModel, HomeSourceStatus } from '../home/homeTypes';
import type { PlayerIdentityModel, PlayerRivalSummary } from './playerIdentityTypes';

const SOURCE_KEYS = ['public_profile', 'personal_insights', 'journey', 'rivals'] as const;

function numberOrNull(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

function nonNegativeOrNull(value: unknown): number | null {
  const number = numberOrNull(value);
  return number != null && number >= 0 ? number : null;
}

export function deriveWinRate(wins: number | null, losses: number | null): number | null {
  if (wins == null || losses == null || wins < 0 || losses < 0 || wins + losses === 0) return null;
  return Math.round((wins / (wins + losses)) * 1000) / 10;
}

export function normalizeRecentForm(matches: PublicProfile['recent_matches'] | null | undefined): Array<'win' | 'loss'> {
  if (!Array.isArray(matches)) return [];
  return matches
    .filter((match) => match.result === 'win' || match.result === 'loss')
    .map((match) => match.result);
}

export function createEmptyPlayerIdentityModel(generatedAt = Date.now()): PlayerIdentityModel {
  const sourceStatus = Object.fromEntries(SOURCE_KEYS.map((key) => [key, 'unavailable' as const])) as PlayerIdentityModel['sourceStatus'];
  return {
    subject: { userId: null, username: null, avatarUrl: null, presence: 'unknown', currentMode: null, isCurrentUser: false, friendshipStatus: 'unknown' },
    competitive: { rating: null, peakRating: null, globalRank: null, provisional: null, rankedGames: null, wins: null, losses: null, winRate: null, currentStreak: null, bestStreak: null, recentForm: [], recentMatches: [] },
    fritz: { totalWins: null, totalLosses: null, winRate: null, averageScore: null, bestScore: null, difficultyRecords: [] },
    puzzle: { completions: null, currentStreak: null, bestScoreToday: null, bestScoreEver: null, bestScore: null, perfectDays: null },
    dailyFritz: { completions: null, wins: null, bestFinish: null, bestMargin: null },
    learning: { completedNodes: null, totalNodes: null, activeChapterId: null, activeChapterTitle: null },
    rivalry: { closestRival: null, currentViewerHeadToHead: null },
    ghost: { rating: null, gamesPlayed: null, wins: null, losses: null, winRate: null, bestWinMargin: null },
    milestones: [],
    identitySignals: { all: [], publicSignals: [], selfSignals: [], featured: [] },
    sourceStatus,
    freshness: { generatedAt, stale: false },
  };
}

function presence(value: PublicProfile['presence']['status'] | undefined): PlayerIdentityModel['subject']['presence'] {
  if (value === 'online') return 'online';
  if (value === 'in_game') return 'playing';
  if (value === 'offline') return 'offline';
  return 'unknown';
}

function friendship(profile: PublicProfile): PlayerIdentityModel['subject']['friendshipStatus'] {
  if (profile.is_self) return 'self';
  if (profile.is_friend) return 'friends';
  if (profile.has_pending_request) return 'unknown';
  return 'none';
}

export function applyPublicProfile(
  model: PlayerIdentityModel,
  profile: PublicProfile,
  currentUserId: string | null,
): PlayerIdentityModel {
  const wins = nonNegativeOrNull(profile.wins);
  const losses = nonNegativeOrNull(profile.losses);
  return {
    ...model,
    subject: {
      ...model.subject,
      userId: profile.userId ?? null,
      username: profile.username ?? null,
      presence: presence(profile.presence?.status),
      currentMode: profile.presence?.current_mode ?? null,
      isCurrentUser: profile.is_self || profile.userId === currentUserId,
      friendshipStatus: friendship(profile),
    },
    competitive: {
      ...model.competitive,
      rating: numberOrNull(profile.glicko_rating),
      peakRating: numberOrNull(profile.peak_rating),
      globalRank: nonNegativeOrNull(profile.global_rank),
      provisional: typeof profile.provisional === 'boolean' ? profile.provisional : null,
      rankedGames: nonNegativeOrNull(profile.ranked_games_played),
      wins,
      losses,
      winRate: deriveWinRate(wins, losses),
      bestStreak: nonNegativeOrNull(profile.best_streak),
      recentForm: normalizeRecentForm(profile.recent_matches),
      recentMatches: (profile.recent_matches ?? []).map((match) => ({ opponentUsername: match.opponent_username, result: match.result, score: numberOrNull(match.score), opponentScore: numberOrNull(match.opponent_score), mode: match.mode, playedAt: match.played_at })),
    },
    fritz: {
      ...model.fritz,
      totalWins: nonNegativeOrNull(profile.fritz_wins),
      totalLosses: nonNegativeOrNull(profile.fritz_losses),
      winRate: deriveWinRate(nonNegativeOrNull(profile.fritz_wins), nonNegativeOrNull(profile.fritz_losses)),
      averageScore: null,
      bestScore: null,
    },
    puzzle: {
      ...model.puzzle,
      completions: nonNegativeOrNull(profile.puzzles_completed),
      bestScoreToday: null,
      bestScoreEver: numberOrNull(profile.best_puzzle_score),
      bestScore: numberOrNull(profile.best_puzzle_score),
    },
    rivalry: { ...model.rivalry, currentViewerHeadToHead: profile.h2h ? { wins: profile.h2h.wins, losses: profile.h2h.losses } : null },
    sourceStatus: { ...model.sourceStatus, public_profile: 'ready' },
  };
}

export function applyPersonalInsights(model: PlayerIdentityModel, insights: PersonalStatsInsights): PlayerIdentityModel {
  const base = insights.base;
  const ranking = insights.rankingProfile;
  const fritz = insights.fritz;
  const puzzle = insights.puzzle;
  const ghost = insights.ghost;
  return {
    ...model,
    competitive: {
      ...model.competitive,
      rating: numberOrNull(ranking?.glicko_rating) ?? model.competitive.rating,
      peakRating: numberOrNull(ranking?.peak_rating) ?? model.competitive.peakRating,
      globalRank: nonNegativeOrNull(ranking?.rank) ?? model.competitive.globalRank,
      provisional: typeof ranking?.provisional === 'boolean' ? ranking.provisional : model.competitive.provisional,
      rankedGames: nonNegativeOrNull(ranking?.ranked_games_played) ?? nonNegativeOrNull(base.onlineGamesPlayed),
      wins: nonNegativeOrNull(base.wins),
      losses: nonNegativeOrNull(base.losses),
      winRate: deriveWinRate(nonNegativeOrNull(base.wins), nonNegativeOrNull(base.losses)),
      currentStreak: nonNegativeOrNull(ranking?.currentWinStreak) ?? nonNegativeOrNull(base.currentWinStreak),
      bestStreak: nonNegativeOrNull(base.longestWinStreak),
    },
    fritz: {
      totalWins: nonNegativeOrNull(fritz.wins),
      totalLosses: nonNegativeOrNull(fritz.losses),
      winRate: deriveWinRate(nonNegativeOrNull(fritz.wins), nonNegativeOrNull(fritz.losses)),
      averageScore: numberOrNull(fritz.averagePointsScored),
      bestScore: numberOrNull(fritz.highestScore),
      difficultyRecords: Object.entries(fritz.tierRecords).map(([difficulty, record]) => ({ difficulty, wins: record.wins, losses: record.losses, games: record.gamesPlayed })),
    },
    puzzle: {
      completions: nonNegativeOrNull(puzzle.completions),
      currentStreak: nonNegativeOrNull(puzzle.currentStreak),
      bestScoreToday: numberOrNull(puzzle.bestScoreToday),
      bestScoreEver: numberOrNull(puzzle.bestScoreEver),
      bestScore: numberOrNull(puzzle.bestScoreEver),
      perfectDays: nonNegativeOrNull(puzzle.perfectDays),
    },
    ghost: {
      rating: numberOrNull(ghost.rating),
      gamesPlayed: nonNegativeOrNull(ghost.gamesPlayed),
      wins: nonNegativeOrNull(ghost.wins),
      losses: nonNegativeOrNull(ghost.losses),
      winRate: deriveWinRate(nonNegativeOrNull(ghost.wins), nonNegativeOrNull(ghost.losses)),
      bestWinMargin: numberOrNull(ghost.bestWinMargin),
    },
    sourceStatus: { ...model.sourceStatus, personal_insights: 'ready' },
  };
}

export function applyJourney(model: PlayerIdentityModel, journey: HomeJourneyModel): PlayerIdentityModel {
  return {
    ...model,
    learning: { completedNodes: journey.completedNodes, totalNodes: journey.totalNodes, activeChapterId: journey.activeChapterId, activeChapterTitle: journey.activeChapterTitle },
    sourceStatus: { ...model.sourceStatus, journey: 'ready' },
  };
}

export function applyRivals(model: PlayerIdentityModel, rivals: PlayerRivalSummary[]): PlayerIdentityModel {
  const closestRival = [...rivals].sort((a, b) => b.gamesPlayed - a.gamesPlayed || a.userId.localeCompare(b.userId))[0] ?? null;
  return { ...model, rivalry: { ...model.rivalry, closestRival }, sourceStatus: { ...model.sourceStatus, rivals: 'ready' } };
}

export function setIdentitySourceStatus(model: PlayerIdentityModel, key: keyof PlayerIdentityModel['sourceStatus'], status: HomeSourceStatus): PlayerIdentityModel {
  return { ...model, sourceStatus: { ...model.sourceStatus, [key]: status } };
}
