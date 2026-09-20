import type { MoveEntry } from '../../game/moveLogger';
import { sameTileTuple } from '../../game/moveLogger';
import type { ReviewAction, ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';

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
 *   across both actors -- but is NOT reliably in lockstep with
 *   `MoveEntry.moveNumber`. Confirmed (2026-09-19 correctness audit) that
 *   PVF's non-Daily-Fritz multi-draw handling
 *   (`resolveTranscriptDrawLogCount` in dailyFritzDrawTranscript.ts,
 *   consumed by both `usePlayerNoMoveEffect.ts` and
 *   `botActionCompletion.ts`) deliberately collapses every real multi-draw
 *   turn into exactly ONE logged `MoveEntry`, while
 *   `recordPlayerReviewDecision`/`recordBotReviewDecision` still fires once
 *   per real draw step inside that same turn -- so `actionNumber` advances
 *   faster than `moveNumber` the moment any actor draws more than once in a
 *   turn, and the two counters permanently diverge by that turn's extra
 *   draw count for the remainder of the match. Both sequences stay dense
 *   and monotonic even after drifting, so a bare `actionNumber ===
 *   moveNumber` match does NOT fail closed on drift -- it silently returns
 *   a different real `MoveEntry` instead, which then gets rendered with
 *   another decision's oracle evaluation and coaching prose.
 *
 * `actionContentMatchesMoveEntry` below is the fix: even when the counters
 * agree, the match is only trusted if the snapshot's own recorded actor and
 * `actualAction` (draw/pass kind, or play kind + tile + position) actually
 * agree with what that `MoveEntry` claims happened. This can't perfectly
 * disambiguate two same-actor draws or two same-actor passes back to back
 * (neither carries a distinguishing payload), but it eliminates exactly the
 * class of bug traced above: a play snapshot silently absorbed by an
 * unrelated entry, or a snapshot attributed to the wrong actor. Any
 * disagreement is treated identically to "no matching moveNumber at all" --
 * omitted from the result, never paired with the wrong entry. This is
 * intentionally lossy once a match has drifted (everything downstream of
 * the drift point that can't be content-verified stays uncorrelated rather
 * than guessed), which is the correct trade for a review feature: an
 * honestly-missing evaluation, never a confidently-wrong one.
 */
function actorMatchesMoveEntry(actorId: string, entry: MoveEntry): boolean {
  return (actorId === 'you') === (entry.player === 'you');
}

function actionContentMatchesMoveEntry(action: ReviewAction, entry: MoveEntry): boolean {
  if (action.kind === 'play') {
    return (
      entry.action === 'place' &&
      sameTileTuple(entry.tile, [action.tile.low, action.tile.high]) &&
      entry.position === action.position
    );
  }
  if (action.kind === 'draw') return entry.action === 'draw';
  return entry.action === 'pass';
}

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
    if (
      entry &&
      actorMatchesMoveEntry(snapshot.identifiers.actorId, entry) &&
      actionContentMatchesMoveEntry(snapshot.actualAction, entry)
    ) {
      result.set(snapshot.identifiers.decisionId, entry);
    }
  }
  return result;
}

/**
 * The inverse direction: moveNumber -> decisionId. A rendered move (e.g.
 * GameReviewer's AnalyzedMove, which carries moveNumber but no decisionId)
 * needs this direction to look up its own worker-batch result; wraps
 * correlateSnapshotsToMoveLog rather than duplicating its matching logic.
 * Intended to be computed once per render (memoized by the caller) and
 * reused for a cheap per-move lookup, not recomputed per move.
 */
export function buildDecisionIdByMoveNumber(
  snapshots: readonly ReviewPositionSnapshotV2[],
  moveLog: readonly MoveEntry[],
): ReadonlyMap<number, string> {
  const byDecisionId = correlateSnapshotsToMoveLog(snapshots, moveLog);
  const result = new Map<number, string>();
  for (const [decisionId, entry] of byDecisionId) {
    result.set(entry.moveNumber, decisionId);
  }
  return result;
}
