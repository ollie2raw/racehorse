import { supabaseFetch } from '../supabaseUtils';
import {
  buildGameRecordInsertPayload,
  type GameRecordInput,
  type GameRecordVerification,
} from './gameRecordPayload';

export type InsertedGameRecordRow = {
  id: string;
  user_id: string;
  source_match_id: string;
  verification: GameRecordVerification;
};

export type InsertGameRecordResult =
  | { isNew: true; record: InsertedGameRecordRow }
  | { isNew: false; record: null };

/**
 * Inserts a game_records row idempotently on (user_id, source_match_id): ON CONFLICT DO NOTHING, so a retried or
 * double-delivered save is a no-op. An empty response means the game was already saved. The first save wins; a later
 * submission never rewrites a stored record.
 */
export async function insertGameRecordIdempotent(
  input: GameRecordInput,
  verification: GameRecordVerification,
): Promise<InsertGameRecordResult> {
  const rows = await supabaseFetch<InsertedGameRecordRow[]>(
    '/rest/v1/game_records?on_conflict=user_id,source_match_id',
    {
      method: 'POST',
      headers: { Prefer: 'return=representation,resolution=ignore-duplicates' },
      body: JSON.stringify(buildGameRecordInsertPayload(input, verification)),
    },
  );
  const record = rows?.[0];
  return record ? { isNew: true, record } : { isNew: false, record: null };
}
