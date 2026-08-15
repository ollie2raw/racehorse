import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { Socket } from 'socket.io-client';
import type { GameState, Move } from '../../../types';
import { drawAudit } from '../../../multiplayer/drawAudit';
import { mpPerfBeginAction, mpPerfMarkAck } from '../../../multiplayer/mpPerf';
import { emitGameAction } from '../../../multiplayer/roomTransport';
import type { MoveEntry } from '../../../game/moveLogger';
import {
  buildLogicalActionSignature,
  resolveLogicalActionRequestId,
  type LogicalGameplayAction,
} from './gameplayActionIdentity';
import { buildGameplayMoveTelemetry } from './buildGameplayMoveTelemetry';

export type UseDrawActionParams = {
  socket: Socket | null;
  joinedRoom: string | null;
  you: string;
  canDraw: boolean;
  stateRef: MutableRefObject<GameState | null>;
  legalMovesRef: MutableRefObject<Move[]>;
  pendingGameplayActionRef: MutableRefObject<{
    kind: 'play' | 'draw' | 'pass';
    baselineSequence: number;
  } | null>;
  logicalGameplayActionRef: MutableRefObject<LogicalGameplayAction | null>;
  mpAutoDrawSuppressUntilSequenceRef: MutableRefObject<number | null>;
  autoTurnActionKeyRef: MutableRefObject<string>;
  setActionError: Dispatch<SetStateAction<string>>;
  setPendingUiAction: Dispatch<
    SetStateAction<null | 'create' | 'join' | 'start' | 'draw' | 'pass' | 'play'>
  >;
  setPendingActionRefDiag: (value: boolean) => void;
  isGameplayActionBlocked: () => boolean;
  emitDraggingState: (dragging: boolean) => void;
  showToast: (message: string, duration?: number) => void;
  appendMultiplayerMove: (entry: Omit<MoveEntry, 'moveNumber'>) => void;
  markUncertainAndResync: (requestId: string, error?: string) => void;
};

/** DRAW action handler, extracted verbatim from useLiveMatchActions. */
export function useDrawAction(params: UseDrawActionParams): () => Promise<void> {
  const {
    socket,
    joinedRoom,
    you,
    canDraw,
    stateRef,
    legalMovesRef,
    pendingGameplayActionRef,
    logicalGameplayActionRef,
    mpAutoDrawSuppressUntilSequenceRef,
    autoTurnActionKeyRef,
    setActionError,
    setPendingUiAction,
    setPendingActionRefDiag,
    isGameplayActionBlocked,
    emitDraggingState,
    showToast,
    appendMultiplayerMove,
    markUncertainAndResync,
  } = params;

  return useCallback(async () => {
    setActionError('');
    const stateNow = stateRef.current;
    const legalMovesNow = legalMovesRef.current;
    const boneyardLockedNow = (stateNow?.boneyard.length ?? 0) <= 2;
    if (!socket || !joinedRoom || boneyardLockedNow || !canDraw || isGameplayActionBlocked()) {
      return;
    }
    emitDraggingState(false);
    const baselineSequence = stateNow?.sequence ?? -1;
    pendingGameplayActionRef.current = { kind: 'draw', baselineSequence };
    mpPerfBeginAction('draw', baselineSequence);
    setPendingUiAction('draw');
    setPendingActionRefDiag(true);
    const telemetry = buildGameplayMoveTelemetry({ stateNow, legalMovesNow, you });
    const handNumber = stateNow?.handNumber ?? 0;
    const signature = buildLogicalActionSignature({
      kind: 'draw',
      roomCode: joinedRoom,
      playerId: you,
      baselineSequence,
      handNumber,
    });
    const logicalAction = resolveLogicalActionRequestId({
      current: logicalGameplayActionRef.current,
      kind: 'draw',
      roomCode: joinedRoom,
      playerId: you,
      baselineSequence,
      handNumber,
      signature,
    });
    logicalGameplayActionRef.current = logicalAction;
    const requestId = logicalAction.requestId;
    const emitAt = Date.now();
    drawAudit('forced-state-detected', {
      roomCode: joinedRoom,
      playerId: you,
      handCount: telemetry.handBefore.length,
      boneyardCount: stateNow?.boneyard.length ?? 0,
      legalMoveCount: telemetry.validMoves.length,
      canDraw,
      canPass: legalMovesNow.some((m) => m.type === 'pass'),
      reason: 'no_legal_play_drawable_boneyard',
    });
    drawAudit('emit', { event: 'game:action', actionType: 'DRAW', roomCode: joinedRoom, requestId });
    try {
      const resp = await emitGameAction(socket, joinedRoom, { type: 'DRAW', requestId });
      mpPerfMarkAck(Boolean(resp?.ok), resp?.sequence);
      drawAudit('ack', {
        requestId,
        ms: Date.now() - emitAt,
        ok: Boolean(resp?.ok),
        forcedDraw: resp?.forcedDraw?.drewCount ?? 0,
        drawnCount: resp?.forcedDraw?.drewCount,
        error: resp?.error,
      });
      if (!resp?.ok) {
        if (resp?.uncertain) {
          markUncertainAndResync(requestId, resp.error ?? 'Move uncertain — resyncing.');
        } else {
          setActionError(resp?.error ?? 'Unable to draw.');
        }
        return;
      }
      if (logicalGameplayActionRef.current?.requestId === requestId) {
        logicalGameplayActionRef.current = null;
      }
      if (joinedRoom && typeof resp.sequence === 'number' && Number.isFinite(resp.sequence)) {
        mpAutoDrawSuppressUntilSequenceRef.current = resp.sequence;
        autoTurnActionKeyRef.current = '';
      }
      appendMultiplayerMove({
        player: 'you',
        action: 'draw',
        pipDelta: 0,
        pointsScored: 0,
        ...telemetry,
      });
    } catch (e) {
      mpPerfMarkAck(false);
      if (logicalGameplayActionRef.current?.requestId === requestId) {
        logicalGameplayActionRef.current = {
          ...logicalGameplayActionRef.current,
          uncertain: true,
        };
      }
      showToast(e instanceof Error ? e.message : 'Action failed', 2000);
    } finally {
      setPendingUiAction((prev) => (prev === 'draw' ? null : prev));
      setPendingActionRefDiag(false);
      pendingGameplayActionRef.current = null;
    }
  }, [
    socket,
    joinedRoom,
    you,
    canDraw,
    appendMultiplayerMove,
    emitDraggingState,
    showToast,
    isGameplayActionBlocked,
    stateRef,
    legalMovesRef,
    pendingGameplayActionRef,
    logicalGameplayActionRef,
    setPendingActionRefDiag,
    mpAutoDrawSuppressUntilSequenceRef,
    autoTurnActionKeyRef,
    setActionError,
    setPendingUiAction,
    markUncertainAndResync,
  ]);
}
