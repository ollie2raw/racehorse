import {
  generateDailyFritzRun,
  generateSingleDailyFritzGameHand,
  sortDailyFritzLeaderboard,
  type DailyFritzAttemptStatus,
  type DailyFritzHandDeal,
  type DailyFritzLeaderboardEntry,
  type DailyFritzRunStatus,
  type DailyFritzSetGameNumber,
  type DailyFritzSetGameResult,
  type DailyFritzSetResult,
  type DailyFritzTier,
} from '../../dailyFritz';
import {
  getDailyFritzSkunkLossRank,
  getDailyFritzSkunkWinRank,
  normalizeDailyFritzSetSkunkFields,
} from '../../dailyFritzSkunk';
import { supabaseFetch } from '../../supabaseUtils';
import { getPacificDateKey } from '../../shared/pacificDate';

export type DailyFritzRunRow = {
  run_date: string;
  seed: string;
  fritz_tier: DailyFritzTier;
  deal_size: number;
  winning_score: number;
  status: DailyFritzRunStatus;
  hand_deals: DailyFritzHandDeal[];
  generated_at: string;
  invalidated_at: string | null;
  metadata: Record<string, unknown> | null;
};

export type DailyFritzAttemptRow = {
  id: string;
  run_date: string;
  user_id: string;
  status: DailyFritzAttemptStatus;
  current_hand_index: number;
  started_at: string;
  completed_at: string | null;
  verified_match_id: string | null;
  completion_hash: string | null;
  result: Record<string, unknown> | null;
  final_score: number | null;
  opponent_score: number | null;
  point_diff: number | null;
  won: boolean | null;
  moves_used: number | null;
  hands_played: number | null;
};

export type DailyFritzRunRecord = {
  runDate: string;
  seed: string;
  fritzTier: DailyFritzTier;
  dealSize: 7 | 14;
  winningScore: number;
  status: DailyFritzRunStatus;
  handDeals: DailyFritzHandDeal[];
  generatedAt: string;
  invalidatedAt: string | null;
  metadata: Record<string, unknown> | null;
};

export type DailyFritzRunSummary = {
  runDate: string;
  fritzTier: DailyFritzTier;
  dealSize: 7 | 14;
  winningScore: number;
  status: DailyFritzRunStatus;
};

export type DailyFritzAttemptRecord = {
  id: string;
  runDate: string;
  userId: string;
  status: DailyFritzAttemptStatus;
  currentHandIndex: number;
  startedAt: string;
  completedAt: string | null;
  verifiedMatchId: string | null;
  completionHash: string | null;
  result: Record<string, unknown> | null;
  finalScore: number | null;
  opponentScore: number | null;
  pointDiff: number | null;
  won: boolean | null;
  movesUsed: number | null;
  handsPlayed: number | null;
};
export const dailyFritzRunCache = new Map<string, DailyFritzRunRecord>();
export function normalizeDailyFritzTier(value: unknown): DailyFritzTier | null {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (raw === 'rookie' || raw === 'standard' || raw === 'elite' || raw === 'master') {
    return raw;
  }
  return null;
}

export function normalizeDailyFritzStatus(value: unknown): DailyFritzRunStatus | null {
  return value === 'live' || value === 'archived' || value === 'invalidated' ? value : null;
}

export function isTile(value: unknown): value is { low: number; high: number } {
  if (!value || typeof value !== 'object') return false;
  const rec = value as Record<string, unknown>;
  return Number.isInteger(rec.low) && Number.isInteger(rec.high);
}

export function normalizeTile(value: unknown): { low: number; high: number } | null {
  if (Array.isArray(value) && value.length === 2) {
    const low = Number(value[0]);
    const high = Number(value[1]);
    if (!Number.isInteger(low) || !Number.isInteger(high)) return null;
    return { low: Math.min(low, high), high: Math.max(low, high) };
  }
  if (!isTile(value)) return null;
  return {
    low: Math.min(value.low, value.high),
    high: Math.max(value.low, value.high),
  };
}

export function normalizeTileArray(value: unknown): { low: number; high: number }[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((tile) => normalizeTile(tile))
    .filter((tile): tile is { low: number; high: number } => Boolean(tile));
}

