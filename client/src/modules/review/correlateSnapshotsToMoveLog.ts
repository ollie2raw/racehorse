import type { MoveEntry } from '../../game/moveLogger';
import type { ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';

/**
 * Correlates review snapshots (and, transitively, worker results keyed by
 * `decisionId`) back to the moveLog entry each one belongs to.
 *
 * This is the first time anything in the app has used `reviewSnapshots`
 * for more than a presence check (moveAnalyzer.ts's own comment: "Per-
 * decision correlation between a MoveEntry and its ReviewPositionSnapshotV2
 * is Phase B (oracle) work"), so the matching key was chosen deliberately,
 * not assumed:
 *
 * - `MoveEntry.authorityPreStateDigest` is NOT usable here -- traced its
 *   only two call sites (botActionCompletion.ts, botThinkingFallback.ts)
 *   and both populate it via `getDailyFritzAuthorityStateDigest`, a
 *   different hash function/format than review-engine's own
 *   `getReviewAuthorityStateDigest` (`review-state-v1:<hex>`). The two
 *   digests are not comparable.
 * - `ReviewSnapshotRecorder`'s `actionNumber` (embedded in
 *   `snapshot.identifiers.decisionId` as `${sessionId}:${actorId}:
 *   ${actionNumber}`, and separately on `snapshot.identifiers.actionNumber`)
 *   is a 1-based counter incremented once per captured decision, shared
 *   across both actors. Traced one full call site
 *   (usePlayerPlacementHandler.ts): `appendMove` (which assigns
 *   `MoveEntry.moveNumber`) and `recordPlayerReviewDecision` (which drives
 *   the recorder's `actionNumber`) fire back-to-back in the same handler,
 *   same event, for the same decision -- confirming `moveNumber` and
 *   `actionNumber` are in lockstep for that path. Not every actor/action-
 *   kind combination was individually traced, so this function matches by
 *   value by design rather than assuming index alignment: any snapshot
 *   whose `actionNumber` doesn't have a matching `moveNumber` in this
 *   moveLog (e.g. review capture was toggled mid-match, or an untraced
 *   path drifts) is simply omitted from the result -- never paired with
 *   the wrong entry.
 */
export function correlateSnapshotsToMoveLog(
  snapshots: readonly ReviewPositionSnapshotV2[],
  moveLog: readonly MoveEntry[],
): ReadonlyMap<string, MoveEntry> {
  const moveEntryByNumber = new Map<number, MoveEntry>();
  for (const entry of moveLog) {
    moveEntryByNumber.set(entry.moveNumber, entry);
  }

  const result = new Map<string, MoveEntry>();
  for (const snapshot of snapshots) {
    const entry = moveEntryByNumber.get(snapshot.identifiers.actionNumber);
    if (entry) {
      result.set(snapshot.identifiers.decisionId, entry);
    }
  }
  return result;
}
