import { supabaseFetch } from '../supabaseUtils';
import type { GameReviewMode } from './gameReviewPayload';
import {
  parseGameReviewReplayArtifact,
  type GameReviewReplayArtifactV1,
} from './gameReviewReplayArtifact';

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
  replay_artifact: GameReviewReplayArtifactV1 | null;
};

export type GameReviewReadResult = {
  id: string;
  gameDigest: string;
  reviewEngineVersion: string;
  accuracyModelVersion: string;
  evaluations: readonly Record<string, unknown>[];
  accuracyModelResult: Record<string, unknown>;
  mode: GameReviewMode;
  sourceMatchId: string | null;
  createdAt: string;
  /**
   * F1e-5 versioned historical replay payload when present. Null/absent on
   * legacy rows — clients must not recompute Fritz for those.
   */
  replayArtifact: GameReviewReplayArtifactV1 | null;
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

export type GameReviewListEntry = {
  id: string;
  gameDigest: string;
  sourceMatchId: string | null;
  mode: GameReviewMode;
  createdAt: string;
  hasReplayArtifact: boolean;
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
 * Returns the latest row (by created_at) for a given game_digest. Prefer
 * `queryGameReviewById` when the client holds a specific review id.
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

/** Exact review-id lookup — ownership-filtered. Never returns another user's row. */
export async function queryGameReviewById(
  userId: string,
  reviewId: string,
): Promise<GameReviewRow | null> {
  const rows = await supabaseFetch<GameReviewRow[]>(
    `/rest/v1/game_reviews?user_id=eq.${encodeURIComponent(userId)}&id=eq.${encodeURIComponent(reviewId)}&limit=1`,
    { method: 'GET' },
  );
  return rows[0] ?? null;
}

/** Recent reviews for the authenticated user (history entry surface). */
export async function queryRecentGameReviews(
  userId: string,
  limit: number = 10,
): Promise<GameReviewRow[]> {
  const safeLimit = Math.max(1, Math.min(20, Math.floor(limit)));
  const rows = await supabaseFetch<GameReviewRow[]>(
    `/rest/v1/game_reviews?user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=${safeLimit}`,
    { method: 'GET' },
  );
  return rows;
}

export function toGameReviewReadResult(row: GameReviewRow): GameReviewReadResult {
  const parsed = parseGameReviewReplayArtifact(row.replay_artifact);
  const replayArtifact =
    parsed === null ? null : 'error' in parsed ? null : parsed;
  return {
    id: row.id,
    gameDigest: row.game_digest,
    reviewEngineVersion: row.review_engine_version,
    accuracyModelVersion: row.accuracy_model_version,
    evaluations: row.evaluations,
    accuracyModelResult: row.accuracy_model_result,
    mode: row.mode,
    sourceMatchId: row.source_match_id,
    createdAt: row.created_at,
    replayArtifact,
    source: 'client-asserted',
  };
}

export function toGameReviewListEntry(row: GameReviewRow): GameReviewListEntry {
  return {
    id: row.id,
    gameDigest: row.game_digest,
    sourceMatchId: row.source_match_id,
    mode: row.mode,
    createdAt: row.created_at,
    hasReplayArtifact: row.replay_artifact != null,
  };
}