export function normalizeDailyFritzHandDeal(value: unknown): DailyFritzHandDeal | null {
  if (!value || typeof value !== 'object') return null;
  const rec = value as Record<string, unknown>;
  const playerTiles = normalizeTileArray(rec.player_tiles);
  const fritzTiles = normalizeTileArray(rec.fritz_tiles);
  const boneyard = normalizeTileArray(rec.boneyard);
  const locked = normalizeTileArray(rec.locked);
  if (playerTiles.length === 0 || fritzTiles.length === 0) return null;
  return {
    player_tiles: playerTiles,
    fritz_tiles: fritzTiles,
    boneyard,
    locked,
  };
}

export function toDailyFritzRunRecord(row: DailyFritzRunRow): DailyFritzRunRecord | null {
  const fritzTier = normalizeDailyFritzTier(row.fritz_tier);
  const status = normalizeDailyFritzStatus(row.status);
  const dealSize = Number(row.deal_size) === 14 ? 14 : Number(row.deal_size) === 7 ? 7 : null;
  const handDealsRaw = Array.isArray(row.hand_deals) ? row.hand_deals : [];
  const handDeals = handDealsRaw
    .map((deal) => normalizeDailyFritzHandDeal(deal))
    .filter((deal): deal is DailyFritzHandDeal => Boolean(deal));
  if (!fritzTier || !status || !dealSize || handDeals.length !== 12) return null;
  return {
    runDate: row.run_date,
    seed: row.seed,
    fritzTier,
    dealSize,
    winningScore: Number(row.winning_score) || 60,
    status,
    handDeals,
    generatedAt: row.generated_at,
    invalidatedAt: row.invalidated_at,
    metadata: row.metadata ?? null,
  };
}

export function toDailyFritzRunRow(record: DailyFritzRunRecord): DailyFritzRunRow {
  return {
    run_date: record.runDate,
    seed: record.seed,
    fritz_tier: record.fritzTier,
    deal_size: record.dealSize,
    winning_score: record.winningScore,
    status: record.status,
    hand_deals: record.handDeals,
    generated_at: record.generatedAt,
    invalidated_at: record.invalidatedAt,
    metadata: record.metadata,
  };
}

export function toDailyFritzAttemptRecord(row: DailyFritzAttemptRow): DailyFritzAttemptRecord {
  return {
    id: row.id,
    runDate: row.run_date,
    userId: row.user_id,
    status: row.status,
    currentHandIndex: Number(row.current_hand_index) || 0,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    verifiedMatchId: row.verified_match_id,
    completionHash: row.completion_hash,
    result: row.result ?? null,
    finalScore: row.final_score == null ? null : Number(row.final_score),
    opponentScore: row.opponent_score == null ? null : Number(row.opponent_score),
    pointDiff: row.point_diff == null ? null : Number(row.point_diff),
    won: typeof row.won === 'boolean' ? row.won : null,
    movesUsed: row.moves_used == null ? null : Number(row.moves_used),
    handsPlayed: row.hands_played == null ? null : Number(row.hands_played),
  };
}

export function toDailyFritzAttemptRow(record: DailyFritzAttemptRecord): DailyFritzAttemptRow {
  return {
    id: record.id,
    run_date: record.runDate,
    user_id: record.userId,
    status: record.status,
    current_hand_index: record.currentHandIndex,
    started_at: record.startedAt,
    completed_at: record.completedAt,
    verified_match_id: record.verifiedMatchId,
    completion_hash: record.completionHash,
    result: record.result,
    final_score: record.finalScore,
    opponent_score: record.opponentScore,
    point_diff: record.pointDiff,
    won: record.won,
    moves_used: record.movesUsed,
    hands_played: record.handsPlayed,
  };
}

export function normalizeDailyFritzSetGameNumber(value: unknown): DailyFritzSetGameNumber | null {
  return value === 1 || value === 2 || value === 3 ? value : null;
}

