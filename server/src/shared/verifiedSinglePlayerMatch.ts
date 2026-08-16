import { createHash, randomUUID } from 'crypto';
import { isRankedDealSnapshot, type RankedDealSnapshot } from '../ghost/rankedDealAuthority';
import { supabaseFetch } from '../supabaseUtils';

export type VerifiedSinglePlayerMatch = {
  matchId: string;
  userId: string;
  localMatchId: string;
  mode: 'ghost' | 'fritz';
  opponentUserId: string | null;
  fritzTier: string | null;
  status: 'started' | 'completed' | 'abandoned';
  startedAt: string;
  completedAt: string | null;
  completionHash: string | null;
  completionResult: Record<string, unknown> | null;
  dealSnapshot: RankedDealSnapshot | null;
};

export type VerifiedSinglePlayerMatchRow = {
  match_id: string;
  user_id: string;
  local_match_id: string;
  mode: 'ghost' | 'fritz';
  opponent_user_id: string | null;
  fritz_tier: string | null;
  status: 'started' | 'completed' | 'abandoned';
  started_at: string;
  completed_at: string | null;
  completion_hash: string | null;
  completion_result: Record<string, unknown> | null;
  deal_snapshot: RankedDealSnapshot | null;
};
export const verifiedSinglePlayerMatches = new Map<string, VerifiedSinglePlayerMatch>();
export const verifiedSinglePlayerMatchesByLocalKey = new Map<string, string>();
export let persistentVerifiedMatchesAvailable: boolean | null = null;
export let persistentDealSnapshotColumnAvailable: boolean | null = null;

const VERIFIED_MATCH_SELECT_BASE =
  'match_id,user_id,local_match_id,mode,opponent_user_id,fritz_tier,status,started_at,completed_at,completion_hash,completion_result';

function verifiedMatchSelect(): string {
  return persistentDealSnapshotColumnAvailable === false
    ? VERIFIED_MATCH_SELECT_BASE
    : `${VERIFIED_MATCH_SELECT_BASE},deal_snapshot`;
}
export function isGhostTileKey(value: unknown): value is string {
  return typeof value === 'string' && /^[0-6]\|[0-6]$/.test(value);
}

export function isGhostBranch(value: unknown): value is string | null {
  return (
    value == null ||
    value === 'left' ||
    value === 'right' ||
    value === 'draw' ||
    value === 'pass' ||
    (typeof value === 'string' && /^branch-\d+-\d+$/.test(value))
  );
}

export function isSafeGhostMoveLog(raw: unknown): raw is Array<Record<string, unknown>> {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 500) return false;
  let previousTurn = 0;
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') return false;
    const record = entry as Record<string, unknown>;
    const turn = Number(record.turn);
    const handNumber = record.hand_number == null ? null : Number(record.hand_number);
    const scoreDelta = Number(record.score_delta ?? 0);
    const boardState = record.board_state;
    const handBefore = record.hand_before;
    const actor = record.actor;
    const tilePlayed = record.tile_played;
    const branch = record.branch;
    const forcedDraw = Boolean(record.forced_draw);
    if (!Number.isInteger(turn) || turn <= 0 || turn <= previousTurn) return false;
    if (handNumber != null && (!Number.isInteger(handNumber) || handNumber <= 0 || handNumber > 50)) {
      return false;
    }
    if (!Number.isFinite(scoreDelta) || scoreDelta < 0 || scoreDelta > 100) return false;
    if (typeof boardState !== 'string' || boardState.trim().length === 0 || boardState.length > 20000) {
      return false;
    }
    if (
      !Array.isArray(handBefore) ||
      handBefore.length > 28 ||
      handBefore.some((item) => !isGhostTileKey(item))
    ) {
      return false;
    }
    if (actor != null && actor !== 'you' && actor !== 'ghost') return false;
    if (!(tilePlayed == null || isGhostTileKey(tilePlayed))) return false;
    if (!isGhostBranch(branch)) return false;
    if (tilePlayed && !handBefore.includes(tilePlayed)) return false;
    if ((branch === 'draw' || branch === 'pass') && tilePlayed != null) return false;
    if ((branch === 'draw' || branch === 'pass') && scoreDelta !== 0) return false;
    if (forcedDraw && tilePlayed == null) return false;
    previousTurn = turn;
  }
  return true;
}

export function makeVerifiedSinglePlayerKey(userId: string, localMatchId: string): string {
  return `${userId}:${localMatchId}`;
}

