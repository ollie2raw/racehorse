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

/** A game's saved review, when it has one that can be reopened (it carries its frozen explanations). */
export type GameRecordReviewSummary = {
  id: string;
  /** Overall accuracy percent, when the saved review has one. */
  accuracy: number | null;
  grade: string | null;
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
  review: GameRecordReviewSummary | null;
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

export function toGameRecordListEntry(row: GameRecordRow, review: GameRecordReviewSummary | null = null): GameRecordListEntry {
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
    review,
  };
}

export function toGameRecordReadResult(row: GameRecordRow, review: GameRecordReviewSummary | null = null): GameRecordReadResult {
  return {
    ...toGameRecordListEntry(row, review),
    localMatchId: row.local_match_id,
    matchStarter: row.match_starter,
    dealSeed: row.deal_seed,
    moves: row.moves,
    recordVersion: row.record_version,
  };
}

type ReviewLookupRow = {
  id: string;
  source_match_id: string;
  accuracy: unknown;
  grade: unknown;
};

/** Ids we mint ourselves are plain tokens; anything else is left out of the lookup rather than escaped into a filter. */
const SAFE_MATCH_ID = /^[A-Za-z0-9_.:-]{1,128}$/;

/**
 * The newest reopenable review (one that carries its replay artifact) for each of these games, joined here so the list
 * never depends on a separately capped list of reviews. Scoped to `userId` in the query itself.
 */
export async function queryReviewsBySourceMatch(
  userId: string,
  sourceMatchIds: readonly string[],
): Promise<Map<string, GameRecordReviewSummary>> {
  const ids = [...new Set(sourceMatchIds.filter((id) => SAFE_MATCH_ID.test(id)))];
  const byMatch = new Map<string, GameRecordReviewSummary>();
  if (ids.length === 0) return byMatch;
  const inList = ids.map((id) => encodeURIComponent(`"${id}"`)).join(',');
  const rows = await supabaseFetch<ReviewLookupRow[]>(
    `/rest/v1/game_reviews?select=id,source_match_id,accuracy:accuracy_model_result->accuracy,grade:accuracy_model_result->grade`
      + `&user_id=eq.${encodeURIComponent(userId)}&replay_artifact=not.is.null&source_match_id=in.(${inList})&order=created_at.desc`,
    { method: 'GET' },
  );
  for (const row of rows ?? []) {
    if (byMatch.has(row.source_match_id)) continue; // newest first: keep the first
    byMatch.set(row.source_match_id, {
      id: row.id,
      accuracy: typeof row.accuracy === 'number' && Number.isFinite(row.accuracy) ? row.accuracy : null,
      grade: typeof row.grade === 'string' ? row.grade : null,
    });
  }
  return byMatch;
}

/** Newest first. Scoped to `userId` in the query itself, never by filtering afterwards. */
export async function queryRecentGameRecords(userId: string, limit: number): Promise<GameRecordListEntry[]> {
  const rows = await supabaseFetch<GameRecordRow[]>(
    `/rest/v1/game_records?select=${LIST_COLUMNS}&user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=${limit}`,
    { method: 'GET' },
  );
  const records = rows ?? [];
  const reviews = await queryReviewsBySourceMatch(userId, records.map((row) => row.source_match_id));
  return records.map((row) => toGameRecordListEntry(row, reviews.get(row.source_match_id) ?? null));
}

export async function queryGameRecord(userId: string, sourceMatchId: string): Promise<GameRecordReadResult | null> {
  const rows = await supabaseFetch<GameRecordRow[]>(
    `/rest/v1/game_records?select=${FULL_COLUMNS}&user_id=eq.${encodeURIComponent(userId)}&source_match_id=eq.${encodeURIComponent(sourceMatchId)}&limit=1`,
    { method: 'GET' },
  );
  const row = rows?.[0];
  if (!row) return null;
  const reviews = await queryReviewsBySourceMatch(userId, [row.source_match_id]);
  return toGameRecordReadResult(row, reviews.get(row.source_match_id) ?? null);
}