export function normalizeDailyFritzSetGameResult(value: unknown): DailyFritzSetGameResult | null {
  if (!value || typeof value !== 'object') return null;
  const rec = value as Record<string, unknown>;
  const gameNumber = normalizeDailyFritzSetGameNumber(Number(rec.gameNumber));
  const seed = typeof rec.seed === 'string' ? rec.seed.trim() : '';
  const playerScore = Number(rec.playerScore);
  const fritzScore = Number(rec.fritzScore);
  const pointDiff = Number(rec.pointDiff);
  const completedAt = typeof rec.completedAt === 'string' ? rec.completedAt : '';
  if (
    !gameNumber ||
    !seed ||
    typeof rec.playerWon !== 'boolean' ||
    !Number.isFinite(playerScore) ||
    !Number.isFinite(fritzScore) ||
    !Number.isFinite(pointDiff) ||
    !completedAt
  ) {
    return null;
  }
  const movesUsed = rec.movesUsed == null ? undefined : Number(rec.movesUsed);
  const handsPlayed = rec.handsPlayed == null ? undefined : Number(rec.handsPlayed);
  const safeMovesUsed = movesUsed == null || !Number.isFinite(movesUsed) ? undefined : Math.round(movesUsed);
  const safeHandsPlayed = handsPlayed == null || !Number.isFinite(handsPlayed) ? undefined : Math.round(handsPlayed);
  const skunk = rec.skunk === true;
  const skunkByRaw = rec.skunkBy ?? rec.skunk_by;
  const skunkBy = skunkByRaw === 'player' || skunkByRaw === 'fritz' ? skunkByRaw : undefined;
  return {
    gameNumber,
    seed,
    playerWon: rec.playerWon,
    playerScore: Math.round(playerScore),
    fritzScore: Math.round(fritzScore),
    pointDiff: Math.round(pointDiff),
    ...(safeMovesUsed != null ? { movesUsed: safeMovesUsed } : {}),
    ...(safeHandsPlayed != null ? { handsPlayed: safeHandsPlayed } : {}),
    completedAt,
    ...(skunk ? { skunk: true } : {}),
    ...(skunkBy ? { skunkBy } : {}),
  };
}

export function normalizeDailyFritzSetResult(value: unknown): DailyFritzSetResult | null {
  if (!value || typeof value !== 'object') return null;
  const rec = value as Record<string, unknown>;
  if (rec.version !== 2 || rec.format !== 'best_of_3' || !Array.isArray(rec.games)) return null;
  const games = rec.games
    .map((game) => normalizeDailyFritzSetGameResult(game))
    .filter((game): game is DailyFritzSetGameResult => Boolean(game))
    .sort((a, b) => a.gameNumber - b.gameNumber);
  if (games.length !== rec.games.length || games.length > 3) return null;
  for (let index = 0; index < games.length; index += 1) {
    if (games[index].gameNumber !== index + 1) return null;
  }
  const totalPointDiff = games.reduce((sum, game) => sum + game.pointDiff, 0);
  const skunkFields = normalizeDailyFritzSetSkunkFields(games, rec);
  return {
    version: 2,
    format: 'best_of_3',
    totalPointDiff,
    games,
    ...skunkFields,
  };
}

export function getDailyFritzSetPointDiff(setResult: DailyFritzSetResult | null): number | null {
  if (!setResult || setResult.version !== 2 || setResult.format !== 'best_of_3') return null;
  if (Number.isFinite(setResult.totalPointDiff)) return Math.round(setResult.totalPointDiff);
  if (setResult.games.length === 0) return 0;
  return Math.round(
    setResult.games.reduce(
      (sum, game) => sum + (Number.isFinite(game.pointDiff) ? Number(game.pointDiff) : Number(game.playerScore) - Number(game.fritzScore)),
      0,
    ),
  );
}

export function getCurrentDailyFritzGameNumber(result: Record<string, unknown> | null): DailyFritzSetGameNumber {
  const setResult = normalizeDailyFritzSetResult(result);
  if (!setResult || setResult.setWinner) return 1;
  return Math.min(setResult.games.length + 1, 3) as DailyFritzSetGameNumber;
}

export function getDailyFritzHandForGame(
  run: DailyFritzRunRecord,
  gameNumber: DailyFritzSetGameNumber,
  handIndex: number,
): DailyFritzHandDeal {
  return generateSingleDailyFritzGameHand(run.runDate, gameNumber, handIndex, run.dealSize as 7 | 14);
}

export function isMissingDailyFritzTable(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes('daily_fritz_') &&
    (message.includes('does not exist') ||
      message.includes('pgrst205') ||
      message.includes('schema cache') ||
      message.includes('could not find the table'))
  );
}

