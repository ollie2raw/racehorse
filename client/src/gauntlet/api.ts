import type { Move } from '../types';
import { supabase } from '../lib/supabase';
import { generateDailyGauntlet, toPublicGauntletScenarios } from './generator';
import type {
  GauntletAttemptHistoryRow,
  GauntletFinalizeResult,
  GauntletLeaderboardRow,
  GauntletRating,
  GauntletRoundSubmitResult,
  GauntletTodaySummary,
  PublicGauntletScenario,
  ReplayFrame,
} from './types';

async function withTimeout<T>(promise: Promise<T>, timeoutMs = 12000): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error('Request timed out.')), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(id);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(id);
        reject(err);
      });
  });
}

function normalizeError(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const msg = String((error as { message?: unknown }).message ?? '').trim();
    if (msg) return msg;
  }
  return fallback;
}

export async function getTodayGauntletSummary(): Promise<GauntletTodaySummary | null> {
  if (!supabase) return null;
  const { data, error } = await withTimeout(
    Promise.resolve(supabase.rpc('gauntlet_today_summary')),
  );
  if (error) {
    throw new Error(error.message);
  }
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) return null;

  return {
    dayId: Number(row.day_id),
    dayDate: String(row.day_date),
    rounds: (Array.isArray(row.rounds) ? row.rounds : []) as PublicGauntletScenario[],
    closesAt: String(row.closes_at),
    attemptCount: Number(row.attempt_count ?? 0),
    attemptId: row.attempt_id ? Number(row.attempt_id) : null,
    attemptStatus: (row.attempt_status as 'in_progress' | 'banked' | 'finished' | null) ?? null,
    roundsPlayed: Number(row.rounds_played ?? 0),
    totalScore: Number(row.total_score ?? 0),
    rating: Number(row.rating ?? 1000),
    division: String(row.division ?? 'Bronze'),
  };
}

export async function startGauntletAttempt(): Promise<{
  attemptId: number;
  gauntletDayId: number;
  eloBefore: number;
  ratingDivision: string;
}> {
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }

  const { data, error } = await withTimeout(
    Promise.resolve(supabase.rpc('gauntlet_start_attempt')),
  );
  if (error) {
    throw new Error(error.message);
  }

  const row = Array.isArray(data) ? data[0] : null;
  if (!row) {
    throw new Error('Unable to start gauntlet attempt.');
  }

  return {
    attemptId: Number(row.attempt_id),
    gauntletDayId: Number(row.gauntlet_day_id),
    eloBefore: Number(row.elo_before ?? 1000),
    ratingDivision: String(row.rating_division ?? 'Bronze'),
  };
}

export async function submitGauntletRound(params: {
  attemptId: number;
  roundNumber: number;
  movesPlayed: Move[];
  replayFrames?: ReplayFrame[];
  timeTakenMs: number;
  playerScore: number;
}): Promise<GauntletRoundSubmitResult> {
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }

  const { data, error } = await withTimeout(
    Promise.resolve(
      supabase.rpc('gauntlet_submit_round', {
        p_attempt_id: params.attemptId,
        p_round_number: params.roundNumber,
        p_hand_played: params.movesPlayed,
        p_time_taken_ms: Math.max(0, Math.round(params.timeTakenMs)),
        p_player_score: Math.max(0, Math.round(params.playerScore)),
        p_replay_frames: params.replayFrames ?? [],
      }),
    ),
  );

  if (error) {
    throw new Error(error.message);
  }

  const row = Array.isArray(data) ? data[0] : null;
  if (!row) {
    throw new Error('Unable to submit round result.');
  }

  return {
    baseScore: Number(row.base_score ?? 0),
    speedBonus: Number(row.speed_bonus ?? 0),
    optimalityPct: Number(row.optimality_pct ?? 0),
    optimalityBonus: Number(row.optimality_bonus ?? 0),
    roundTotal: Number(row.round_total ?? 0),
    runningTotal: Number(row.running_total ?? 0),
    roundsPlayed: Number(row.rounds_played ?? 0),
    hasMoreRounds: Boolean(row.has_more_rounds),
  };
}

async function finalizeAttempt(
  attemptId: number,
  banked: boolean,
  replayFrames?: ReplayFrame[],
): Promise<GauntletFinalizeResult> {
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }

  const { data, error } = await withTimeout(
    Promise.resolve(
      supabase.rpc('gauntlet_finalize_attempt', {
        p_attempt_id: attemptId,
        p_banked: banked,
        p_replay_frames: replayFrames ?? null,
      }),
    ),
  );

  if (error) {
    throw new Error(error.message);
  }

  const row = Array.isArray(data) ? data[0] : null;
  if (!row) {
    throw new Error('Unable to finalize attempt.');
  }

  return {
    totalScore: Number(row.total_score ?? 0),
    roundsPlayed: Number(row.rounds_played ?? 0),
    status: String(row.status ?? (banked ? 'banked' : 'finished')) as 'banked' | 'finished',
  };
}

