export type MatchMode = 'bot' | 'online' | 'practice';

export interface RecordMatchInput {
  mode: MatchMode;
  opponentType: 'bot' | 'online' | 'guest';
  winnerUserId: string | null;
  loserUserId: string | null;
  winnerScore: number | null;
  loserScore: number | null;
  moveCount: number | null;
  avgMoveQuality?: number | null;
  roomCode?: string | null;
  metadata?: Record<string, unknown>;
}

export interface StatsSummary {
  onlineGamesPlayed: number;
  wins: number;
  losses: number;
  avgMoveQuality: number | null;
  longestWinStreak: number;
  winRate: number;
  currentWinStreak: number;
  gamesThisWeek: number;
  ghostRating: number | null;
  ghostGamesThisWeek: number;
  ghostRatingChangeThisWeek: number;
  ghostBestWinMarginThisWeek: number | null;
}

export type FritzTierKey = 'rookie' | 'standard' | 'elite' | 'master';

export interface FritzTierRecord {
  wins: number;
  losses: number;
  gamesPlayed: number;
}

export interface FritzStatsSummary {
  gamesPlayed: number;
  wins: number;
  losses: number;
  winRate: number;
  currentStreak: number;
  bestStreak: number;
  bestWinMargin: number | null;
  averagePointsScored: number | null;
  highestScore: number | null;
  gamesThisWeek: number;
  ratingChangeThisWeek: number;
  bestWinMarginThisWeek: number | null;
  tierRecords: Record<FritzTierKey, FritzTierRecord>;
}

export interface GhostStatsSummary {
  rating: number | null;
  gamesPlayed: number;
  wins: number;
  losses: number;
  winRate: number;
  bestWinMargin: number | null;
  gamesThisWeek: number;
  ratingChangeThisWeek: number;
  bestWinMarginThisWeek: number | null;
}

export interface PuzzleStatsSummary {
  currentStreak: number;
  completions: number;
  completionsThisWeek: number;
  bestScoreToday: number | null;
  bestScoreEver: number | null;
  perfectDays: number;
}

export interface RankingProfile {
  glicko_rating: number;
  glicko_rd: number;
  provisional: boolean;
  ranked_games_played: number;
  peak_rating: number;
  rank: number | null;
  /** Consecutive online wins from match history (server-computed). */
  currentWinStreak: number;
}

export interface PersonalStatsInsights {
  base: StatsSummary;
  rankingProfile: RankingProfile | null;
  fritz: FritzStatsSummary;
  ghost: GhostStatsSummary;
  puzzle: PuzzleStatsSummary;
}

export interface WeeklyRecap {
  weekLabel: string;
  fritz: Pick<FritzStatsSummary, 'gamesThisWeek' | 'ratingChangeThisWeek' | 'bestWinMarginThisWeek'>;
  ghost: Pick<GhostStatsSummary, 'gamesThisWeek' | 'ratingChangeThisWeek' | 'bestWinMarginThisWeek'>;
  puzzle: Pick<PuzzleStatsSummary, 'completionsThisWeek'> & { bestScoreToday: number | null };
  multiplayer: Pick<StatsSummary, 'gamesThisWeek' | 'wins' | 'losses'>;
}