export async function getDailyFritzRun(runDate: string): Promise<DailyFritzRunRecord | null> {
  const cached = dailyFritzRunCache.get(runDate);
  if (cached) return cached;
  const rows = await supabaseFetch<DailyFritzRunRow[]>(
    `/rest/v1/daily_fritz_runs?select=run_date,seed,fritz_tier,deal_size,winning_score,status,hand_deals,generated_at,invalidated_at,metadata&run_date=eq.${encodeURIComponent(runDate)}&limit=1`,
    { method: 'GET' },
  );
  const record = rows[0] ? toDailyFritzRunRecord(rows[0]) : null;
  if (record) dailyFritzRunCache.set(runDate, record);
  return record;
}

export async function getDailyFritzRunSummary(runDate: string): Promise<DailyFritzRunSummary | null> {
  const cached = dailyFritzRunCache.get(runDate);
  if (cached) {
    return {
      runDate: cached.runDate,
      fritzTier: cached.fritzTier,
      dealSize: cached.dealSize,
      winningScore: cached.winningScore,
      status: cached.status,
    };
  }
  const rows = await supabaseFetch<Array<{
    run_date: string;
    fritz_tier: DailyFritzTier;
    deal_size: number;
    winning_score: number;
    status: DailyFritzRunStatus;
  }>>(
    `/rest/v1/daily_fritz_runs?select=run_date,fritz_tier,deal_size,winning_score,status&run_date=eq.${encodeURIComponent(runDate)}&limit=1`,
    { method: 'GET' },
  );
  const row = rows[0];
  if (!row) return null;
  const dealSize = row.deal_size === 7 || row.deal_size === 14 ? row.deal_size : null;
  if (!dealSize) return null;
  return {
    runDate: row.run_date,
    fritzTier: row.fritz_tier,
    dealSize,
    winningScore: row.winning_score,
    status: row.status,
  };
}

export async function upsertDailyFritzRun(record: DailyFritzRunRecord): Promise<DailyFritzRunRecord> {
  const rows = await supabaseFetch<DailyFritzRunRow[]>(
    '/rest/v1/daily_fritz_runs?on_conflict=run_date',
    {
      method: 'POST',
      headers: {
        Prefer: 'return=representation,resolution=merge-duplicates',
      },
      body: JSON.stringify([toDailyFritzRunRow(record)]),
    },
  );
  const saved = rows[0] ? toDailyFritzRunRecord(rows[0]) : null;
  if (!saved) throw new Error('Failed to persist daily Fritz run.');
  dailyFritzRunCache.set(saved.runDate, saved);
  return saved;
}

