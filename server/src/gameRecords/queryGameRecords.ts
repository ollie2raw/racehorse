import { supabaseFetch } from '../supabaseUtils';
import type { GameRecordVerification } from './gameRecordPayload';

type GameRecordRow = {
  source_match_id: string;
  local_match_id: string | null;
  mode: 'pvf' | 'mp';
  fritz_tier: string | null;
  deal_size: number | null;
  winning_score: number | null;
  match_starter: string | null;
  deal_seed: string | null;
  result: { you: number; opponent: number; winner: 'you' | 'opponent' | null };
  /** Play vs Fritz: the ordered move list. Multiplayer: `{ kind: 'mp', version, record }`. */
  moves: unknown;
  move_count: number;
  record_version: number;
  verification: GameRecordVerification;
  played_at: string | null;
  created_at: string;
  opponent_name: string | null;
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
  mode: 'pvf' | 'mp';
  /** The opponent's display name as it was in that game (multiplayer only). */
  opponentName: string | null;
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
  moves: unknown;
  recordVersion: number;
};

const LIST_COLUMNS =
  'source_match_id,mode,opponent_name,fritz_tier,deal_size,winning_score,result,move_count,verification,played_at,created_at';
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
    opponentName: row.opponent_name ?? null,
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

/**
 * Which kinds of game a caller can open. Multiplayer records (`mp`) are only sent to a client that says it understands them (`?modes=pvf,mp`): an app build
 * from before they existed would not know how to show one, and App Store builds lag.
 */
export type GameRecordModes = { includeMultiplayer: boolean };
export const PVF_ONLY: GameRecordModes = { includeMultiplayer: false };

/** `?modes=pvf,mp` -> multiplayer included. Anything else (absent, malformed) is Play vs Fritz only. */
export function parseGameRecordModes(raw: unknown): GameRecordModes {
  const text = typeof raw === 'string' ? raw : '';
  return { includeMultiplayer: text.split(',').map((m) => m.trim()).includes('mp') };
}

const modeFilter = (modes: GameRecordModes) => (modes.includeMultiplayer ? '' : '&mode=eq.pvf');

/** Newest first. Scoped to `userId` in the query itself, never by filtering afterwards. */
export async function queryRecentGameRecords(userId: string, limit: number, modes: GameRecordModes = PVF_ONLY): Promise<GameRecordListEntry[]> {
  const rows = await supabaseFetch<GameRecordRow[]>(
    `/rest/v1/game_records?select=${LIST_COLUMNS}&user_id=eq.${encodeURIComponent(userId)}${modeFilter(modes)}&order=created_at.desc&limit=${limit}`,
    { method: 'GET' },
  );
  const records = rows ?? [];
  const reviews = await queryReviewsBySourceMatch(userId, records.map((row) => row.source_match_id));
  return records.map((row) => toGameRecordListEntry(row, reviews.get(row.source_match_id) ?? null));
}

export async function queryGameRecord(userId: string, sourceMatchId: string, modes: GameRecordModes = PVF_ONLY): Promise<GameRecordReadResult | null> {
  const rows = await supabaseFetch<GameRecordRow[]>(
    `/rest/v1/game_records?select=${FULL_COLUMNS}&user_id=eq.${encodeURIComponent(userId)}&source_match_id=eq.${encodeURIComponent(sourceMatchId)}${modeFilter(modes)}&limit=1`,
    { method: 'GET' },
  );
  const row = rows?.[0];
  if (!row) return null;
  const reviews = await queryReviewsBySourceMatch(userId, [row.source_match_id]);
  return toGameRecordReadResult(row, reviews.get(row.source_match_id) ?? null);
}
