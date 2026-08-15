import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { Socket } from 'socket.io-client';
import type { GameState, Move, PlacementPosition, Tile } from '../../../types';
import type { MoveEntry } from '../../../game/moveLogger';
import type { FlyingTile } from '../liveMatchSessionTypes';
import type { RoomRecoveryState } from '../../../multiplayer/protocol';
import type { SessionEvent } from '../../../multiplayer/session/sessionTypes';
import { emitDraggingState as emitDraggingStateFn } from './emitDraggingState';
import {
  shouldClearLogicalActionForState,
  type LogicalGameplayAction,
} from './gameplayActionIdentity';
import { useGameplayBlockDiagnostics } from './gameplayBlockDiagnostics';
import { useAutoTurnEffect } from './useAutoTurnEffect';
import { useStartGameAndRematch } from './useStartGameAndRematch';
import { useDrawAction } from './useDrawAction';
import { usePassAction } from './usePassAction';
import { usePlayAction } from './usePlayAction';
import {
  recordUncertainActionAck,
  recordUncertainActionResync,
} from '../../../multiplayer/mpTelemetry';

export type UseLiveMatchActionsParams = {
  socket: Socket | null;
  joinedRoom: string | null;
  you: string;
  state: GameState | null;
  legalMoves: Move[];
  canDraw: boolean;
  roomRecoveryState: RoomRecoveryState;
  isRecoveringConnection: boolean;
  rejoinInFlightRef: MutableRefObject<boolean>;
  pendingUiAction: null | 'create' | 'join' | 'start' | 'draw' | 'pass' | 'play';
  drawSequenceActive: boolean;
  flyingTiles: FlyingTile[];
  rematchRequested: boolean;
  stateRef: MutableRefObject<GameState | null>;
  legalMovesRef: MutableRefObject<Move[]>;
  selectedTileRef: MutableRefObject<Tile | null>;
  pendingActionRef: MutableRefObject<boolean>;
  pendingGameplayActionRef: MutableRefObject<{
    kind: 'play' | 'draw' | 'pass';
    baselineSequence: number;
  } | null>;
  logicalGameplayActionRef?: MutableRefObject<LogicalGameplayAction | null>;
  draggingStateRef: MutableRefObject<boolean>;
  mpAutoDrawSuppressUntilSequenceRef: MutableRefObject<number | null>;
  autoTurnActionKeyRef: MutableRefObject<string>;
  isMutedRef: MutableRefObject<boolean>;
  dispatchSession: (event: SessionEvent) => void;
  schedulePlayerReadyRef: MutableRefObject<() => Promise<void>>;
  trySchedulePlayerReadyRef: MutableRefObject<() => void>;
  isMyTurn: boolean;
  hasPlayMoves: boolean;
  canDrawNow: boolean;
  canPass: boolean;
  myHandLength: number;
  boneyardCount: number;
  setError: Dispatch<SetStateAction<string>>;
  setActionError: Dispatch<SetStateAction<string>>;
  setPendingUiAction: Dispatch<
    SetStateAction<null | 'create' | 'join' | 'start' | 'draw' | 'pass' | 'play'>
  >;
  setRematchRequested: Dispatch<SetStateAction<boolean>>;
  setSelectedTile: Dispatch<SetStateAction<Tile | null>>;
  setDrawStepMyHand: Dispatch<SetStateAction<Tile[] | null>>;
  showToast: (message: string, duration?: number) => void;
  onGameStart: () => void;
  appendMultiplayerMove: (entry: Omit<MoveEntry, 'moveNumber'>) => void;
  flashLastPlayed: (tile: Tile | null) => void;
  /** Authority resync when server returns uncertain after mutate-then-persist failure. */
  fetchGameState?: (reason: string) => Promise<boolean>;
};

export type UseLiveMatchActionsResult = {
  play: (position: PlacementPosition) => Promise<void>;
  draw: () => Promise<void>;
  pass: () => Promise<void>;
  startGame: () => Promise<void>;
  requestRematch: () => void;
  emitDraggingState: (dragging: boolean) => void;
  isGameplayActionBlocked: () => boolean;
};