export function buildGhostCompletionHash(params: {
  userId: string;
  localMatchId: string | null;
  matchId: string;
  opponentUserId: string | null;
  finalScore: number;
  opponentScore: number;
  moveLog: import('../ghost/service').GhostMoveLogEntry[];
  playerMoveLog?: import('../ghost/service').GhostMoveLogEntry[];
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        userId: params.userId,
        localMatchId: params.localMatchId,
        matchId: params.matchId,
        opponentUserId: params.opponentUserId,
        finalScore: params.finalScore,
        opponentScore: params.opponentScore,
        moveLog: params.moveLog,
        playerMoveLog: params.playerMoveLog ?? null,
      }),
    )
    .digest('hex');
}

export function toVerifiedSinglePlayerMatch(row: VerifiedSinglePlayerMatchRow): VerifiedSinglePlayerMatch {
  return {
    matchId: row.match_id,
    userId: row.user_id,
    localMatchId: row.local_match_id,
    mode: row.mode,
    opponentUserId: row.opponent_user_id,
    fritzTier: row.fritz_tier,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    completionHash: row.completion_hash,
    completionResult: row.completion_result,
    dealSnapshot: isRankedDealSnapshot(row.deal_snapshot) ? row.deal_snapshot : null,
  };
}

export function toVerifiedSinglePlayerMatchRow(
  record: VerifiedSinglePlayerMatch,
): VerifiedSinglePlayerMatchRow {
  return {
    match_id: record.matchId,
    user_id: record.userId,
    local_match_id: record.localMatchId,
    mode: record.mode,
    opponent_user_id: record.opponentUserId,
    fritz_tier: record.fritzTier,
    status: record.status,
    started_at: record.startedAt,
    completed_at: record.completedAt,
    completion_hash: record.completionHash,
    completion_result: record.completionResult,
    deal_snapshot: record.dealSnapshot,
  };
}

export function cacheVerifiedSinglePlayerMatch(record: VerifiedSinglePlayerMatch): VerifiedSinglePlayerMatch {
  verifiedSinglePlayerMatches.set(record.matchId, record);
  verifiedSinglePlayerMatchesByLocalKey.set(
    makeVerifiedSinglePlayerKey(record.userId, record.localMatchId),
    record.matchId,
  );
  return record;
}

export function isMissingVerifiedMatchesTable(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes('verified_single_player_matches') &&
    (message.includes('does not exist') ||
      message.includes('pgrst205') ||
      message.includes('schema cache') ||
      message.includes('could not find the table'))
  );
}

export function isMissingDealSnapshotColumn(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes('deal_snapshot') &&
    (message.includes('does not exist') ||
      message.includes('pgrst204') ||
      message.includes('schema cache') ||
      message.includes('could not find the'))
  );
}

export async function queryVerifiedSinglePlayerMatchByLocalKey(
  userId: string,
  localMatchId: string,
): Promise<VerifiedSinglePlayerMatch | null> {
  const key = makeVerifiedSinglePlayerKey(userId, localMatchId);
  const cachedId = verifiedSinglePlayerMatchesByLocalKey.get(key);
  if (cachedId) {
    const cached = verifiedSinglePlayerMatches.get(cachedId);
    if (cached) return cached;
  }
  if (persistentVerifiedMatchesAvailable === false) return null;
  try {
    const rows = await supabaseFetch<VerifiedSinglePlayerMatchRow[]>(
      `/rest/v1/verified_single_player_matches?select=${verifiedMatchSelect()}&user_id=eq.${encodeURIComponent(userId)}&local_match_id=eq.${encodeURIComponent(localMatchId)}&limit=1`,
      { method: 'GET' },
    );
    persistentVerifiedMatchesAvailable = true;
    const row = rows[0];
    return row ? cacheVerifiedSinglePlayerMatch(toVerifiedSinglePlayerMatch(row)) : null;
  } catch (error) {
    if (isMissingVerifiedMatchesTable(error)) {
      persistentVerifiedMatchesAvailable = false;
      console.warn('[verified-matches] persistence table missing, using in-memory fallback');
      return null;
    }
    if (isMissingDealSnapshotColumn(error) && persistentDealSnapshotColumnAvailable !== false) {
      persistentDealSnapshotColumnAvailable = false;
      return queryVerifiedSinglePlayerMatchByLocalKey(userId, localMatchId);
    }
    throw error;
  }
}

