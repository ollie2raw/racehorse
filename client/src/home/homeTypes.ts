import type { AppMode } from '../appRouteTypes';
import type { DailyPuzzleSlotIndex } from '../dailyPuzzle/types';

export type HomeSourceStatus = 'loading' | 'ready' | 'stale' | 'error' | 'unavailable';

export type HomeSourceKey =
  | 'dailySummary'
  | 'dailyFritz'
  | 'dailyPuzzle'
  | 'socialPresence'
  | 'socialActivity'
  | 'socialRivals'
  | 'tournament'
  | 'journey'
  | 'ranking'
  | 'runtime';

export type HomeSourceState<T> = {
  data: T | null;
  status: HomeSourceStatus;
  stale: boolean;
  error: string | null;
  fetchedAt: number | null;
};

export function createHomeSourceState<T>(
  status: HomeSourceStatus,
  data: T | null = null,
  error: string | null = null,
  fetchedAt: number | null = null,
): HomeSourceState<T> {
  return { data, status, stale: status === 'stale', error, fetchedAt };
}

export type HomeIdentity = {
  kind: 'guest' | 'authenticated';
  userId: string | null;
  displayName: string | null;
};

export type DailyAttemptState = 'unstarted' | 'started' | 'completed' | 'unknown';

export type HomeWeekDay = {
  dateKey: string;
  label: string;
  fritzCompleted: boolean;
  puzzleCompleted: boolean;
  complete: boolean;
  isToday: boolean;
  isFuture: boolean;
};

export type DailyFritzModel = {
  state: DailyAttemptState;
  outcome: 'win' | 'loss' | null;
  rank: number | null;
  currentGame: 1 | 2 | 3 | null;
  streak: number | null;
  runDate: string | null;
  completedAt?: string | null;
};

export type DailyPuzzleModel = {
  state: DailyAttemptState;
  score: number | null;
  runDate: string | null;
  nextAvailableSlotIndex: DailyPuzzleSlotIndex | null;
  completedAt?: string | null;
};

export type DailySummaryModel = {
  dateKey: string | null;
  week: HomeWeekDay[];
  weeklyCompletedCount: number | null;
  currentStreakCount: number | null;
  todayComplete: boolean | null;
  fritz: DailyFritzModel;
  puzzle: DailyPuzzleModel;
};

export type DailySummaryBaseModel = Omit<DailySummaryModel, 'fritz' | 'puzzle'>;

export type HomeFriendPresence = {
  id: string;
  userId: string;
  username: string;
  status: 'online' | 'in_game' | 'offline';
  currentMode: string | null;
};

