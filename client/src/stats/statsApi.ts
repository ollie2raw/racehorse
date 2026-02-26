import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

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
}

type MatchSummaryRow = {
  winner_user_id: string | null;
  loser_user_id: string | null;
  mode: string | null;
  avg_move_quality?: number | null;
  created_at?: string | null;
};

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
  };
}

export async function fetchUserStats(
  user: User,
): Promise<{ data: StatsSummary | null; error: string | null }> {
  if (!supabase) return { data: null, error: 'Supabase not configured.' };

  const { data, error } = await fetchUserStatsByUserId(user.id);
  return { data, error };
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

  return {
    data: summary,
    error: null,
  };
}
