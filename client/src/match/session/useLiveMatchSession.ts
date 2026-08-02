import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameState, Move, Tile } from '../../types';
import type { PreGameDrawState } from '../preGameDraw/preGameDrawLogic';
import { projectMultiplayerGameState } from '../../multiplayer/boardSnapshotGuards';
import type { RoomAckResponse } from '../../multiplayer/roomTransport';
import type {
  FlyingTile,
  HandEndedPayload,
  LiveMatchSessionApi,
  UseLiveMatchSessionParams,
} from './liveMatchSessionTypes';
import { flattenLiveMatchSessionParams } from './liveMatchSessionTypes';
import { useTransientRoomUi } from './transientUi/useTransientRoomUi';
import { useLiveMatchActions } from './actions/useLiveMatchActions';
import { useTileSelection } from './input/useTileSelection';
import { useHandRevealSequence } from './handReveal/useHandRevealSequence';
import { useLiveMatchViewModel } from './viewModel/useLiveMatchViewModel';
import { useRoomSocketSyncParams } from './roomSocketSyncParams';

export type { LiveMatchSessionApi, UseLiveMatchSessionParams } from './liveMatchSessionTypes';

export function useLiveMatchSession(inputParams: UseLiveMatchSessionParams): LiveMatchSessionApi {
  const params = flattenLiveMatchSessionParams(inputParams);
  const {
    socket,
    joinedRoom,
    you,
    isConnected,
    showToast,
    setError,
    roomRecoveryState,
    isRecoveringConnection,
    rejoinInFlightRef,
    normalizeRoomPlayers,
    applyRoomEventMeta,
    setFriendInvite,
    maxSequenceRef,
    setPlayers,
    roomPlayersRef,
    setRoomRecoveryState,
    setRoomRecoveryMessage,
    sessionRefsRuntime,
    playDrawSound,
    resyncInFlightRef,
    resyncBufferedUpdateRef,
    resyncFlushRef,
    resetClientGameSession,
    onGameStart,
    appendMultiplayerMove,
  } = params;

  const [state, setState] = useState<GameState | null>(null);
  const [legalMoves, setLegalMoves] = useState<Move[]>([]);
  const [canDraw, setCanDraw] = useState(false);
  const [pendingUiAction, setPendingUiAction] = useState<
    null | 'create' | 'join' | 'start' | 'draw' | 'pass' | 'play'
  >(null);
  const [actionError, setActionError] = useState('');
  const [handReveal, setHandReveal] = useState<HandEndedPayload | null>(null);
  const [rematchRequested, setRematchRequested] = useState(false);
  const [rematchReadyIds, setRematchReadyIds] = useState<string[]>([]);
  const [lastPlayedTile, setLastPlayedTile] = useState<Tile | null>(null);
  const [drawPulseIndex, setDrawPulseIndex] = useState<number | null>(null);
  const [boneyardDisplayCount, setBoneyardDisplayCount] = useState<number | null>(null);
  const [drawStepMyHand, setDrawStepMyHand] = useState<Tile[] | null>(null);
  const [preGameDraw, setPreGameDraw] = useState<PreGameDrawState | null>(null);
  const [drawStepActorId, setDrawStepActorId] = useState<string | null>(null);
  const [drawStepOpponentHandCount, setDrawStepOpponentHandCount] = useState<number | null>(null);
  const [drawSequenceActive, setDrawSequenceActive] = useState(false);
  const [flyingTiles, setFlyingTiles] = useState<FlyingTile[]>([]);
  const [opponentDragging, setOpponentDragging] = useState(false);
  const [opponentDisconnected, setOpponentDisconnected] = useState(false);
  const [opponentDisconnectMessage, setOpponentDisconnectMessage] = useState('');
  const [recentAutoPasses, setRecentAutoPasses] = useState<string[]>([]);

  const stateRef = useRef<GameState | null>(state);
  const legalMovesRef = useRef<Move[]>(legalMoves);
  const pendingActionRef = useRef(false);
  const pendingGameplayActionRef = useRef<{
    kind: 'play' | 'draw' | 'pass';
    baselineSequence: number;
  } | null>(null);
  const handRevealShownRef = useRef<number | null>(null);
  const handRevealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draggingStateRef = useRef(false);
  const drawSequenceActiveRef = useRef(false);
  const drawSequenceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mpAutoDrawSuppressUntilSequenceRef = useRef<number | null>(null);
  const autoTurnActionKeyRef = useRef('');
  const frozenHandOverBoardRef = useRef<{
    handNumber: number;
    board: NonNullable<GameState['board']>;
  } | null>(null);
  const rematchAwaitingStateRef = useRef(false);
  const pendingForcedHandRevealRef = useRef<{ sequence: number; fullHand: Tile[] } | null>(null);
  const flyingTileIdRef = useRef(0);
  const boneyardRef = useRef<HTMLDivElement>(null);
  const handAreaRef = useRef<HTMLDivElement>(null);
  const opponentPillRef = useRef<HTMLButtonElement>(null);
  const lastPlayedTileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const youRef = useRef(you);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    legalMovesRef.current = legalMoves;
  }, [legalMoves]);

  useEffect(() => {
    youRef.current = you;
  }, [you]);

  const currentTurnId = state?.playerIds[state.currentPlayerIndex] ?? null;
  const isMyTurnForSelection = currentTurnId === you;

  const tileSelection = useTileSelection({
    you,
    state,
    joinedRoom,
    roomRecoveryState,
    isRecoveringConnection,
    isMyTurn: isMyTurnForSelection,
    socket,
    pendingActionRef,
    draggingStateRef,
  });

  const viewModel = useLiveMatchViewModel({
    state,
    legalMoves,
    you,
    isConnected,
    joinedRoom,
    canDraw,
    selectedTile: tileSelection.selectedTile,
    roomRecoveryState,
    isRecoveringConnection,
    pendingUiAction,
    opponentDragging,
    drawStepMyHand,
    drawStepOpponentHandCount,
    boneyardDisplayCount,
    frozenHandOverBoardRef,
  });

  const transientUi = useTransientRoomUi({
    setSelectedTile: tileSelection.setSelectedTile,
    setPendingUiAction,
    setActionError,
    setOpponentDragging,
    draggingStateRef,
    pendingActionRef,
    pendingGameplayActionRef,
    drawSequenceTimeoutRef,
    drawSequenceActiveRef,
    setDrawSequenceActive,
    setHandReveal,
    setDrawStepMyHand,
    setDrawStepActorId,
    setDrawStepOpponentHandCount,
    setPreGameDraw,
    setFlyingTiles,
    lastPlayedTileTimerRef,
    setLastPlayedTile,
  });

  const actions = useLiveMatchActions({
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
    selectedTileRef: tileSelection.selectedTileRef,
    pendingActionRef,
    pendingGameplayActionRef,
    draggingStateRef,
    mpAutoDrawSuppressUntilSequenceRef,
    autoTurnActionKeyRef,
    isMutedRef: sessionRefsRuntime.isMutedRef,
    dispatchSession: sessionRefsRuntime.dispatchSession,
    schedulePlayerReadyRef: sessionRefsRuntime.schedulePlayerReadyRef,
    trySchedulePlayerReadyRef: sessionRefsRuntime.trySchedulePlayerReadyRef,
    isMyTurn: viewModel.isMyTurn,
    hasPlayMoves: viewModel.hasPlayMoves,
    canDrawNow: viewModel.canDrawNow,
    canPass: viewModel.canPass,
    myHandLength: viewModel.myHand.length,
    boneyardCount: viewModel.boneyardCount,
    setError,
    setActionError,
    setPendingUiAction,
    setRematchRequested,
    setSelectedTile: tileSelection.setSelectedTile,
    setDrawStepMyHand,
    showToast,
    onGameStart,
    appendMultiplayerMove,
    flashLastPlayed: transientUi.flashLastPlayed,
    fetchGameState: params.fetchGameState,
  });

  const handRevealSequence = useHandRevealSequence({
    socket,
    joinedRoom,
    you,
    state,
    handReveal,
    setHandReveal,
    preGameDraw,
    inGame: viewModel.inGame,
    handRevealShownRef,
    handRevealTimerRef,
    showToast,
  });

  const applyJoinResponseGameState = useCallback(
    (resp: RoomAckResponse): { ok: boolean; nextState: GameState | null } => {
      const rawState = (resp.state ?? null) as GameState | null;
      let nextState = rawState;
      if (rawState !== null) {
        const projected = projectMultiplayerGameState(rawState);
        if (!projected) {
          return { ok: false, nextState: null };
        }
        nextState = projected;
      }

      if (nextState && typeof nextState.sequence === 'number') {
        maxSequenceRef.current = nextState.sequence;
      }

      setState(nextState);
      setLegalMoves(Array.isArray(resp.legalMoves) ? (resp.legalMoves as Move[]) : []);
      setCanDraw(typeof resp.canDraw === 'boolean' ? resp.canDraw : false);
      setBoneyardDisplayCount(nextState?.boneyard?.length ?? null);
      transientUi.clearTransientRoomUi();

      return { ok: true, nextState };
    },
    [transientUi.clearTransientRoomUi, maxSequenceRef],
  );

  const roomSocketSyncParams = useRoomSocketSyncParams({
    socket,
    showToast,
    normalizeRoomPlayers,
    applyRoomEventMeta,
    setFriendInvite,
    maxSequenceRef,
    setPlayers,
    roomPlayersRef,
    fetchGameState: params.fetchGameState,
    resyncInFlightRef,
    resyncBufferedUpdateRef,
    resyncFlushRef,
    resetClientGameSession,
    rematchAwaitingStateRef,
    sessionRefsRuntime,
    setRoomRecoveryState,
    setRoomRecoveryMessage,
    setLegalMoves,
    setCanDraw,
    setOpponentDisconnected,
    setOpponentDisconnectMessage,
    setPreGameDraw,
    setDrawSequenceActiveBoth: transientUi.setDrawSequenceActiveBoth,
    setDrawStepMyHand,
    setDrawStepActorId,
    setDrawStepOpponentHandCount,
    setFlyingTiles,
    setBoneyardDisplayCount,
    setDrawPulseIndex,
    playDrawSound,
    clearPendingGameplayUiOnAuthoritativeState: transientUi.clearPendingGameplayUiOnAuthoritativeState,
    setError,
    drawSequenceActiveRef,
    drawSequenceTimeoutRef,
    boneyardRef,
    handAreaRef,
    opponentPillRef,
    youRef,
    stateRef,
    flyingTileIdRef,
    pendingForcedHandRevealRef,
    setState,
    setRecentAutoPasses,
    setOpponentDragging,
  });

  useEffect(() => {
    return () => {
      if (drawSequenceTimeoutRef.current) clearTimeout(drawSequenceTimeoutRef.current);
      if (lastPlayedTileTimerRef.current) clearTimeout(lastPlayedTileTimerRef.current);
      if (handRevealTimerRef.current) clearTimeout(handRevealTimerRef.current);
    };
  }, []);

  return {
    state,
    setState,
    legalMoves,
    setLegalMoves,
    canDraw,
    setCanDraw,
    selectedTile: tileSelection.selectedTile,
    setSelectedTile: tileSelection.setSelectedTile,
    pendingUiAction,
    setPendingUiAction,
    actionError,
    setActionError,
    handReveal,
    setHandReveal,
    rematchRequested,
    setRematchRequested,
    rematchReadyIds,
    setRematchReadyIds,
    drawStepMyHand,
    setDrawStepMyHand,
    drawStepActorId,
    setDrawStepActorId,
    drawStepOpponentHandCount,
    setDrawStepOpponentHandCount,
    flyingTiles,
    setFlyingTiles,
    drawSequenceActive,
    preGameDraw,
    opponentDragging,
    setOpponentDragging,
    opponentDisconnected,
    setOpponentDisconnected,
    opponentDisconnectMessage,
    setOpponentDisconnectMessage,
    lastPlayedTile,
    boneyardDisplayCount,
    setBoneyardDisplayCount,
    drawPulseIndex,
    setDrawPulseIndex,
    handRevealAutoProgress: handRevealSequence.handRevealAutoProgress,
    inGame: viewModel.inGame,
    isMyTurn: viewModel.isMyTurn,
    myHand: viewModel.myHand,
    opponentTileCount: viewModel.opponentTileCount,
    boneyardCount: viewModel.boneyardCount,
    hasPlayMoves: viewModel.hasPlayMoves,
    canDrawNow: viewModel.canDrawNow,
    canPass: viewModel.canPass,
    boardForDisplay: viewModel.boardForDisplay,
    boardLegalMoves: viewModel.boardLegalMoves,
    selectedTileHasLegalPlay: viewModel.selectedTileHasLegalPlay,
    boardSelectedTile: viewModel.boardSelectedTile,
    boardShowOpenEndGlow: viewModel.boardShowOpenEndGlow,
    handSelectedTile: viewModel.handSelectedTile,
    stateRef,
    legalMovesRef,
    selectedTileRef: tileSelection.selectedTileRef,
    pendingActionRef,
    pendingGameplayActionRef,
    handRevealShownRef,
    handRevealTimerRef,
    draggingStateRef,
    drawSequenceActiveRef,
    drawSequenceTimeoutRef,
    mpAutoDrawSuppressUntilSequenceRef,
    autoTurnActionKeyRef,
    frozenHandOverBoardRef,
    rematchAwaitingStateRef,
    pendingForcedHandRevealRef,
    flyingTileIdRef,
    boneyardRef,
    handAreaRef,
    opponentPillRef,
    continueAfterHandRevealRef: handRevealSequence.continueAfterHandRevealRef,
    handReadyRecoveryRef: handRevealSequence.handReadyRecoveryRef,
    lastPlayedTileTimerRef,
    youRef,
    clearTransientRoomUi: transientUi.clearTransientRoomUi,
    clearPendingGameplayUiOnAuthoritativeState: transientUi.clearPendingGameplayUiOnAuthoritativeState,
    play: actions.play,
    draw: actions.draw,
    pass: actions.pass,
    startGame: actions.startGame,
    requestRematch: actions.requestRematch,
    continueAfterHandReveal: handRevealSequence.continueAfterHandReveal,
    emitDraggingState: actions.emitDraggingState,
    isGameplayActionBlocked: actions.isGameplayActionBlocked,
    handleTileTap: tileSelection.handleTileTap,
    onPregameTileTap: tileSelection.onPregameTileTap,
    setDrawSequenceActiveBoth: transientUi.setDrawSequenceActiveBoth,
    flashLastPlayed: transientUi.flashLastPlayed,
    recentAutoPasses,
    setRecentAutoPasses,
    applyJoinResponseGameState,
    roomSocketSyncParams,
  };
}