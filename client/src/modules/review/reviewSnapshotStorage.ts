import type { ReviewPositionSnapshotV2 } from '@racehorse/game-core/reviewContracts';

/**
 * A6 (game-review-oracle-upgrade-2026-09-13.md): session-local persistence of
 * the current game's review snapshots — RAM already lives in
 * ReviewSnapshotRecorder; this lets it survive a page refresh within the same
 * session. Deliberately a single current-session value, not an accumulating
 * history list like the sibling racehorse_move_analysis_history_v1 /
 * racehorse_pivotal_review_sessions_v1 stores — a full match's snapshots run
 * to several hundred KB (each ReviewPositionSnapshotV2 carries full board
 * state, ~1.5-6.7KB serialized depending on board depth), so capping a growing
 * list the way those two stores do would risk the localStorage quota. Each
 * snapshot already carries its own sessionId/gameId/decisionId under
 * `identifiers`, so no wrapper envelope is needed here.
 *
 * Written once, at game-over (mirrors where usePostGamePivotalReview already
 * reads getSnapshots() for analysis) and cleared once, at rematch (mirrors
 * where useMatchNavigation.ts already clears the in-memory recorder) — no
 * mid-game writes. Not yet read by any UI; that's a future step, not this one.
 */
export const REVIEW_SNAPSHOTS_STORAGE_KEY = 'racehorse_review_snapshots_v1';

export function saveReviewSnapshots(snapshots: readonly ReviewPositionSnapshotV2[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(REVIEW_SNAPSHOTS_STORAGE_KEY, JSON.stringify(snapshots));
  } catch {
    // Ignore quota / serialization failures — review still completes in-session.
  }
}

export function loadReviewSnapshots(): ReviewPositionSnapshotV2[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(REVIEW_SNAPSHOTS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function clearReviewSnapshots(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(REVIEW_SNAPSHOTS_STORAGE_KEY);
  } catch {
    // Ignore — nothing to reopen either way.
  }
}
