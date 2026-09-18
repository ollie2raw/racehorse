import { supabaseFetch } from '../supabaseUtils';
import { buildGameReviewInsertPayload, type GameReviewInsertInput } from './gameReviewPayload';

export type InsertedGameReviewRow = {
  id: string;
  user_id: string;
  game_digest: string;
  review_engine_version: string;
  accuracy_model_version: string;
};

export type InsertGameReviewResult =
  | { isNew: true; review: InsertedGameReviewRow }
  | { isNew: false; review: null };

/**
 * Inserts a game_reviews row idempotently on the full (user_id, game_digest,
 * review_engine_version, accuracy_model_version) key -- ON CONFLICT DO NOTHING
 * (via ignore-duplicates), empty response means a duplicate submission under
 * the exact same version pair. Deliberately includes both version columns in
 * the conflict target (E0b/E0a): a re-analysis under a newer
 * accuracy_model_version or review_engine_version inserts a new row rather
 * than being silently deduped against a differently-versioned one -- this is
 * what "versioned" persistence exists to guarantee, mirroring
 * insertRankedGameIdempotent.ts's on_conflict pattern (ENGINEERING_GUARDRAILS.md §3).
 */
export async function insertGameReviewIdempotent(
  input: GameReviewInsertInput,
): Promise<InsertGameReviewResult> {
  const payload = buildGameReviewInsertPayload(input);

  const rows = await supabaseFetch<InsertedGameReviewRow[]>(
    '/rest/v1/game_reviews?on_conflict=user_id,game_digest,review_engine_version,accuracy_model_version',
    {
      method: 'POST',
      headers: {
        Prefer: 'return=representation,resolution=ignore-duplicates',
      },
      body: JSON.stringify(payload),
    },
  );

  const review = rows?.[0];
  if (!review) {
    return { isNew: false, review: null };
  }
  return { isNew: true, review };
}