export async function ensureDailyFritzRunForDate(
  runDate: string,
  options?: { fritzTier?: DailyFritzTier; dealSize?: 7 | 14; winningScore?: number },
  diagnostics?: {
    requestId?: string;
    log: (label: string, ms: number, extra?: Record<string, unknown>) => void;
  },
): Promise<DailyFritzRunRecord | null> {
  try {
    const existingStartedAt = Date.now();
    const existing = await getDailyFritzRun(runDate);
    diagnostics?.log('ensure:getDailyFritzRun', Date.now() - existingStartedAt, {
      cacheHit: Boolean(existing),
      requestId: diagnostics.requestId,
      runDate,
    });
    if (existing) return existing;

    const generateStartedAt = Date.now();
    const generated = generateDailyFritzRun(
      runDate,
      options?.fritzTier ?? 'elite',
      options?.dealSize ?? 7,
      options?.winningScore ?? 60,
    );
    diagnostics?.log('ensure:generateDailyFritzRun', Date.now() - generateStartedAt, {
      requestId: diagnostics?.requestId,
      runDate,
      dealSize: generated.dealSize,
      winningScore: generated.winningScore,
      handCount: generated.handDeals.length,
    });

    const upsertStartedAt = Date.now();
    const saved = await upsertDailyFritzRun({
      runDate: generated.runDate,
      seed: generated.seed,
      fritzTier: generated.fritzTier,
      dealSize: generated.dealSize,
      winningScore: generated.winningScore,
      status: generated.status,
      handDeals: generated.handDeals,
      generatedAt: generated.generatedAt,
      invalidatedAt: generated.invalidatedAt,
      metadata: generated.metadata,
    });
    diagnostics?.log('ensure:upsertDailyFritzRun', Date.now() - upsertStartedAt, {
      requestId: diagnostics?.requestId,
      runDate,
      persisted: Boolean(saved),
    });
    return saved;
  } catch (error) {
    if (isMissingDailyFritzTable(error)) {
      console.warn('[daily-fritz] table missing; apply supabase/daily_fritz.sql');
      return null;
    }
    throw error;
  }
}
export async function getDailyFritzAttempt(runDate: string, userId: string): Promise<DailyFritzAttemptRecord | null> {
  const rows = await supabaseFetch<DailyFritzAttemptRow[]>(
    `/rest/v1/daily_fritz_attempts?select=id,run_date,user_id,status,current_hand_index,started_at,completed_at,verified_match_id,completion_hash,result,final_score,opponent_score,point_diff,won,moves_used,hands_played&run_date=eq.${encodeURIComponent(runDate)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
    { method: 'GET' },
  );
  return rows[0] ? toDailyFritzAttemptRecord(rows[0]) : null;
}

export async function getDailyFritzAttemptById(
  attemptId: string,
  userId: string,
): Promise<DailyFritzAttemptRecord | null> {
  const rows = await supabaseFetch<DailyFritzAttemptRow[]>(
    `/rest/v1/daily_fritz_attempts?select=id,run_date,user_id,status,current_hand_index,started_at,completed_at,verified_match_id,completion_hash,result,final_score,opponent_score,point_diff,won,moves_used,hands_played&id=eq.${encodeURIComponent(attemptId)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
    { method: 'GET' },
  );
  return rows[0] ? toDailyFritzAttemptRecord(rows[0]) : null;
}

export async function upsertDailyFritzAttempt(record: DailyFritzAttemptRecord): Promise<DailyFritzAttemptRecord> {
  const rows = await supabaseFetch<DailyFritzAttemptRow[]>(
    '/rest/v1/daily_fritz_attempts?on_conflict=id',
    {
      method: 'POST',
      headers: {
        Prefer: 'return=representation,resolution=merge-duplicates',
      },
      body: JSON.stringify([toDailyFritzAttemptRow(record)]),
    },
  );
  const saved = rows[0] ? toDailyFritzAttemptRecord(rows[0]) : null;
  if (!saved) throw new Error('Failed to persist daily Fritz attempt.');
  return saved;
}

export async function createDailyFritzAttempt(runDate: string, userId: string): Promise<DailyFritzAttemptRecord> {
  const rows = await supabaseFetch<DailyFritzAttemptRow[]>(
    '/rest/v1/daily_fritz_attempts',
    {
      method: 'POST',
      headers: {
        Prefer: 'return=representation',
      },
      body: JSON.stringify([{
        run_date: runDate,
        user_id: userId,
        status: 'started',
        current_hand_index: 0,
      }]),
    },
  );
  const saved = rows[0] ? toDailyFritzAttemptRecord(rows[0]) : null;
  if (!saved) throw new Error('Failed to create daily Fritz attempt.');
  return saved;
}

export async function listDailyFritzAttemptsForDate(runDate: string): Promise<DailyFritzAttemptRecord[]> {
  const rows = await supabaseFetch<DailyFritzAttemptRow[]>(
    `/rest/v1/daily_fritz_attempts?select=id,run_date,user_id,status,current_hand_index,started_at,completed_at,verified_match_id,completion_hash,result,final_score,opponent_score,point_diff,won,moves_used,hands_played&run_date=eq.${encodeURIComponent(runDate)}&status=eq.completed&order=completed_at.asc,id.asc`,
    { method: 'GET' },
  );
  return rows.map(toDailyFritzAttemptRecord);
}

export async function listDailyFritzAttemptsForUser(userId: string, limit = 10): Promise<DailyFritzAttemptRecord[]> {
  const bounded = Math.max(1, Math.min(30, Math.floor(limit)));
  const rows = await supabaseFetch<DailyFritzAttemptRow[]>(
    `/rest/v1/daily_fritz_attempts?select=id,run_date,user_id,status,current_hand_index,started_at,completed_at,verified_match_id,completion_hash,result,final_score,opponent_score,point_diff,won,moves_used,hands_played&user_id=eq.${encodeURIComponent(userId)}&status=eq.completed&order=run_date.desc,completed_at.desc&limit=${bounded}`,
    { method: 'GET' },
  );
  return rows.map(toDailyFritzAttemptRecord);
}

export async function fetchProfileNames(userIds: string[]): Promise<Map<string, string>> {
  const uniqueIds = Array.from(new Set(userIds.filter(Boolean)));
  const out = new Map<string, string>();
  if (uniqueIds.length === 0) return out;
  const idClause = uniqueIds.map((id) => `"${id}"`).join(',');
  const rows = await supabaseFetch<Array<{ id: string; username: string | null }>>(
    `/rest/v1/profiles?select=id,username&id=in.(${encodeURIComponent(idClause)})`,
    { method: 'GET' },
  );
  for (const row of rows) {
    const username = typeof row.username === 'string' && row.username.trim()
      ? row.username.trim()
      : `user_${row.id.slice(0, 8)}`;
    out.set(row.id, username);
  }
  return out;
}

export async function buildDailyFritzLeaderboard(
  runDate: string,
): Promise<Array<DailyFritzLeaderboardEntry & { rank: number; userId: string }>> {
  const attempts = await listDailyFritzAttemptsForDate(runDate);
  const names = await fetchProfileNames(attempts.map((attempt) => attempt.userId));
  const sorted = sortDailyFritzLeaderboard(
    attempts
      .filter(isDailyFritzAttemptLeaderboardEligible)
      .map((attempt) => {
        const setResult = normalizeDailyFritzSetResult(attempt.result);
        const pointDiff = getDailyFritzSetPointDiff(setResult) ?? attempt.pointDiff;
        if (
          typeof attempt.won !== 'boolean' ||
          typeof attempt.finalScore !== 'number' ||
          typeof attempt.opponentScore !== 'number' ||
          typeof pointDiff !== 'number' ||
          typeof attempt.movesUsed !== 'number' ||
          typeof attempt.completedAt !== 'string'
        ) {
          return null;
        }
        return {
          userId: attempt.userId,
          username: names.get(attempt.userId) ?? `user_${attempt.userId.slice(0, 8)}`,
          won: attempt.won,
          finalScore: attempt.finalScore,
          opponentScore: attempt.opponentScore,
          pointDiff,
          movesUsed: attempt.movesUsed,
          completedAt: attempt.completedAt,
          ...(setResult
            ? {
                skunkWinRank: getDailyFritzSkunkWinRank(setResult),
                skunkLossRank: getDailyFritzSkunkLossRank(setResult),
              }
            : {}),
          ...(setResult?.games.length
            ? {
                games: setResult.games.map((game) => ({
                  gameNumber: game.gameNumber,
                  playerScore: game.playerScore,
                  fritzScore: game.fritzScore,
                  playerWon: game.playerWon,
                  pointDiff: game.pointDiff,
                  ...(game.skunk ? { skunk: true } : {}),
                  ...(game.skunkBy ? { skunkBy: game.skunkBy } : {}),
                })),
              }
            : {}),
        };
      })
      .filter((attempt): attempt is DailyFritzLeaderboardEntry & { userId: string } => Boolean(attempt)),
  );
  return sorted.map((entry, index) => ({ ...entry, rank: index + 1 }));
}

export function isDailyFritzAttemptLeaderboardEligible(
  attempt: Pick<DailyFritzAttemptRecord, 'status' | 'result'>,
): boolean {
  return attempt.status === 'completed' && attempt.result?.verification_status === 'verified';
}
export async function getDailyFritzStreak(userId: string, todayRunDate: string): Promise<number> {
  const rows = await supabaseFetch<Array<{ run_date: string; status: DailyFritzAttemptStatus }>>(
    `/rest/v1/daily_fritz_attempts?select=run_date,status&user_id=eq.${encodeURIComponent(userId)}&status=eq.completed&order=run_date.desc&limit=365`,
    { method: 'GET' },
  );
  const dates = Array.from(
    new Set(
      rows
        .map((row) => row.run_date)
        .filter((value): value is string => typeof value === 'string' && value.length > 0),
    ),
  ).sort((a, b) => b.localeCompare(a));
  if (!dates.includes(todayRunDate)) return 0;
  let streak = 0;
  let cursor = new Date(`${todayRunDate}T00:00:00-08:00`);
  while (true) {
    const key = getPacificDateKey(cursor);
    if (!dates.includes(key)) break;
    streak += 1;
    cursor = new Date(cursor.getTime() - 86400000);
  }
  return streak;
}
