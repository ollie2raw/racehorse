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
  roomCode?: string | null;
  metadata?: Record<string, unknown>;
}

export async function recordMatchResult(
  input: RecordMatchInput,
): Promise<{ error: string | null }> {
  if (!supabase) return { error: null };

  const payload = {
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

  const { error } = await supabase.from('matches').insert(payload);
  return { error: error?.message ?? null };
}

export interface StatsSummary {
  onlineGamesPlayed: number;
  wins: number;
  losses: number;
  botWins: number;
  botLosses: number;
  longestWinStreak: number;
}

type MatchSummaryRow = {
  winner_user_id: string | null;
  loser_user_id: string | null;
  mode: string | null;
  created_at?: string | null;
};

function buildStatsSummary(userId: string, rows: MatchSummaryRow[]): StatsSummary {
  const onlineRows = rows
    .filter((row) => row.mode === 'online')
    .sort((a, b) => new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime());

  const wins = onlineRows.filter((row) => row.winner_user_id === userId).length;
  const losses = onlineRows.filter((row) => row.loser_user_id === userId).length;

  const botRows = rows.filter((row) => row.mode === 'bot');
  const botWins = botRows.filter((row) => row.winner_user_id === userId).length;
  const botLosses = botRows.filter((row) => row.loser_user_id === userId).length;

  let longestWinStreak = 0;
  let currentWinStreak = 0;
  for (const match of onlineRows) {
    if (match.winner_user_id === userId) {
      currentWinStreak += 1;
      if (currentWinStreak > longestWinStreak) longestWinStreak = currentWinStreak;
    } else if (match.loser_user_id === userId) {
      currentWinStreak = 0;
    }
  }

  return {
    onlineGamesPlayed: wins + losses,
    wins,
    losses,
    botWins,
    botLosses,
    longestWinStreak,
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

  const historyResp = await supabase
    .from('matches')
    .select('winner_user_id, loser_user_id, mode, created_at')
    .or(`winner_user_id.eq.${userId},loser_user_id.eq.${userId}`);

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
