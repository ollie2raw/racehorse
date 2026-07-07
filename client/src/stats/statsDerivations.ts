import {
  FRITZ_MASTER_ID,
  FRITZ_ROOKIE_ID,
  FRITZ_STANDARD_ID,
} from '../bot/fritzConfig';
import type {
  FritzStatsSummary,
  FritzTierKey,
  FritzTierRecord,
  GhostStatsSummary,
  PuzzleStatsSummary,
  StatsSummary,
} from './statsTypes';

export type MatchSummaryRow = {
  winner_user_id: string | null;
  loser_user_id: string | null;
  mode: string | null;
  winner_score?: number | null;
  loser_score?: number | null;
  room_code?: string | null;
  avg_move_quality?: number | null;
  created_at?: string | null;
};

export type GhostGameSummaryRow = {
  final_score: number | null;
  opponent_score: number | null;
  played_at?: string | null;
};

export type PuzzleCompletionRow = {
  puzzle_date: string | null;
  current_streak: number | null;
  score: number | null;
  perfect: boolean | null;
  updated_at?: string | null;
};

export type PuzzleScoreRow = {
  puzzle_date: string | null;
  best_score: number | null;
  updated_at?: string | null;
};

export function dedupeOnlineMatchRows<T extends MatchSummaryRow>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    const roomCode = row.room_code?.trim();
    const createdAt = row.created_at ?? '';
    const key = roomCode
      ? `room:${roomCode}:${row.winner_user_id ?? ''}:${row.loser_user_id ?? ''}:${row.winner_score ?? ''}:${row.loser_score ?? ''}`
      : `match:${row.winner_user_id ?? ''}:${row.loser_user_id ?? ''}:${row.winner_score ?? ''}:${row.loser_score ?? ''}:${createdAt.slice(0, 19)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

export function isGhostRatingEligible(
  finalScore: number | null | undefined,
  opponentScore: number | null | undefined,
): boolean {
  return Math.max(Number(finalScore ?? 0), Number(opponentScore ?? 0)) >= 10;
}

export function getWeekStart(now = new Date()): Date {
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

export function formatWeekLabel(weekStart: Date): string {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  return `Week of ${weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${weekEnd.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

export function deriveFritzSummary(
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
  let totalPointsScored = 0;
  let gamesThisWeek = 0;
  let ratingChangeThisWeek = 0;
  let bestWinMarginThisWeek: number | null = null;

  for (const game of games) {
    const tier = tierFromOpponentId(game.opponent_id);
    const playerScore = Number(game.player_score ?? 0);
    const margin = Number(game.player_score ?? 0) - Number(game.opponent_score ?? 0);
    highestScore = highestScore == null ? playerScore : Math.max(highestScore, playerScore);
    totalPointsScored += playerScore;
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
  const averagePointsScored = gamesPlayed > 0 ? Math.round((totalPointsScored / gamesPlayed) * 10) / 10 : null;

  return {
    gamesPlayed,
    wins,
    losses,
    winRate,
    currentStreak,
    bestStreak,
    bestWinMargin,
    averagePointsScored,
    highestScore,
    gamesThisWeek,
    ratingChangeThisWeek,
    bestWinMarginThisWeek,
    tierRecords,
  };
}

export function deriveGhostSummary(
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
    const ratingEligible = isGhostRatingEligible(finalScore, opponentScore);
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
      if (ratingEligible && margin > 0) ratingChangeThisWeek += 16;
      if (ratingEligible && margin < 0) ratingChangeThisWeek -= 16;
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

export function derivePuzzleSummary(
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

export function buildStatsSummary(userId: string, rows: MatchSummaryRow[]): StatsSummary {
  const onlineRows = dedupeOnlineMatchRows(
    rows.filter((row) => row.mode === 'online'),
  ).sort((a, b) => new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime());

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