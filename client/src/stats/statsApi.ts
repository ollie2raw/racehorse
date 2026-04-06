import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { fetchRatingHistory } from '../ranking/api';
import {
  FRITZ_ELITE_ID,
  FRITZ_MASTER_ID,
  FRITZ_ROOKIE_ID,
  FRITZ_STANDARD_ID,
} from '../bot/fritzConfig';

const DEFAULT_SERVER_URL = import.meta.env.VITE_SERVER_URL || '';
const DEFAULT_SERVER_ORIGIN = 'http://localhost:3001';

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

export async function recordMatchResult(
  input: RecordMatchInput,
): Promise<{ error: string | null }> {
  if (!supabase) return { error: null };

  const basePayload: Record<string, unknown> = {
    mode: input.mode,
    room_code: input.roomCode ?? null,
    winner_user_id: input.winnerUserId,
    loser_user_id: input.loserUserId,
    winner_score: input.winnerScore,
    loser_score: input.loserScore,
    move_count: input.moveCount,
    metadata: {
      opponentType: input.opponentType,
      ...(input.metadata ?? {}),
    },
  };
  const includeMoveQuality =
    typeof input.avgMoveQuality === 'number' &&
    Number.isFinite(input.avgMoveQuality) &&
    input.avgMoveQuality > 0;
  const payload: Record<string, unknown> = includeMoveQuality
    ? { ...basePayload, avg_move_quality: input.avgMoveQuality }
    : basePayload;

  let { error } = await supabase.from('matches').insert(payload);

  // Backward-compatible retry for deployments where avg_move_quality column is not added yet.
  if (
    error &&
    includeMoveQuality &&
    (error.message.toLowerCase().includes('avg_move_quality') ||
      error.message.toLowerCase().includes('column') ||
      String((error as { code?: string }).code ?? '') === '42703')
  ) {
    const retry = await supabase.from('matches').insert(basePayload);
    error = retry.error;
  }

  return { error: error?.message ?? null };
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

type MatchSummaryRow = {
  winner_user_id: string | null;
  loser_user_id: string | null;
  mode: string | null;
  avg_move_quality?: number | null;
  created_at?: string | null;
};

type GhostGameSummaryRow = {
  final_score: number | null;
  opponent_score: number | null;
  played_at?: string | null;
};

type PuzzleCompletionRow = {
  puzzle_date: string | null;
  current_streak: number | null;
  score: number | null;
  perfect: boolean | null;
  updated_at?: string | null;
};

type PuzzleScoreRow = {
  puzzle_date: string | null;
  best_score: number | null;
  updated_at?: string | null;
};

function getWeekStart(now = new Date()): Date {
  const day = now.getDay();
  const diffToMonday = (day + 6) % 7;
  const weekStart = new Date(now);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(now.getDate() - diffToMonday);
  return weekStart;
}

function toLocalDateKey(value: Date): string {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, '0');
  const day = `${value.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function emptyTierRecord(): FritzTierRecord {
  return { wins: 0, losses: 0, gamesPlayed: 0 };
}

function tierFromOpponentId(opponentId: string): FritzTierKey {
  if (opponentId === FRITZ_ROOKIE_ID) return 'rookie';
  if (opponentId === FRITZ_STANDARD_ID) return 'standard';
  if (opponentId === FRITZ_MASTER_ID) return 'master';
  return 'elite';
}

function formatWeekLabel(weekStart: Date): string {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  return `Week of ${weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${weekEnd.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

function deriveFritzSummary(
  games: Array<{
    played_at: string;
    opponent_id: string;
    player_score: number;
    opponent_score: number;
    delta: number;
  }>,
  weekStart: Date,
): FritzStatsSummary {
  const tierRecords: Record<FritzTierKey, FritzTierRecord> = {
    rookie: emptyTierRecord(),
    standard: emptyTierRecord(),
    elite: emptyTierRecord(),
    master: emptyTierRecord(),
  };

  let wins = 0;
  let losses = 0;
  let currentStreak = 0;
  let bestStreak = 0;
  let streakTracker = 0;
  let bestWinMargin: number | null = null;
  let highestScore: number | null = null;
  let gamesThisWeek = 0;
  let ratingChangeThisWeek = 0;
  let bestWinMarginThisWeek: number | null = null;

  for (const game of games) {
    const tier = tierFromOpponentId(game.opponent_id);
    const playerScore = Number(game.player_score ?? 0);
    const margin = Number(game.player_score ?? 0) - Number(game.opponent_score ?? 0);
    highestScore = highestScore == null ? playerScore : Math.max(highestScore, playerScore);
    tierRecords[tier].gamesPlayed += 1;
    if (margin > 0) {
      wins += 1;
      tierRecords[tier].wins += 1;
      streakTracker += 1;
      bestStreak = Math.max(bestStreak, streakTracker);
      bestWinMargin = bestWinMargin == null ? margin : Math.max(bestWinMargin, margin);
    } else {
      losses += 1;
      tierRecords[tier].losses += 1;
      streakTracker = 0;
    }

    const playedMs = new Date(game.played_at).getTime();
    if (Number.isFinite(playedMs) && playedMs >= weekStart.getTime()) {
      gamesThisWeek += 1;
      ratingChangeThisWeek += Number(game.delta ?? 0);
      if (margin > 0) {
        bestWinMarginThisWeek =
          bestWinMarginThisWeek == null ? margin : Math.max(bestWinMarginThisWeek, margin);
      }
    }
  }

  for (let i = games.length - 1; i >= 0; i -= 1) {
    const margin = Number(games[i].player_score ?? 0) - Number(games[i].opponent_score ?? 0);
    if (margin > 0) {
      currentStreak += 1;
      continue;
    }
    break;
  }

  const gamesPlayed = wins + losses;
  const winRate = gamesPlayed > 0 ? Math.round((wins / gamesPlayed) * 1000) / 10 : 0;

  return {
    gamesPlayed,
    wins,
    losses,
    winRate,
    currentStreak,
    bestStreak,
    bestWinMargin,
    highestScore,
    gamesThisWeek,
    ratingChangeThisWeek,
    bestWinMarginThisWeek,
    tierRecords,
  };
}

function deriveGhostSummary(
  rows: GhostGameSummaryRow[],
  rating: number | null,
  weekStart: Date,
): GhostStatsSummary {
  let wins = 0;
  let losses = 0;
  let bestWinMargin: number | null = null;
  let gamesThisWeek = 0;
  let ratingChangeThisWeek = 0;
  let bestWinMarginThisWeek: number | null = null;

  for (const row of rows) {
    const finalScore = Number(row.final_score ?? 0);
    const opponentScore = Number(row.opponent_score ?? 0);
    const margin = finalScore - opponentScore;
    if (margin > 0) {
      wins += 1;
      bestWinMargin = bestWinMargin == null ? margin : Math.max(bestWinMargin, margin);
    }
    if (margin < 0) losses += 1;

    const playedMs = new Date(row.played_at ?? 0).getTime();
    if (Number.isFinite(playedMs) && playedMs >= weekStart.getTime()) {
      gamesThisWeek += 1;
      if (margin > 0) {
        bestWinMarginThisWeek =
          bestWinMarginThisWeek == null ? margin : Math.max(bestWinMarginThisWeek, margin);
      }
      if (margin > 0) ratingChangeThisWeek += 16;
      if (margin < 0) ratingChangeThisWeek -= 16;
    }
  }

  const gamesPlayed = rows.length;
  const winRate = gamesPlayed > 0 ? Math.round((wins / gamesPlayed) * 1000) / 10 : 0;

  return {
    rating,
    gamesPlayed,
    wins,
    losses,
    winRate,
    bestWinMargin,
    gamesThisWeek,
    ratingChangeThisWeek,
    bestWinMarginThisWeek,
  };
}

function derivePuzzleSummary(
  completionRows: PuzzleCompletionRow[],
  scoreRows: PuzzleScoreRow[],
  weekStart: Date,
): PuzzleStatsSummary {
  const todayKey = toLocalDateKey(new Date());
  const completions = completionRows.length;
  const perfectDays = completionRows.filter((row) => Boolean(row.perfect)).length;
  const currentStreak =
    [...completionRows]
      .sort((a, b) => String(b.puzzle_date ?? '').localeCompare(String(a.puzzle_date ?? '')))[0]
      ?.current_streak ?? 0;
  const completionsThisWeek = completionRows.filter((row) => {
    const value = row.updated_at ?? row.puzzle_date ?? '';
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) && ms >= weekStart.getTime();
  }).length;
  const bestScoreToday =
    scoreRows.find((row) => row.puzzle_date === todayKey)?.best_score == null
      ? null
      : Number(scoreRows.find((row) => row.puzzle_date === todayKey)?.best_score ?? 0);
  const bestScoreEver =
    scoreRows.length > 0
      ? Math.max(...scoreRows.map((row) => Number(row.best_score ?? 0)))
      : null;

  return {
    currentStreak: Number(currentStreak ?? 0),
    completions,
    completionsThisWeek,
    bestScoreToday,
    bestScoreEver,
    perfectDays,
  };
}

function buildStatsSummary(userId: string, rows: MatchSummaryRow[]): StatsSummary {
  const onlineRows = rows
    .filter((row) => row.mode === 'online')
    .sort((a, b) => new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime());

  const wins = onlineRows.filter((row) => row.winner_user_id === userId).length;
  const losses = onlineRows.filter((row) => row.loser_user_id === userId).length;

  let longestWinStreak = 0;
  let streakTracker = 0;
  for (const match of onlineRows) {
    if (match.winner_user_id === userId) {
      streakTracker += 1;
      if (streakTracker > longestWinStreak) longestWinStreak = streakTracker;
    } else if (match.loser_user_id === userId) {
      streakTracker = 0;
    }
  }

  let currentWinStreak = 0;
  for (let i = onlineRows.length - 1; i >= 0; i--) {
    const match = onlineRows[i];
    if (match.winner_user_id === userId) {
      currentWinStreak += 1;
      continue;
    }
    if (match.loser_user_id === userId) break;
  }

  const onlineGamesPlayed = wins + losses;
  const winRate =
    onlineGamesPlayed > 0 ? Math.round((wins / onlineGamesPlayed) * 1000) / 10 : 0;
  const qualitySamples = onlineRows
    .map((row) => row.avg_move_quality)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const avgMoveQuality =
    qualitySamples.length > 0
      ? Math.round((qualitySamples.reduce((sum, value) => sum + value, 0) / qualitySamples.length) * 10) / 10
      : null;
  const nowMs = Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const gamesThisWeek = onlineRows.filter((row) => {
    const createdMs = new Date(row.created_at ?? 0).getTime();
    return Number.isFinite(createdMs) && nowMs - createdMs <= sevenDaysMs;
  }).length;

  return {
    onlineGamesPlayed,
    wins,
    losses,
    avgMoveQuality,
    longestWinStreak,
    winRate,
    currentWinStreak,
    gamesThisWeek,
    ghostRating: null,
    ghostGamesThisWeek: 0,
    ghostRatingChangeThisWeek: 0,
    ghostBestWinMarginThisWeek: null,
  };
}

export interface RankingProfile {
  glicko_rating: number;
  glicko_rd: number;
  provisional: boolean;
  ranked_games_played: number;
  peak_rating: number;
  rank: number | null;
}

function resolveBaseUrl(): string {
  const configured = DEFAULT_SERVER_URL.trim();
  if (configured) return configured.replace(/\/$/, '');
  if (typeof window !== 'undefined') {
    const { hostname, port } = window.location;
    if (port === '5173' || hostname === 'localhost' || hostname === '127.0.0.1') return '';
    return '';
  }
  return DEFAULT_SERVER_ORIGIN;
}

export async function fetchRankingProfile(
  userId: string,
): Promise<{ data: RankingProfile | null; error: string | null }> {
  try {
    const response = await fetch(`${resolveBaseUrl()}/api/ranking/profile/${userId}`, {
      credentials: 'include',
    });
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to fetch ranking profile');
    }
    const data = await response.json();
    return { data, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

export async function fetchUserStats(
  user: User,
): Promise<{ data: StatsSummary | null; error: string | null }> {
  if (!supabase) return { data: null, error: 'Supabase not configured.' };

  const { data, error } = await fetchUserStatsByUserId(user.id);
  return { data, error };
}

export async function fetchPersonalStatsInsights(
  user: User,
): Promise<{ data: PersonalStatsInsights | null; error: string | null }> {
  if (!supabase) return { data: null, error: 'Supabase not configured.' };

  const [baseResp, rankingResp, historyResp] = await Promise.all([
    fetchUserStats(user),
    fetchRankingProfile(user.id),
    fetchRatingHistory(user.id),
  ]);

  if (baseResp.error) return { data: null, error: baseResp.error };

  const weekStart = getWeekStart();
  const base = baseResp.data ?? buildStatsSummary(user.id, []);
  const rankingProfile = rankingResp.data ?? null;
  const historyGames = historyResp.data?.games ?? [];
  const fritz = deriveFritzSummary(historyGames, weekStart);

  let ghostRows: GhostGameSummaryRow[] = [];
  try {
    const ghostGamesResp = await supabase
      .from('ghost_games')
      .select('final_score, opponent_score, played_at')
      .eq('user_id', user.id)
      .order('played_at', { ascending: false });
    if (!ghostGamesResp.error) {
      ghostRows = (ghostGamesResp.data ?? []) as GhostGameSummaryRow[];
    }
  } catch {
    ghostRows = [];
  }

  const ghost = deriveGhostSummary(ghostRows, base.ghostRating, weekStart);

  let completionRows: PuzzleCompletionRow[] = [];
  let scoreRows: PuzzleScoreRow[] = [];
  try {
    const [completionResp, scoreResp] = await Promise.all([
      supabase
        .from('daily_puzzle_completions')
        .select('puzzle_date, current_streak, score, perfect, updated_at')
        .eq('user_id', user.id)
        .order('puzzle_date', { ascending: false }),
      supabase
        .from('daily_puzzle_scores')
        .select('puzzle_date, best_score, updated_at')
        .eq('user_id', user.id)
        .order('puzzle_date', { ascending: false }),
    ]);
    if (!completionResp.error) completionRows = (completionResp.data ?? []) as PuzzleCompletionRow[];
    if (!scoreResp.error) scoreRows = (scoreResp.data ?? []) as PuzzleScoreRow[];
  } catch {
    completionRows = [];
    scoreRows = [];
  }

  const puzzle = derivePuzzleSummary(completionRows, scoreRows, weekStart);

  return {
    data: {
      base,
      rankingProfile,
      fritz,
      ghost,
      puzzle,
    },
    error: null,
  };
}

export async function fetchWeeklyRecap(
  user: User,
): Promise<{ data: WeeklyRecap | null; error: string | null }> {
  const insightsResp = await fetchPersonalStatsInsights(user);
  if (insightsResp.error || !insightsResp.data) {
    return { data: null, error: insightsResp.error ?? 'Unable to load weekly recap.' };
  }

  const weekStart = getWeekStart();
  const { base, fritz, ghost, puzzle } = insightsResp.data;
  return {
    data: {
      weekLabel: formatWeekLabel(weekStart),
      fritz: {
        gamesThisWeek: fritz.gamesThisWeek,
        ratingChangeThisWeek: fritz.ratingChangeThisWeek,
        bestWinMarginThisWeek: fritz.bestWinMarginThisWeek,
      },
      ghost: {
        gamesThisWeek: ghost.gamesThisWeek,
        ratingChangeThisWeek: ghost.ratingChangeThisWeek,
        bestWinMarginThisWeek: ghost.bestWinMarginThisWeek,
      },
      puzzle: {
        completionsThisWeek: puzzle.completionsThisWeek,
        bestScoreToday: puzzle.bestScoreToday,
      },
      multiplayer: {
        gamesThisWeek: base.gamesThisWeek,
        wins: base.wins,
        losses: base.losses,
      },
    },
    error: null,
  };
}

export async function fetchUserStatsByUserId(
  userId: string,
): Promise<{ data: StatsSummary | null; error: string | null }> {
  if (!supabase) return { data: null, error: 'Supabase not configured.' };

  let historyResp: { data: unknown[] | null; error: { message?: string; code?: string } | null } = await supabase
    .from('matches')
    .select('winner_user_id, loser_user_id, mode, avg_move_quality, created_at')
    .or(`winner_user_id.eq.${userId},loser_user_id.eq.${userId}`);

  // Backward-compatible retry for deployments where avg_move_quality column is not added yet.
  if (
    historyResp.error &&
    (((historyResp.error.message ?? '').toLowerCase().includes('avg_move_quality') ||
      (historyResp.error.message ?? '').toLowerCase().includes('column')) ||
      String((historyResp.error as { code?: string }).code ?? '') === '42703')
  ) {
    historyResp = await supabase
      .from('matches')
      .select('winner_user_id, loser_user_id, mode, created_at')
      .or(`winner_user_id.eq.${userId},loser_user_id.eq.${userId}`);
  }

  if (historyResp.error) {
    const message = historyResp.error.message ?? 'Stats unavailable.';
    const normalized = message.toLowerCase();
    if (
      normalized.includes('relation') ||
      normalized.includes('does not exist') ||
      normalized.includes('42p01')
    ) {
      return { data: null, error: 'Stats unavailable (missing table).' };
    }
    return { data: null, error: message };
  }

  const rows = (historyResp.data ?? []) as MatchSummaryRow[];
  const summary = buildStatsSummary(userId, rows);

  let ghostRating: number | null = null;
  try {
    const ghostProfileResp = await supabase
      .from('ghost_profiles')
      .select('ghost_rating')
      .eq('user_id', userId)
      .maybeSingle();
    if (!ghostProfileResp.error && ghostProfileResp.data) {
      ghostRating = Number(ghostProfileResp.data.ghost_rating ?? 800);
    }
  } catch {
    ghostRating = null;
  }

  let ghostGamesThisWeek = 0;
  let ghostRatingChangeThisWeek = 0;
  let ghostBestWinMarginThisWeek: number | null = null;
  try {
    const now = new Date();
    const day = now.getDay();
    const diffToMonday = (day + 6) % 7;
    const weekStart = new Date(now);
    weekStart.setHours(0, 0, 0, 0);
    weekStart.setDate(now.getDate() - diffToMonday);

    const ghostGamesResp = await supabase
      .from('ghost_games')
      .select('final_score, opponent_score, played_at')
      .eq('user_id', userId)
      .gte('played_at', weekStart.toISOString())
      .order('played_at', { ascending: false });

    if (!ghostGamesResp.error) {
      const ghostRows = (ghostGamesResp.data ?? []) as GhostGameSummaryRow[];
      ghostGamesThisWeek = ghostRows.length;
      let winsThisWeek = 0;
      let lossesThisWeek = 0;
      for (const row of ghostRows) {
        const finalScore = Number(row.final_score ?? 0);
        const opponentScore = Number(row.opponent_score ?? 0);
        const margin = finalScore - opponentScore;
        if (margin > 0) winsThisWeek += 1;
        if (margin < 0) lossesThisWeek += 1;
        if (margin > 0) {
          ghostBestWinMarginThisWeek =
            ghostBestWinMarginThisWeek == null
              ? margin
              : Math.max(ghostBestWinMarginThisWeek, margin);
        }
      }
      ghostRatingChangeThisWeek = (winsThisWeek - lossesThisWeek) * 16;
    }
  } catch {
    ghostGamesThisWeek = 0;
    ghostRatingChangeThisWeek = 0;
    ghostBestWinMarginThisWeek = null;
  }

  return {
    data: {
      ...summary,
      ghostRating,
      ghostGamesThisWeek,
      ghostRatingChangeThisWeek,
      ghostBestWinMarginThisWeek,
    },
    error: null,
  };
}
