import type { MoveEntry } from '../../game/moveLogger';
import { sameTileTuple, snapshotBoardState } from '../../game/moveLogger';
import type { ReviewAction, ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';

/**
 * Match the represented decision by hand, actor, pre-action board, and action.
 * A tile can be played only once in a hand, and draw/pass decisions belong to
 * their unchanged pre-action board. This identity survives collapsed draw logs.
 * A collapsed draw represents the FIRST forced draw at that position; subsequent
 * forced draws are still evaluated by the job but have no separate UI step.
 * Legacy logs without a hand identifier retain the conservative counter check.
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
  const result = new Map<string, MoveEntry>();
  const usedMoves = new Set<number>();
  for (const snapshot of snapshots) {
    if (!snapshot.actualAction) continue;
    const candidates = moveLog.filter((entry) => {
      if (!actorMatchesMoveEntry(snapshot.identifiers.actorId, entry)
        || !actionContentMatchesMoveEntry(snapshot.actualAction, entry)) return false;
      if (entry.handNumber == null) return entry.moveNumber === snapshot.identifiers.actionNumber;
      if (entry.handNumber !== snapshot.identifiers.handNumber) return false;
      return JSON.stringify(entry.boardState) === JSON.stringify(snapshotBoardState(snapshot.preAction.board));
    });
    // Repeated forced draws share a represented step. Never replace its first
    // decision with the last draw, or assign an ambiguous play/pass evaluation.
    if (candidates.length !== 1) continue;
    const entry = candidates[0];
    if (usedMoves.has(entry.moveNumber)) continue;
    usedMoves.add(entry.moveNumber);
    result.set(snapshot.identifiers.decisionId, entry);
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
