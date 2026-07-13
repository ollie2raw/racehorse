import type { HomeSourceStatus } from '../home/homeTypes';

export type PlayerIdentitySourceKey =
  | 'public_profile'
  | 'personal_insights'
  | 'journey'
  | 'rivals';

export type PlayerIdentityMilestone =
  | { type: 'rating_peak'; value: number; achieved: boolean }
  | { type: 'best_streak'; value: number; achieved: boolean }
  | { type: 'ranked_games'; value: number; achieved: boolean }
  | { type: 'puzzle_best'; value: number; achieved: boolean }
  | { type: 'journey_progress'; completed: number; total: number; achieved: boolean };

export type PlayerIdentitySignalDomain = 'competitive' | 'fritz' | 'puzzle' | 'learning' | 'rivalry';
export type PlayerIdentitySignalStrength = 'supporting' | 'notable' | 'signature';
export type PlayerIdentitySignalType =
  | 'competitive_at_peak'
  | 'competitive_ranked_games'
  | 'competitive_best_streak'
  | 'competitive_current_streak'
  | 'competitive_recent_form'
  | 'fritz_most_played_difficulty'
  | 'fritz_best_record'
  | 'fritz_all_difficulties'
  | 'fritz_overall_record'
  | 'fritz_average_score'
  | 'fritz_best_score'
  | 'puzzle_completions'
  | 'puzzle_current_streak'
  | 'puzzle_best_today'
  | 'puzzle_best_ever'
  | 'puzzle_perfect_days'
  | 'learning_journey_progress'
  | 'learning_active_chapter'
  | 'rivalry_viewer_head_to_head'
  | 'rivalry_most_played';

export type PlayerIdentitySignalDetails =
  | { kind: 'rating'; current: number; peak: number }
  | { kind: 'count'; count: number }
  | { kind: 'streak'; games: number }
  | { kind: 'form'; wins: number; losses: number; games: number }
  | { kind: 'record'; wins: number; losses: number; games: number; difficulty?: string }
  | { kind: 'score'; score: number; scope: 'today' | 'all_time' | 'average' }
  | { kind: 'journey'; completed: number; total: number }
  | { kind: 'chapter'; title: string }
  | { kind: 'rival'; userId: string | null; username: string; games: number };

export type PlayerIdentitySignal = {
  id: string;
  type: PlayerIdentitySignalType;
  domain: PlayerIdentitySignalDomain;
  strength: PlayerIdentitySignalStrength;
  priority: number;
  label: string;
  evidence: string;
  value: number | string | null;
  sampleSize: number | null;
  visibility: 'public' | 'self_only';
  details: PlayerIdentitySignalDetails;
};

export type PlayerIdentitySignals = {
  all: PlayerIdentitySignal[];
  publicSignals: PlayerIdentitySignal[];
  selfSignals: PlayerIdentitySignal[];
  featured: PlayerIdentitySignal[];
};

export type PlayerRivalSummary = {
  userId: string;
  username: string;
  gamesPlayed: number;
  winsAgainst: number;
  lossesAgainst: number;
  rating: number | null;
};

export type PlayerHeadToHeadSummary = {
  wins: number;
  losses: number;
};

export type PlayerRecentMatch = {
  opponentUsername: string;
  result: 'win' | 'loss';
  score: number | null;
  opponentScore: number | null;
  mode: string;
  playedAt: string;
};

export type PlayerIdentityModel = {
  subject: {
    userId: string | null;
    username: string | null;
    avatarUrl: string | null;
    presence: 'online' | 'offline' | 'playing' | 'unknown';
    currentMode: string | null;
    isCurrentUser: boolean;
    friendshipStatus: 'self' | 'friends' | 'request_sent' | 'request_received' | 'none' | 'unknown';
  };
  competitive: {
    rating: number | null;
    peakRating: number | null;
    globalRank: number | null;
    provisional: boolean | null;
    rankedGames: number | null;
    wins: number | null;
    losses: number | null;
    winRate: number | null;
    currentStreak: number | null;
    bestStreak: number | null;
    recentForm: Array<'win' | 'loss'>;
    recentMatches: PlayerRecentMatch[];
  };
  fritz: {
    totalWins: number | null;
    totalLosses: number | null;
    winRate: number | null;
    averageScore: number | null;
    bestScore: number | null;
    difficultyRecords: Array<{ difficulty: string; wins: number; losses: number; games: number }>;
  };
  puzzle: {
    completions: number | null;
    currentStreak: number | null;
    bestScoreToday: number | null;
    bestScoreEver: number | null;
    bestScore: number | null;
    perfectDays: number | null;
  };
  dailyFritz: {
    completions: number | null;
    wins: number | null;
    bestFinish: string | null;
    bestMargin: number | null;
  };
  learning: {
    completedNodes: number | null;
    totalNodes: number | null;
    activeChapterId: string | null;
    activeChapterTitle: string | null;
  };
  rivalry: {
    closestRival: PlayerRivalSummary | null;
    currentViewerHeadToHead: PlayerHeadToHeadSummary | null;
  };
  ghost: {
    rating: number | null;
    gamesPlayed: number | null;
    wins: number | null;
    losses: number | null;
    winRate: number | null;
    bestWinMargin: number | null;
  };
  milestones: PlayerIdentityMilestone[];
  identitySignals: PlayerIdentitySignals;
  sourceStatus: Record<PlayerIdentitySourceKey, HomeSourceStatus>;
  freshness: { generatedAt: number; stale: boolean };
};

export type PlayerIdentityRequest = {
  subjectUserId: string | null;
  subjectUsername: string | null;
  currentUserId: string | null;
};

export type PlayerIdentityModelState = {
  model: PlayerIdentityModel | null;
  loading: boolean;
  error: string | null;
};