export function useLiveMatchActions(params: UseLiveMatchActionsParams): UseLiveMatchActionsResult {
  const {
    socket,
    joinedRoom,
    you,
    state,
    legalMoves,
    canDraw,
    roomRecoveryState,
    isRecoveringConnection,
    rejoinInFlightRef,
    pendingUiAction,
    drawSequenceActive,
    flyingTiles,
    rematchRequested,
    stateRef,
    legalMovesRef,
    selectedTileRef,
    pendingActionRef,
    pendingGameplayActionRef,
    logicalGameplayActionRef: providedLogicalGameplayActionRef,
    draggingStateRef,
    mpAutoDrawSuppressUntilSequenceRef,
    autoTurnActionKeyRef,
    isMutedRef,
    dispatchSession,
    schedulePlayerReadyRef,
    trySchedulePlayerReadyRef,
    isMyTurn,
    hasPlayMoves,
    canDrawNow,
    canPass,
    myHandLength,
    boneyardCount,
    setError,
    setActionError,
    setPendingUiAction,
    setRematchRequested,
    setSelectedTile,
    setDrawStepMyHand,
    showToast,
    onGameStart,
    appendMultiplayerMove,
    flashLastPlayed,
    fetchGameState,
  } = params;

  const emitDraggingState = useCallback(
    (dragging: boolean) => {
      emitDraggingStateFn({
        socket,
        joinedRoom,
        state,
        you,
        dragging,
        draggingStateRef,
      });
    },
    [socket, joinedRoom, state, you, draggingStateRef],
  );

  const ownedLogicalGameplayActionRef = useRef<LogicalGameplayAction | null>(null);
  const logicalGameplayActionRef = providedLogicalGameplayActionRef ?? ownedLogicalGameplayActionRef;

  const markUncertainAndResync = useCallback(
    (requestId: string, error?: string) => {
      if (logicalGameplayActionRef.current?.requestId === requestId) {
        logicalGameplayActionRef.current = {
          ...logicalGameplayActionRef.current,
          uncertain: true,
        };
      }
      recordUncertainActionAck('game:action', { requestId, error });
      recordUncertainActionResync('game_action_uncertain', { requestId });
      void fetchGameState?.('game_action_uncertain');
      if (error) {
        showToast(error, 2500);
      }
    },
    [fetchGameState, logicalGameplayActionRef, showToast],
  );

  const {
    isGameplayActionBlocked,
    diagnoseGameplayBlockReason,
    blockConditionAgeMs,
    setPendingActionRefDiag,
  } = useGameplayBlockDiagnostics({
    socket,
    joinedRoom,
    you,
    state,
    roomRecoveryState,
    isRecoveringConnection,
    rejoinInFlightRef,
    pendingUiAction,
    drawSequenceActive,
    flyingTiles,
    pendingActionRef,
    showToast,
  });

  useEffect(() => {
    if (
      shouldClearLogicalActionForState(
        logicalGameplayActionRef.current,
        state,
        joinedRoom,
      )
    ) {
      logicalGameplayActionRef.current = null;
    }
  }, [state?.sequence, state?.handNumber, state?.gameOver, state?.handOver, joinedRoom, logicalGameplayActionRef]);

  const { startGame, requestRematch } = useStartGameAndRematch({
    socket,
    joinedRoom,
    state,
    rematchRequested,
    dispatchSession,
    schedulePlayerReadyRef,
    trySchedulePlayerReadyRef,
    setError,
    setActionError,
    setPendingUiAction,
    setRematchRequested,
    showToast,
    onGameStart,
  });

  const draw = useDrawAction({
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
  });

  const pass = usePassAction({
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
  });

  const play = usePlayAction({
    socket,
    joinedRoom,
    you,
    stateRef,
    legalMovesRef,
    selectedTileRef,
    pendingActionRef,
    pendingGameplayActionRef,
    logicalGameplayActionRef,
    mpAutoDrawSuppressUntilSequenceRef,
    autoTurnActionKeyRef,
    isMutedRef,
    drawSequenceActive,
    flyingTiles,
    pendingUiAction,
    roomRecoveryState,
    isRecoveringConnection,
    rejoinInFlightRef,
    setActionError,
    setPendingUiAction,
    setSelectedTile,
    setDrawStepMyHand,
    setPendingActionRefDiag,
    isGameplayActionBlocked,
    diagnoseGameplayBlockReason,
    blockConditionAgeMs,
    emitDraggingState,
    showToast,
    appendMultiplayerMove,
    flashLastPlayed,
    markUncertainAndResync,
  });

  useAutoTurnEffect({
    state,
    joinedRoom,
    you,
    isMyTurn,
    hasPlayMoves,
    canDrawNow,
    canPass,
    myHandLength,
    boneyardCount,
    legalMoves,
    canDraw,
    roomRecoveryState,
    isRecoveringConnection,
    pendingActionRef,
    mpAutoDrawSuppressUntilSequenceRef,
    autoTurnActionKeyRef,
    draw,
    pass,
  });

  return {
    play,
    draw,
    pass,
    startGame,
    requestRematch,
    emitDraggingState,
    isGameplayActionBlocked,
  };
}
