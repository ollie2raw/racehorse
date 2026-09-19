import type { GameState, Move, Tile } from '../../../types';
import {
  cloneBoardState,
  snapshotBoardState,
  toTileTuple,
} from '../../../game/moveLogger';
import { getBoardEnds } from '../../boardSessionUtils';
import { captureMultiplayerReviewSnapshot } from '../../../multiplayer/multiplayerReviewSnapshot';
import type { ReviewAction } from '@racehorse/game-core/review';

/**
 * Shared "before the action" snapshot used by draw/pass/play when building
 * their appendMultiplayerMove payload. Extracted verbatim (same call order
 * and inputs) from useLiveMatchActions so DRAW/PASS/MOVE telemetry is
 * unchanged.
 */
export function buildGameplayMoveTelemetry(params: {
  stateNow: GameState | null;
  legalMovesNow: Move[];
  you: string;
  reviewAction?: ReviewAction;
  reviewSessionId?: string;
  reviewGameId?: string;
  reviewActionNumber?: number;
}) {
  const { stateNow, legalMovesNow, you } = params;
  const boardEnds = getBoardEnds(stateNow?.board ?? null);
  const handBefore = (stateNow?.players[you]?.hand ?? []).map(toTileTuple);
  const validMoves = legalMovesNow
    .filter((m) => m.type === 'play' && m.tile)
    .map((m) => toTileTuple(m.tile as Tile));
  let reviewSnapshot;
  if (stateNow && params.reviewAction && params.reviewSessionId && params.reviewGameId && params.reviewActionNumber) {
    try {
      reviewSnapshot = captureMultiplayerReviewSnapshot({
        state: stateNow,
        actorId: you,
        action: params.reviewAction,
        sessionId: params.reviewSessionId,
        gameId: params.reviewGameId,
        actionNumber: params.reviewActionNumber,
      });
    } catch {
      // Review capture is observability/UI enrichment; never block a live move.
      reviewSnapshot = undefined;
    }
  }
  return {
    boardEnds,
    handBefore,
    validMoves,
    boardState: snapshotBoardState(stateNow?.board ?? null),
    boardRenderState: cloneBoardState(stateNow?.board ?? null),
    handSnapshot: handBefore,
    // E5: MP review no longer treats the pip/setup heuristic as oracle truth.
    engineBestMove: null,
    reviewSnapshot,
  };
}
