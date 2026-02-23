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
  gamesPlayed: number;
  wins: number;
  losses: number;
  botWins: number;
  botLosses: number;
}

export async function fetchUserStats(
  user: User,
): Promise<{ data: StatsSummary | null; error: string | null }> {
  if (!supabase) return { data: null, error: 'Supabase not configured.' };

  const [winnerResp, loserResp] = await Promise.all([
    supabase.from('matches').select('mode, metadata').eq('winner_user_id', user.id),
    supabase.from('matches').select('mode, metadata').eq('loser_user_id', user.id),
  ]);

  if (winnerResp.error || loserResp.error) {
    const message = winnerResp.error?.message ?? loserResp.error?.message ?? 'Stats unavailable.';
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

  const wins = winnerResp.data?.length ?? 0;
  const losses = loserResp.data?.length ?? 0;
  const winners = winnerResp.data ?? [];
  const losers = loserResp.data ?? [];

  const botWins = winners.filter((row) => row.mode === 'bot').length;
  const botLosses = losers.filter((row) => row.mode === 'bot').length;

  return {
    data: {
      gamesPlayed: wins + losses,
      wins,
      losses,
      botWins,
      botLosses,
    },
    error: null,
  };
}
