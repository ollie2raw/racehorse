import { supabaseFetch } from '../supabaseUtils';
import type { GameReviewMode } from './gameReviewPayload';

export type GameReviewRow = {
  id: string;
  user_id: string;
  game_digest: string;
  review_engine_version: string;
  accuracy_model_version: string;
  evaluations: readonly Record<string, unknown>[];
  accuracy_model_result: Record<string, unknown>;
  mode: GameReviewMode;
  source_match_id: string | null;
  created_at: string;
};

export type GameReviewReadResult = {
  gameDigest: string;
  reviewEngineVersion: string;
  accuracyModelVersion: string;
  evaluations: readonly Record<string, unknown>[];
  accuracyModelResult: Record<string, unknown>;
  mode: GameReviewMode;
  sourceMatchId: string | null;
  createdAt: string;
  /**
   * E0d trust-boundary marker: stamped into the payload itself, not left as
   * a doc comment only -- mirrors the established LEGACY_REVIEW_EVALUATION_DISCLOSURE
   * precedent (game-review-oracle-upgrade-2026-09-13.md's Batch 0 section) of
   * wiring a trust-level disclosure into the data a consumer actually reads,
   * so a future UI can't accidentally present this as verified without a
   * structural signal telling it otherwise. See gameReviewsRoute.ts's own
   * TRUST BOUNDARY comment for the full reasoning.
   */
  source: 'client-asserted';
};

/**
 * E0d (docs/scoping/game-review-oracle-upgrade-2026-09-13.md, Phase E): the
 * read side of server-side versioned review persistence. Explicitly filters
 * by BOTH user_id and game_digest -- mirrors getDailyFritzAttemptById's exact
 * pattern (dailyFritzStore.ts:581-591) -- because supabaseFetch always
 * authenticates as service_role (supabaseUtils.ts), which bypasses RLS
 * entirely. game_reviews_select_own's RLS policy is a safety net against a
 * hypothetical future direct-client query, not live enforcement for this
 * route: the user_id filter below is the *only* thing preventing one user
 * from reading another user's row.
 *
 * Returns the latest row (by created_at) for a given game_digest, not the
 * full history -- more than one row can exist per digest if a re-analysis
 * under a newer reviewEngineVersion/accuracyModelVersion was ever persisted
 * (the idempotency key includes both version columns for exactly that
 * reason). "Latest" is the pragmatic default while nothing writes more than
 * one row per digest yet (E1 hasn't shipped a re-analysis call site) --
 * deliberately NOT extended with optional reviewEngineVersion/
 * accuracyModelVersion exact-match query params here, but the two-argument
 * signature (userId, gameDigest) leaves room to add an options object later
 * without a breaking change to existing callers.
 */
export async function queryLatestGameReview(
  userId: string,
  gameDigest: string,
): Promise<GameReviewRow | null> {
  const rows = await supabaseFetch<GameReviewRow[]>(
    `/rest/v1/game_reviews?user_id=eq.${encodeURIComponent(userId)}&game_digest=eq.${encodeURIComponent(gameDigest)}&order=created_at.desc&limit=1`,
    { method: 'GET' },
  );
  return rows[0] ?? null;
}

export function toGameReviewReadResult(row: GameReviewRow): GameReviewReadResult {
  return {
    gameDigest: row.game_digest,
    reviewEngineVersion: row.review_engine_version,
    accuracyModelVersion: row.accuracy_model_version,
    evaluations: row.evaluations,
    accuracyModelResult: row.accuracy_model_result,
    mode: row.mode,
    sourceMatchId: row.source_match_id,
    createdAt: row.created_at,
    source: 'client-asserted',
  };
}
