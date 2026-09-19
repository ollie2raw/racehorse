import type { ReviewEvaluationV1 } from '@racehorse/game-core/review';
import type { GameAccuracyModelResult } from '@racehorse/review-engine';
import { apiPost } from '../../api/client.ts';

export type PostGameReviewWriteBody = {
  gameDigest: string;
  reviewEngineVersion: string;
  accuracyModelVersion: string;
  evaluations: readonly ReviewEvaluationV1[];
  accuracyModelResult: GameAccuracyModelResult;
  mode: 'pvf' | 'mp';
  sourceMatchId?: string | null;
};

/**
 * E1 (docs/scoping/game-review-oracle-upgrade-2026-09-13.md, Phase E): the
 * PVF post-game write call to POST /api/game-reviews (E0c). Fire-and-forget
 * -- mirrors ingestDailyFritzNextHandDebug's isolation pattern
 * (devtools/dailyFritzDebugIngest.ts: fetch(...).catch(() => {}), never
 * returned/awaited by the caller) -- persistence failure must never affect
 * local state, the post-game prompt, or completion flow. This is
 * client-asserted, best-effort data (E0c's own TRUST BOUNDARY), not load-
 * bearing for anything the player sees.
 *
 * Uses apiPost (not a bare fetch like the debug-ingest precedent) because
 * this hits an authenticated route on this app's own server -- apiPost
 * attaches the real Supabase auth header apiClient.ts already knows how to
 * build; a bare fetch here would silently 401 every time. apiPost itself
 * already never throws (returns ApiResult, catches internally); the
 * `.catch(() => {})` below is defense-in-depth on top of that, not the only
 * thing standing between a failure and the caller.
 */
export function postGameReviewWrite(body: PostGameReviewWriteBody): void {
  void apiPost('/api/game-reviews', body).catch(() => {});
}
