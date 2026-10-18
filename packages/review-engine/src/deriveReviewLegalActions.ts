import { canDraw, getLegalMoves, type GameState, type Tile } from '@racehorse/game-core';
import type { ReviewAction, ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import { resolveReviewConfig } from './reviewRuleset';

/**
 * Trust boundary helper. A snapshot arriving from a client carries its own `legalActions`; the evaluator used to take that
 * list as the candidate set, so a request that left out the strongest move (or listed only the move that was played) was
 * graded against a smaller, weaker set. The legal set is a pure function of the state the snapshot records (board, actor
 * hand, opponent/boneyard COUNTS, consecutive passes, hand-open flag, stored ruleset), so the server recomputes it with the
 * engine's own `getLegalMoves` / `canDraw` instead of believing the caller.
 *
 * Opponent tiles and the boneyard are placeholders: legality for the actor depends only on how many there are.
 */
const PLACEHOLDER: Tile = { low: 0, high: 0 };

function placeholders(count: number): Tile[] {
  return Array.from({ length: count }, () => PLACEHOLDER);
}

export function deriveLegalActionsFromSnapshot(snapshot: ReviewPositionSnapshotV2): ReviewAction[] {
  const { actorId, opponentId, handNumber } = snapshot.identifiers;
  const { actorHand, board, scores, consecutivePasses, handOpen, opponentTileCount, boneyard } = snapshot.preAction;
  const config = { ...resolveReviewConfig(snapshot), deadTileCount: boneyard.deadCount };
  const state: GameState = {
    config,
    playerIds: [actorId, opponentId],
    players: {
      [actorId]: { id: actorId, hand: actorHand, score: scores.actor },
      [opponentId]: { id: opponentId, hand: placeholders(opponentTileCount), score: scores.opponent },
    },
    board,
    boneyard: placeholders(boneyard.physicalCount),
    deadTiles: placeholders(boneyard.deadCount),
    currentPlayerIndex: 0,
    handNumber,
    handOpen,
    handOver: false,
    gameOver: false,
    winnerId: null,
    consecutivePasses,
    sequence: 0,
  };
  const actions: ReviewAction[] = getLegalMoves(state, actorId).map((move) =>
    move.type === 'play' ? { kind: 'play', tile: move.tile, position: move.position } : { kind: 'pass' },
  );
  if (canDraw(state, actorId)) actions.push({ kind: 'draw' });
  return actions;
}

function actionKey(action: ReviewAction): string {
  if (action.kind !== 'play') return action.kind;
  const lo = Math.min(action.tile.low, action.tile.high);
  const hi = Math.max(action.tile.low, action.tile.high);
  return `play:${lo}-${hi}@${action.position}`;
}

export type SanitizedSnapshot =
  | { readonly ok: true; readonly snapshot: ReviewPositionSnapshotV2; readonly replacedLegalActions: boolean }
  | { readonly ok: false; readonly reason: string };

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;

/**
 * Returns the snapshot with `legalActions` replaced by the engine-derived set, or a rejection when the recorded state cannot
 * be a real decision (malformed counts, a hand that does not hold the tile played, an actual action that is not legal in the
 * recorded position). Never throws.
 */
export function sanitizeSnapshotForReview(snapshot: ReviewPositionSnapshotV2): SanitizedSnapshot {
  try {
    const pre = snapshot.preAction;
    if (!snapshot.identifiers?.actorId || !snapshot.identifiers.opponentId || !pre || !Array.isArray(pre.actorHand)
      || !snapshot.actualAction || !pre.boneyard || !pre.scores) {
      return { ok: false, reason: 'corrupt-snapshot:malformed' };
    }
    const { physicalCount, drawableCount, deadCount } = pre.boneyard;
    if (![physicalCount, drawableCount, deadCount, pre.opponentTileCount, pre.consecutivePasses].every(isCount)
      || drawableCount !== Math.max(0, physicalCount - deadCount)) {
      return { ok: false, reason: 'corrupt-snapshot:counts' };
    }
    const derived = deriveLegalActionsFromSnapshot(snapshot);
    const derivedKeys = new Set(derived.map(actionKey));
    if (derivedKeys.size !== derived.length || derived.length === 0) return { ok: false, reason: 'corrupt-snapshot:no-legal-actions' };
    if (!derivedKeys.has(actionKey(snapshot.actualAction))) return { ok: false, reason: 'corrupt-snapshot:actual-action-not-legal' };
    const claimed = snapshot.legalActions;
    const same = Array.isArray(claimed)
      && claimed.length === derived.length
      && claimed.every((action, index) => actionKey(action) === actionKey(derived[index]!));
    return { ok: true, snapshot: same ? snapshot : { ...snapshot, legalActions: derived }, replacedLegalActions: !same };
  } catch {
    return { ok: false, reason: 'corrupt-snapshot:malformed' };
  }
}
