import type { User } from '@supabase/supabase-js';
import { apiGet, apiPost } from '../api/client';
import { supabase } from '../lib/supabase';
import { resolveGameServerUrl } from '../lib/gameServerUrl';
import { fetchRatingHistory } from '../ranking/api';
import {
  buildStatsSummary,
  deriveFritzSummary,
  deriveGhostSummary,
  formatWeekLabel,
  getWeekStart,
  isGhostRatingEligible,
  type GhostGameSummaryRow,
  type MatchSummaryRow,
} from './statsDerivations';
import type {
  FritzStatsSummary,
  PersonalStatsInsights,
  PuzzleStatsSummary,
  RankingProfile,
  RecordMatchInput,
  StatsSummary,
  WeeklyRecap,
} from './statsTypes';

export type {
  FritzStatsSummary,
  FritzTierKey,
  FritzTierRecord,
  GhostStatsSummary,
  MatchMode,
  PersonalStatsInsights,
  PuzzleStatsSummary,
  RankingProfile,
  RecordMatchInput,
  StatsSummary,
  WeeklyRecap,
} from './statsTypes';

export async function recordMatchResult(
  input: RecordMatchInput,
): Promise<{ error: string | null }> {
  const serverUrl = resolveGameServerUrl();
  if (!serverUrl || !supabase) return { error: null };

  const result = await apiPost<{ ok?: boolean }>('/api/stats/record-match', input);
  return { error: result.error };
}

export async function fetchRankingProfile(
  userId: string,
): Promise<{ data: RankingProfile | null; error: string | null }> {
  const result = await apiGet<Record<string, unknown>>(
    `/api/ranking/profile/${encodeURIComponent(userId)}`,
    { auth: false },
  );
  if (result.error) {
    return { data: null, error: result.error };
  }
  const raw = result.data;
  if (!raw) {
    return { data: null, error: 'Failed to fetch ranking profile' };
  }
  if (raw.ok !== true) {
    return { data: null, error: 'Failed to fetch ranking profile' };
  }
  return {
    data: {
      glicko_rating: Number(raw.glicko_rating ?? 0),
      glicko_rd: Number(raw.glicko_rd ?? 350),
      provisional: Boolean(raw.provisional),
      ranked_games_played: Number(raw.ranked_games_played ?? 0),
      peak_rating: Number(raw.peak_rating ?? raw.glicko_rating ?? 0),
      rank: (() => {
        if (raw.rank == null || raw.rank === '') return null;
        const n = Number(raw.rank);
        return Number.isFinite(n) ? n : null;
      })(),
      currentWinStreak: Number(raw.currentWinStreak ?? 0),
    },
    error: null,
  };
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
  return fetchPersonalStatsInsightsByUserId(user.id);
}

const EMPTY_PUZZLE_SUMMARY: PuzzleStatsSummary = {
  currentStreak: 0,
  completions: 0,
  completionsThisWeek: 0,
  bestScoreToday: null,
  bestScoreEver: null,
};

/**
 * Daily Puzzle (Puzzle Rush) stats, computed server-side from `rush_runs`
 * unioned with frozen Ladder history. A failure degrades to zeros rather than
 * failing the whole insights load — the same tolerance the old direct read had.
 */
export async function fetchPuzzleStatsSummary(): Promise<PuzzleStatsSummary> {
  const result = await apiGet<{
    ok?: boolean;
    completions?: number;
    currentStreak?: number;
    completionsThisWeek?: number;
    bestScoreToday?: number | null;
    bestScoreEver?: number | null;
  }>('/api/puzzle-rush/stats-summary');
  const raw = result.data;
  if (result.error || !raw || raw.ok !== true) return EMPTY_PUZZLE_SUMMARY;
  return {
    completions: Number(raw.completions ?? 0),
    currentStreak: Number(raw.currentStreak ?? 0),
    completionsThisWeek: Number(raw.completionsThisWeek ?? 0),
    bestScoreToday: raw.bestScoreToday == null ? null : Number(raw.bestScoreToday),
    bestScoreEver: raw.bestScoreEver == null ? null : Number(raw.bestScoreEver),
  };
}

export async function fetchPersonalStatsInsightsByUserId(
  userId: string,
): Promise<{ data: PersonalStatsInsights | null; error: string | null }> {
  if (!supabase) return { data: null, error: 'Supabase not configured.' };

  const [baseResp, rankingResp, historyResp] = await Promise.all([
    fetchUserStatsByUserId(userId),
    fetchRankingProfile(userId),
    fetchRatingHistory(userId),
  ]);

  if (baseResp.error) return { data: null, error: baseResp.error };

  const weekStart = getWeekStart();
  const base = baseResp.data ?? buildStatsSummary(userId, []);
  const rankingProfile = rankingResp.data ?? null;
  const historyGames = historyResp.data?.games ?? [];
  const fritz = deriveFritzSummary(historyGames, weekStart);

  let ghostRows: GhostGameSummaryRow[] = [];
  try {
    const ghostGamesResp = await supabase
      .from('ghost_games')
      .select('final_score, opponent_score, played_at')
      .eq('user_id', userId)
      .order('played_at', { ascending: false });
    if (!ghostGamesResp.error) {
      ghostRows = (ghostGamesResp.data ?? []) as GhostGameSummaryRow[];
    }
  } catch {
    ghostRows = [];
  }

  const ghost = deriveGhostSummary(ghostRows, base.ghostRating, weekStart);

  // Puzzle Rush *is* the Daily Puzzle since 2026-08-20; its `rush_runs` table has
  // deny-all RLS, so the browser cannot read it. The server unions it with the
  // frozen Ladder-era history. The old direct read hit `daily_puzzle_completions`
  // — a table that no longer exists in production, 404ing on every /stats load
  // and leaving streak / completions hardcoded 0 (FEATURE_COMPLETENESS_AUDIT P1-1).
  const puzzle = await fetchPuzzleStatsSummary();

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

  // Production `matches` does not expose `avg_move_quality` yet. Keep the browser read path on
  // the stable column set so optional stats/history loads do not emit a failing 400 first.
  const historyResp: { data: unknown[] | null; error: { message?: string; code?: string } | null } = await supabase
    .from('matches')
    .select('winner_user_id, loser_user_id, mode, winner_score, loser_score, room_code, created_at')
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
    const weekStart = getWeekStart();

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
        const ratingEligible = isGhostRatingEligible(finalScore, opponentScore);
        if (ratingEligible && margin > 0) winsThisWeek += 1;
        if (ratingEligible && margin < 0) lossesThisWeek += 1;
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

export async function fetchFritzHubStats(
  userId: string,
): Promise<FritzStatsSummary | null> {
  const historyResp = await fetchRatingHistory(userId);
  if (historyResp.error || !historyResp.data) return null;
  return deriveFritzSummary(historyResp.data.games, getWeekStart());
}