export type HomeActivityItem = {
  id: string;
  userId: string;
  username: string;
  type: 'win' | 'loss' | 'streak' | 'tournament' | 'puzzle' | 'daily_fritz';
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type HomeRival = {
  userId: string;
  username: string;
  gamesPlayed: number;
  winsAgainst: number;
  lossesAgainst: number;
  rating: number | null;
};

export type HomeSocialModel = {
  friends: HomeFriendPresence[];
  activity: HomeActivityItem[];
  rivals: HomeRival[];
};

export type HomeTournamentModel = {
  upcomingCount: number;
  registeredTournamentIds: string[];
  activeTournamentId: string | null;
  phase: string | null;
  recoveryMatch: {
    matchId: string;
    tournamentId: string;
    round: 1 | 2 | 3;
    opponentId: string | null;
    opponentUsername: string | null;
    matchStatus: 'ready' | 'in_progress';
    readyDeadlineAt: string | null;
  } | null;
};

export type HomeJourneyModel = {
  activeChapterId: string | null;
  activeChapterTitle: string | null;
  completedNodes: number;
  totalNodes: number;
  totalCompleted: number;
  hasAnyProgress: boolean;
  lastVisitedNodeId: string | null;
  updatedAt: string | null;
};

export type HomeRankingModel = {
  rating: number | null;
  peakRating: number | null;
  globalRank: number | null;
  rankedGamesPlayed: number | null;
  currentWinStreak: number | null;
  provisional: boolean | null;
};

export type HomeRuntimeModel = {
  activeMatch: null;
  source: 'app-runtime-not-exposed';
};

export type HomeContinueItem = {
  type: 'daily_fritz' | 'daily_puzzle' | 'tournament' | 'journey' | 'review' | 'match';
  id: string;
  available: boolean;
};

export type HomePrimaryActionBase = {
  title: string;
  reason: string;
  cta: string;
  route: AppMode;
  priority: number;
  expiresAt: string | null;
};

export type HomePrimaryAction =
  | (HomePrimaryActionBase & { type: 'continue_tournament'; tournamentId: string; matchId: string })
  | (HomePrimaryActionBase & { type: 'continue_daily_fritz' })
  | (HomePrimaryActionBase & { type: 'continue_daily_puzzle' })
  | (HomePrimaryActionBase & { type: 'continue_lesson'; chapterId: string })
  | (HomePrimaryActionBase & { type: 'play_daily_fritz' })
  | (HomePrimaryActionBase & { type: 'play_daily_puzzle' })
  | (HomePrimaryActionBase & { type: 'challenge_online_rival'; rivalId: string })
  | (HomePrimaryActionBase & { type: 'play_recommended_mode' });

export type HomeMomentumLevel = 'cold' | 'warming_up' | 'active' | 'locked_in' | 'completed';

export type HomeMomentumReasonId =
  | 'daily_fritz_started'
  | 'daily_fritz_completed'
  | 'daily_puzzle_started'
  | 'daily_puzzle_completed'
  | 'daily_ritual_completed'
  | 'journey_progressed'
  | 'tournament_active'
  | 'social_activity';

export type HomeMomentumReason = {
  id: HomeMomentumReasonId;
  label: string;
  points: number;
};

export type HomeMomentumOpportunity = {
  id: 'daily_fritz' | 'daily_puzzle' | 'journey' | 'tournament_match' | 'challenge_rival';
  label: string;
};

export type HomeMomentumCompletedItem = {
  id: 'daily_fritz' | 'daily_puzzle' | 'daily_ritual' | 'journey' | 'tournament' | 'social_activity';
  label: string;
};

export type HomeMomentum = {
  level: HomeMomentumLevel;
  score: number;
  reasons: HomeMomentumReason[];
  missingOpportunities: HomeMomentumOpportunity[];
  completedToday: HomeMomentumCompletedItem[];
  progressPercent: number;
};

export type HomeWelcomeItemType =
  | 'daily_fritz_result'
  | 'daily_puzzle_result'
  | 'friend_online'
  | 'tournament_ready'
  | 'journey_progress'
  | 'weekly_goal';

export type HomeWelcomeIcon = 'trophy' | 'bot' | 'puzzle' | 'user' | 'book' | 'flame' | 'target';

export type HomeWelcomeItem = {
  id: string;
  type: HomeWelcomeItemType;
  priority: number;
  title: string;
  subtitle: string;
  icon: HomeWelcomeIcon;
  route: AppMode;
  expiresAt: string | null;
};

export type HomeWelcomeBack = {
  summaryItems: HomeWelcomeItem[];
  headline: string | null;
  priority: number;
  hasMeaningfulChanges: boolean;
  generatedAt: number;
};

export type HomeActivityTimelineEvent =
  | {
      id: string;
      type: 'daily_fritz_started';
      occurredAt: string | null;
      priority: number;
      source: 'daily_fritz';
      route: AppMode;
      status: 'active';
      payload: { currentGame: number | null; runDate: string | null };
    }
  | {
      id: string;
      type: 'daily_fritz_completed';
      occurredAt: string | null;
      priority: number;
      source: 'daily_fritz';
      route: AppMode;
      status: 'completed';
      payload: { outcome: 'win' | 'loss' | null; rank: number | null; runDate: string | null };
    }
  | {
      id: string;
      type: 'daily_puzzle_started';
      occurredAt: string | null;
      priority: number;
      source: 'daily_puzzle';
      route: AppMode;
      status: 'active';
      payload: { score: number | null; nextAvailableSlotIndex: number | null; runDate: string | null };
    }
  | {
      id: string;
      type: 'daily_puzzle_completed';
      occurredAt: string | null;
      priority: number;
      source: 'daily_puzzle';
      route: AppMode;
      status: 'completed';
      payload: { score: number | null; runDate: string | null };
    }
  | {
      id: string;
      type: 'journey_progressed';
      occurredAt: string | null;
      priority: number;
      source: 'journey';
      route: AppMode;
      status: 'active' | 'completed';
      payload: { chapterId: string | null; chapterTitle: string | null; completedNodes: number; totalNodes: number };
    }
  | {
      id: string;
      type: 'tournament_match_ready' | 'tournament_match_in_progress';
      occurredAt: string | null;
      priority: number;
      source: 'tournament';
      route: AppMode;
      status: 'pending';
      expiresAt: string | null;
      payload: { tournamentId: string; matchId: string; round: 1 | 2 | 3; opponentUsername: string | null; matchStatus: 'ready' | 'in_progress' };
    }
  | {
      id: string;
      type: 'friend_online';
      occurredAt: string | null;
      priority: number;
      source: 'social_presence';
      route: AppMode;
      status: 'available';
      payload: { userId: string; username: string; currentMode: string | null };
    }
  | {
      id: string;
      type: 'player_social_activity';
      occurredAt: string;
      priority: number;
      source: 'social_activity';
      route: AppMode;
      status: 'completed';
      payload: { activityType: string };
    }
  | {
      id: string;
      type: 'weekly_daily_goal_completed';
      occurredAt: string | null;
      priority: number;
      source: 'daily_summary';
      route: AppMode;
      status: 'completed';
      payload: { dateKey: string | null; completedDays: number };
    };

export type HomeActivityTimeline = {
  events: HomeActivityTimelineEvent[];
  generatedAt: number;
  latestOccurredAt: string | null;
  sourceCoverage: Record<HomeSourceKey, HomeSourceStatus>;
};

export type HomePersonalizationProfile =
  | 'new_player'
  | 'learning_player'
  | 'daily_player'
  | 'competitive_player'
  | 'social_player'
  | 'mixed_player'
  | 'returning_player';

export type HomePersonalizationPrimaryMode =
  | 'journey'
  | 'daily_fritz'
  | 'daily_puzzle'
  | 'multiplayer'
  | 'tournament'
  | 'friends';

export type HomePersonalization = {
  profile: HomePersonalizationProfile;
  confidence: number;
  primaryMode: HomePersonalizationPrimaryMode;
  secondaryModes: AppMode[];
  emphasis: {
    daily: number;
    learning: number;
    competitive: number;
    social: number;
  };
  reasoning: string[];
};

export type HomeCommandCenterModel = {
  identity: HomeIdentity;
  daily: {
    summary: HomeSourceState<DailySummaryBaseModel>;
    fritz: HomeSourceState<DailyFritzModel>;
    puzzle: HomeSourceState<DailyPuzzleModel>;
  };
  social: {
    presence: HomeSourceState<HomeFriendPresence[]>;
    activity: HomeSourceState<HomeActivityItem[]>;
    rivals: HomeSourceState<HomeRival[]>;
  };
  tournament: HomeSourceState<HomeTournamentModel>;
  journey: HomeSourceState<HomeJourneyModel>;
  stats: HomeSourceState<HomeRankingModel>;
  runtime: HomeSourceState<HomeRuntimeModel>;
  continueItems: HomeContinueItem[];
  primaryAction: HomePrimaryAction | null;
  momentum: HomeMomentum | null;
  welcomeBack: HomeWelcomeBack | null;
  activityTimeline: HomeActivityTimeline | null;
  personalization: HomePersonalization | null;
  freshness: {
    generatedAt: number;
    stale: boolean;
  };
  sourceStatus: Record<HomeSourceKey, HomeSourceStatus>;
};