export async function queryVerifiedSinglePlayerMatchByMatchId(
  matchId: string,
): Promise<VerifiedSinglePlayerMatch | null> {
  const cached = verifiedSinglePlayerMatches.get(matchId);
  if (cached) return cached;
  if (persistentVerifiedMatchesAvailable === false) return null;
  try {
    const rows = await supabaseFetch<VerifiedSinglePlayerMatchRow[]>(
      `/rest/v1/verified_single_player_matches?select=${verifiedMatchSelect()}&match_id=eq.${encodeURIComponent(matchId)}&limit=1`,
      { method: 'GET' },
    );
    persistentVerifiedMatchesAvailable = true;
    const row = rows[0];
    return row ? cacheVerifiedSinglePlayerMatch(toVerifiedSinglePlayerMatch(row)) : null;
  } catch (error) {
    if (isMissingVerifiedMatchesTable(error)) {
      persistentVerifiedMatchesAvailable = false;
      return null;
    }
    if (isMissingDealSnapshotColumn(error) && persistentDealSnapshotColumnAvailable !== false) {
      persistentDealSnapshotColumnAvailable = false;
      return queryVerifiedSinglePlayerMatchByMatchId(matchId);
    }
    throw error;
  }
}

export async function persistVerifiedSinglePlayerMatch(
  record: VerifiedSinglePlayerMatch,
): Promise<VerifiedSinglePlayerMatch> {
  cacheVerifiedSinglePlayerMatch(record);
  if (persistentVerifiedMatchesAvailable === false) return record;
  const row = toVerifiedSinglePlayerMatchRow(record);
  const persistRow = persistentDealSnapshotColumnAvailable === false
    ? (({ deal_snapshot: _dealSnapshot, ...rest }) => rest)(row)
    : row;
  try {
    await supabaseFetch<VerifiedSinglePlayerMatchRow[]>(
      `/rest/v1/verified_single_player_matches?on_conflict=match_id`,
      {
        method: 'POST',
        headers: {
          Prefer: 'return=representation,resolution=merge-duplicates',
        },
        body: JSON.stringify([persistRow]),
      },
    );
    persistentVerifiedMatchesAvailable = true;
    return record;
  } catch (error) {
    if (isMissingVerifiedMatchesTable(error)) {
      persistentVerifiedMatchesAvailable = false;
      console.warn('[verified-matches] persistence table missing, using in-memory fallback');
      return record;
    }
    if (isMissingDealSnapshotColumn(error) && persistentDealSnapshotColumnAvailable !== false) {
      persistentDealSnapshotColumnAvailable = false;
      console.warn('[verified-matches] deal_snapshot column missing; ranked complete will fail closed');
      return persistVerifiedSinglePlayerMatch(record);
    }
    throw error;
  }
}

export async function startVerifiedSinglePlayerMatch(params: {
  userId: string;
  localMatchId: string;
  mode: 'ghost' | 'fritz';
  opponentUserId: string | null;
  fritzTier?: string | null;
  dealSnapshot?: RankedDealSnapshot | null;
}): Promise<VerifiedSinglePlayerMatch> {
  const existing = await queryVerifiedSinglePlayerMatchByLocalKey(params.userId, params.localMatchId);
  if (existing) {
    return existing;
  }

  const record: VerifiedSinglePlayerMatch = {
    matchId: randomUUID(),
    userId: params.userId,
    localMatchId: params.localMatchId,
    mode: params.mode,
    opponentUserId: params.opponentUserId,
    fritzTier: params.fritzTier ?? null,
    status: 'started',
    startedAt: new Date().toISOString(),
    completedAt: null,
    completionHash: null,
    completionResult: null,
    dealSnapshot: params.dealSnapshot ?? null,
  };
  return persistVerifiedSinglePlayerMatch(record);
}

export async function getVerifiedSinglePlayerMatch(matchId: string): Promise<VerifiedSinglePlayerMatch | null> {
  return queryVerifiedSinglePlayerMatchByMatchId(matchId);
}

export async function abandonVerifiedSinglePlayerMatch(userId: string, localMatchId: string): Promise<void> {
  const record = await queryVerifiedSinglePlayerMatchByLocalKey(userId, localMatchId);
  if (!record || record.status !== 'started') return;
  record.status = 'abandoned';
  await persistVerifiedSinglePlayerMatch(record);
}