export async function bankGauntletAttempt(
  attemptId: number,
  replayFrames?: ReplayFrame[],
): Promise<GauntletFinalizeResult> {
  return finalizeAttempt(attemptId, true, replayFrames);
}

export async function finishGauntletAttempt(
  attemptId: number,
  replayFrames?: ReplayFrame[],
): Promise<GauntletFinalizeResult> {
  return finalizeAttempt(attemptId, false, replayFrames);
}

export async function getGauntletLeaderboard(date: string): Promise<GauntletLeaderboardRow[]> {
  if (!supabase) return [];

  const { data, error } = await withTimeout(
    Promise.resolve(
      supabase.rpc('gauntlet_leaderboard', {
        p_day_date: date,
        p_limit: 100,
      }),
    ),
  );

  if (error) {
    throw new Error(error.message);
  }

  return (Array.isArray(data) ? data : []).map((row) => ({
    rank: Number(row.rank ?? 0),
    userId: String(row.user_id),
    username: String(row.username ?? 'Player'),
    totalScore: Number(row.total_score ?? 0),
    roundsPlayed: Number(row.rounds_played ?? 0),
    finishedAt: String(row.finished_at ?? ''),
    division: String(row.division ?? 'Bronze'),
    percentile: row.percentile == null ? null : Number(row.percentile),
    isCaller: Boolean(row.is_caller),
  }));
}

export async function getGauntletReplay(date: string): Promise<{
  userId: string;
  username: string;
  totalScore: number;
  replayFrames: ReplayFrame[];
} | null> {
  if (!supabase) return null;

  const { data, error } = await withTimeout(
    Promise.resolve(
      supabase.rpc('gauntlet_replay_for_day', {
        p_day_date: date,
      }),
    ),
  );

  if (error) {
    throw new Error(error.message);
  }

  const row = Array.isArray(data) ? data[0] : null;
  if (!row) return null;

  return {
    userId: String(row.user_id),
    username: String(row.username ?? 'Player'),
    totalScore: Number(row.total_score ?? 0),
    replayFrames: (Array.isArray(row.replay_frames) ? row.replay_frames : []) as ReplayFrame[],
  };
}

export async function getMyGauntletHistory(limit = 30): Promise<GauntletAttemptHistoryRow[]> {
  if (!supabase) return [];

  const { data, error } = await withTimeout(
    Promise.resolve(
      supabase.rpc('gauntlet_my_history', {
        p_limit: Math.max(1, Math.min(90, Math.round(limit))),
      }),
    ),
  );

  if (error) {
    throw new Error(error.message);
  }

  return (Array.isArray(data) ? data : []).map((row) => ({
    attemptId: Number(row.attempt_id ?? 0),
    dayDate: String(row.day_date),
    totalScore: Number(row.total_score ?? 0),
    roundsPlayed: Number(row.rounds_played ?? 0),
    bankedOut: Boolean(row.banked_out),
    percentile: row.percentile == null ? null : Number(row.percentile),
    eloBefore: Number(row.elo_before ?? 1000),
    eloAfter: row.elo_after == null ? null : Number(row.elo_after),
    finishedAt: row.finished_at == null ? null : String(row.finished_at),
  }));
}

export async function getGauntletRating(userId?: string): Promise<GauntletRating | null> {
  if (!supabase) return null;

  const { data, error } = await withTimeout(
    Promise.resolve(
      supabase.rpc('gauntlet_rating', {
        p_user_id: userId ?? null,
      }),
    ),
  );

  if (error) {
    throw new Error(error.message);
  }

  const row = Array.isArray(data) ? data[0] : null;
  if (!row) return null;

  return {
    userId: String(row.user_id),
    rating: Number(row.rating ?? 1000),
    peakRating: Number(row.peak_rating ?? 1000),
    division: String(row.division ?? 'Bronze'),
    season: Number(row.season ?? 1),
    gamesPlayed: Number(row.games_played ?? 0),
    seasonRank: row.season_rank == null ? null : Number(row.season_rank),
  };
}

export function toUserFacingError(error: unknown): string {
  return normalizeError(error, 'Something went wrong.');
}

function todayUtcDateKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function publishTodayGauntlet(seedSalt = 'v1'): Promise<number> {
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }

  const dayDate = todayUtcDateKey();
  const seed = `gauntlet-${dayDate}-${seedSalt}`;
  const rounds = generateDailyGauntlet(seed);
  const publicRounds = toPublicGauntletScenarios(rounds);
  const roundsOptimal = rounds.map((round) => ({
    round: round.round,
    optimalScore: round.optimalScore,
    optimalSolution: round.optimalSolution,
  }));
  const closesAt = `${dayDate}T23:59:59.000Z`;

  const { data, error } = await withTimeout(
    Promise.resolve(
      supabase.rpc('gauntlet_publish_day', {
        p_day_date: dayDate,
        p_seed: seed,
        p_rounds: publicRounds,
        p_rounds_optimal: roundsOptimal,
        p_closes_at: closesAt,
      }),
    ),
    45000,
  );

  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}
