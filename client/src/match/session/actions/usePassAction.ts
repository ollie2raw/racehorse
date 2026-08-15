import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { Socket } from 'socket.io-client';
import type { GameState, Move } from '../../../types';
import { mpPerfBeginAction, mpPerfMarkAck } from '../../../multiplayer/mpPerf';
import { emitGameAction } from '../../../multiplayer/roomTransport';
import type { MoveEntry } from '../../../game/moveLogger';
import {
  buildLogicalActionSignature,
  resolveLogicalActionRequestId,
  type LogicalGameplayAction,
} from './gameplayActionIdentity';
import { buildGameplayMoveTelemetry } from './buildGameplayMoveTelemetry';

export type UsePassActionParams = {
  socket: Socket | null;
  joinedRoom: string | null;
  you: string;
  stateRef: MutableRefObject<GameState | null>;
  legalMovesRef: MutableRefObject<Move[]>;
  pendingGameplayActionRef: MutableRefObject<{
    kind: 'play' | 'draw' | 'pass';
    baselineSequence: number;
  } | null>;
  logicalGameplayActionRef: MutableRefObject<LogicalGameplayAction | null>;
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

/** PASS action handler, extracted verbatim from useLiveMatchActions. */
export function usePassAction(params: UsePassActionParams): () => Promise<void> {
  const {
    socket,
    joinedRoom,
    you,
    stateRef,
    legalMovesRef,
    pendingGameplayActionRef,
    logicalGameplayActionRef,
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
    const hasPassMove = legalMovesNow.some((m) => m.type === 'pass');
    if (!socket || !joinedRoom || !hasPassMove || isGameplayActionBlocked()) return;
    emitDraggingState(false);
    const baselineSequence = stateNow?.sequence ?? -1;
    pendingGameplayActionRef.current = { kind: 'pass', baselineSequence };
    mpPerfBeginAction('pass', baselineSequence);
    setPendingUiAction('pass');
    setPendingActionRefDiag(true);
    const telemetry = buildGameplayMoveTelemetry({ stateNow, legalMovesNow, you });
    const handNumber = stateNow?.handNumber ?? 0;
    const signature = buildLogicalActionSignature({
      kind: 'pass',
      roomCode: joinedRoom,
      playerId: you,
      baselineSequence,
      handNumber,
    });
    const logicalAction = resolveLogicalActionRequestId({
      current: logicalGameplayActionRef.current,
      kind: 'pass',
      roomCode: joinedRoom,
      playerId: you,
      baselineSequence,
      handNumber,
      signature,
    });
    logicalGameplayActionRef.current = logicalAction;
    const requestId = logicalAction.requestId;
    try {
      const resp = await emitGameAction(socket, joinedRoom, { type: 'PASS', requestId });
      mpPerfMarkAck(Boolean(resp?.ok), resp?.sequence);
      if (!resp?.ok) {
        if (resp?.uncertain) {
          markUncertainAndResync(requestId, resp.error ?? 'Pass uncertain — resyncing.');
        } else {
          setActionError(resp?.error ?? 'Unable to pass.');
        }
        return;
      }
      if (logicalGameplayActionRef.current?.requestId === requestId) {
        logicalGameplayActionRef.current = null;
      }
      appendMultiplayerMove({
        player: 'you',
        action: 'pass',
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
      setPendingUiAction((prev) => (prev === 'pass' ? null : prev));
      setPendingActionRefDiag(false);
      pendingGameplayActionRef.current = null;
    }
  }, [
    socket,
    joinedRoom,
    you,
    appendMultiplayerMove,
    emitDraggingState,
    showToast,
    isGameplayActionBlocked,
    stateRef,
    legalMovesRef,
    pendingGameplayActionRef,
    logicalGameplayActionRef,
    setPendingActionRefDiag,
    setActionError,
    setPendingUiAction,
    markUncertainAndResync,
  ]);
}
