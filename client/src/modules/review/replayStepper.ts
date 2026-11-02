import type { ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import { snapshotBoardState, toTileTuple, type MoveEntry } from '../../game/moveLogger.ts';
import {
  applyPlayMove,
  drawOne,
  passTurn,
  type BotMatchState,
  type BotPlayerId,
} from '../match/runtime/botEngine.ts';
import { observeActorDrawPastOpenEnds, observeActorPassOnOpenEnds } from './missingPipEvidenceAccumulate.ts';
import { ReviewSnapshotRecorder, type ReviewActorAction } from './ReviewSnapshotRecorder.ts';

/**
 * One replayed action, exactly as the live match does it: attach the public evidence the turn stack attaches, capture the decision at the true pre-action
 * boundary, apply it through the engine, and log one move row (a run of draws by the same seat in the same hand is one row, as production logs it).
 *
 * Shared by the Play vs Fritz rebuild (`rebuildGameFromRecord`) and the multiplayer rebuild (`rebuildMultiplayerGameFromRecord`), so a saved game of either kind
 * reaches the review pipeline in the same shape.
 */
export type StepResult = { ok: true; state: BotMatchState } | { ok: false; detail: string };

export type ReplayStepper = {
  step: (state: BotMatchState, actor: BotPlayerId, action: ReviewActorAction) => StepResult;
  readonly moveLog: MoveEntry[];
  readonly snapshots: ReviewPositionSnapshotV2[];
  readonly recorder: ReviewSnapshotRecorder;
};

export function createReplayStepper(sourceMatchId: string): ReplayStepper {
  const recorder = new ReviewSnapshotRecorder({ sessionId: sourceMatchId, gameId: sourceMatchId });
  const moveLog: MoveEntry[] = [];
  const snapshots: ReviewPositionSnapshotV2[] = [];
  let moveNumber = 0;
  let previous: { actor: BotPlayerId; kind: ReviewActorAction['kind']; hand: number } | null = null;

  const step: ReplayStepper['step'] = (state, actor, action) => {
    // The same public evidence the live turn stack attaches before a draw or a pass.
    let current = state;
    if (action.kind === 'draw') current = observeActorDrawPastOpenEnds(current, actor);
    if (action.kind === 'pass') current = observeActorPassOnOpenEnds(current, actor);

    const pre = current;
    const snapshot = recorder.recordActorDecision(pre, actor, action, true);
    if (!snapshot) {
      const failure = recorder.getCaptureFailures().at(-1);
      return { ok: false, detail: `A decision could not be captured${failure ? `: ${failure.reason}` : '.'}` };
    }
    snapshots.push(snapshot);

    const result = action.kind === 'play'
      ? applyPlayMove(pre, actor, { type: 'play', tile: action.tile, position: action.position })
      : action.kind === 'draw' ? drawOne(pre, actor) : passTurn(pre, actor);
    if ('error' in result && result.error) {
      return { ok: false, detail: `An action was not legal from the replayed position: ${String((result.error as { message?: unknown }).message ?? result.error)}` };
    }

    // One row per decision as production logs it: a run of draws by the same seat in the same hand is one row.
    const continuesDrawRun = action.kind === 'draw' && previous?.kind === 'draw' && previous.actor === actor && previous.hand === pre.handNumber;
    previous = { actor, kind: action.kind, hand: pre.handNumber };
    if (!continuesDrawRun) {
      moveNumber += 1;
      const hand = pre.players[actor].hand.map((t) => toTileTuple(t));
      const plays = snapshot.legalActions.flatMap((legal) => (legal.kind === 'play' ? [toTileTuple(legal.tile)] : []));
      moveLog.push({
        moveNumber,
        handNumber: pre.handNumber,
        player: actor === 'you' ? 'you' : 'opponent',
        action: action.kind === 'play' ? 'place' : action.kind,
        ...(action.kind === 'play' ? { tile: toTileTuple(action.tile), position: action.position } : {}),
        boardEnds: [-1, -1],
        handBefore: hand,
        validMoves: action.kind === 'play' ? plays : [],
        pipDelta: 0,
        pointsScored: action.kind === 'play' ? snapshot.outcome.immediatePoints : 0,
        boardState: snapshotBoardState(pre.board),
        boardRenderState: pre.board,
        handSnapshot: hand,
        engineBestMove: null,
      });
    }
    return { ok: true, state: result.state };
  };

  return { step, moveLog, snapshots, recorder };
}
