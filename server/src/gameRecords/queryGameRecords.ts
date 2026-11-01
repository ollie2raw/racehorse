import { supabaseFetch } from '../supabaseUtils';
import type { GameRecordVerification } from './gameRecordPayload';

type GameRecordRow = {
  source_match_id: string;
  local_match_id: string | null;
  mode: 'pvf';
  fritz_tier: string | null;
  deal_size: number | null;
  winning_score: number | null;
  match_starter: string | null;
  deal_seed: string | null;
  result: { you: number; opponent: number; winner: 'you' | 'opponent' | null };
  moves: unknown[];
  move_count: number;
  record_version: number;
  verification: GameRecordVerification;
  played_at: string | null;
  created_at: string;
};

/** What the games archive shows: no actions, no deal seed. */
export type GameRecordListEntry = {
  sourceMatchId: string;
  mode: 'pvf';
  fritzTier: string | null;
  dealSize: number | null;
  winningScore: number | null;
  result: GameRecordRow['result'];
  moveCount: number;
  verification: GameRecordVerification;
  playedAt: string | null;
  savedAt: string;
};

/** Everything needed to rebuild the game. Only ever returned to its owner. */
export type GameRecordReadResult = GameRecordListEntry & {
  localMatchId: string | null;
  matchStarter: string | null;
  dealSeed: string | null;
  moves: unknown[];
  recordVersion: number;
};

const LIST_COLUMNS =
  'source_match_id,mode,fritz_tier,deal_size,winning_score,result,move_count,verification,played_at,created_at';
const FULL_COLUMNS =
  `${LIST_COLUMNS},local_match_id,match_starter,deal_seed,moves,record_version`;

export const GAME_RECORD_LIST_DEFAULT_LIMIT = 20;
export const GAME_RECORD_LIST_MAX_LIMIT = 100;

export function clampGameRecordListLimit(raw: unknown): number {
  const value = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : NaN;
  if (!Number.isInteger(value) || value < 1) return GAME_RECORD_LIST_DEFAULT_LIMIT;
  return Math.min(value, GAME_RECORD_LIST_MAX_LIMIT);
}

export function toGameRecordListEntry(row: GameRecordRow): GameRecordListEntry {
  return {
    sourceMatchId: row.source_match_id,
    mode: row.mode,
    fritzTier: row.fritz_tier,
    dealSize: row.deal_size,
    winningScore: row.winning_score,
    result: row.result,
    moveCount: row.move_count,
    verification: row.verification,
    playedAt: row.played_at,
    savedAt: row.created_at,
  };
}

export function toGameRecordReadResult(row: GameRecordRow): GameRecordReadResult {
  return {
    ...toGameRecordListEntry(row),
    localMatchId: row.local_match_id,
    matchStarter: row.match_starter,
    dealSeed: row.deal_seed,
    moves: row.moves,
    recordVersion: row.record_version,
  };
}

/** Newest first. Scoped to `userId` in the query itself, never by filtering afterwards. */
export async function queryRecentGameRecords(userId: string, limit: number): Promise<GameRecordListEntry[]> {
  const rows = await supabaseFetch<GameRecordRow[]>(
    `/rest/v1/game_records?select=${LIST_COLUMNS}&user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=${limit}`,
    { method: 'GET' },
  );
  return (rows ?? []).map(toGameRecordListEntry);
}

export async function queryGameRecord(userId: string, sourceMatchId: string): Promise<GameRecordReadResult | null> {
  const rows = await supabaseFetch<GameRecordRow[]>(
    `/rest/v1/game_records?select=${FULL_COLUMNS}&user_id=eq.${encodeURIComponent(userId)}&source_match_id=eq.${encodeURIComponent(sourceMatchId)}&limit=1`,
    { method: 'GET' },
  );
  const row = rows?.[0];
  return row ? toGameRecordReadResult(row) : null;
}
