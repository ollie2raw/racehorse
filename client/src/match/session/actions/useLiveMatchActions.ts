import { useCallback, useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { Socket } from 'socket.io-client';
import type { GameState, Move, PlacementPosition, Tile } from '../../../types';
import { playTileSound } from '../../../utils/sound';
import { drawAudit, nextDrawRequestId } from '../../../multiplayer/drawAudit';
import {
  mpPerfBeginAction,
  mpPerfMarkAck,
} from '../../../multiplayer/mpPerf';
import {
  cloneBoardState,
  nextEndsForTile,
  pickEngineBestMove,
  snapshotBoardState,
  toTileTuple,
} from '../../../game/moveLogger';
import {
  emitGameAction,
  emitGameRematch,
  emitGameStart,
} from '../../../multiplayer/roomTransport';
import { getBoardEnds } from '../../boardSessionUtils';
import type { MoveEntry } from '../../../game/moveLogger';
import type { FlyingTile } from '../liveMatchSessionTypes';
import type { RoomRecoveryState } from '../../../multiplayer/protocol';
import type { SessionEvent } from '../../../multiplayer/session/sessionTypes';
import { tileEquals } from '../../../game/tileUtils';
import { emitDraggingState as emitDraggingStateFn } from './emitDraggingState';

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

  const isGameplayActionBlocked = useCallback(() => {
    if (!socket || !joinedRoom || !state || !you) return true;
    if (
      !socket.connected ||
      roomRecoveryState !== 'idle' ||
      isRecoveringConnection ||
      rejoinInFlightRef.current
    ) {
      showToast('Reconnecting...', 1200);
      return true;
    }
    if (pendingActionRef.current || drawSequenceActive || flyingTiles.length > 0) return true;
    if (pendingUiAction === 'draw' || pendingUiAction === 'pass' || pendingUiAction === 'play') {
      return true;
    }
    if (state.handOver || state.gameOver) return true;
    if (!state.playerIds.includes(you)) return true;
    return state.playerIds[state.currentPlayerIndex] !== you;
  }, [
    socket,
    joinedRoom,
    state,
    you,
    roomRecoveryState,
    isRecoveringConnection,
    rejoinInFlightRef,
    pendingUiAction,
    showToast,
    drawSequenceActive,
    flyingTiles,
    pendingActionRef,
  ]);

  const startGame = useCallback(async () => {
    setError('');
    setActionError('');
    if (!socket || !joinedRoom) return setError('Not in a room.');
    setPendingUiAction('start');
    onGameStart();
    try {
      const resp = await emitGameStart(socket, joinedRoom);
      if (!resp?.ok) {
        if (resp?.error === 'waiting_for_ready') {
          dispatchSession({ type: 'ROOM_REQUEST_READY' });
          void schedulePlayerReadyRef.current();
          trySchedulePlayerReadyRef.current();
          return setError('waiting_for_ready');
        }
        return setError(resp?.error ?? 'Unable to start game.');
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Action failed', 2000);
    } finally {
      setPendingUiAction((prev) => (prev === 'start' ? null : prev));
    }
  }, [
    socket,
    joinedRoom,
    setError,
    showToast,
    onGameStart,
    dispatchSession,
    schedulePlayerReadyRef,
    trySchedulePlayerReadyRef,
    setActionError,
    setPendingUiAction,
  ]);

  const requestRematch = useCallback(() => {
    if (!socket || !joinedRoom || !state?.gameOver || rematchRequested) return;
    setRematchRequested(true);
    emitGameRematch(socket, joinedRoom, (resp) => {
      if (!resp?.ok) {
        setRematchRequested(false);
        showToast(resp?.error ?? 'Rematch failed.');
        return;
      }
      if (resp?.started) {
        setRematchRequested(false);
      }
    });
  }, [socket, joinedRoom, state?.gameOver, rematchRequested, showToast, setRematchRequested]);

  const draw = useCallback(async () => {
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
    pendingActionRef.current = true;
    const boardEnds = getBoardEnds(stateNow?.board ?? null);
    const handBefore = (stateNow?.players[you]?.hand ?? []).map(toTileTuple);
    const validMoves = legalMovesNow
      .filter((m) => m.type === 'play' && m.tile)
      .map((m) => toTileTuple(m.tile as Tile));
    const requestId = nextDrawRequestId();
    const emitAt = Date.now();
    drawAudit('forced-state-detected', {
      roomCode: joinedRoom,
      playerId: you,
      handCount: handBefore.length,
      boneyardCount: stateNow?.boneyard.length ?? 0,
      legalMoveCount: validMoves.length,
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
        setActionError(resp?.error ?? 'Unable to draw.');
        return;
      }
      if (joinedRoom && typeof resp.sequence === 'number' && Number.isFinite(resp.sequence)) {
        mpAutoDrawSuppressUntilSequenceRef.current = resp.sequence;
        autoTurnActionKeyRef.current = '';
      }
      appendMultiplayerMove({
        player: 'you',
        action: 'draw',
        boardEnds,
        handBefore,
        validMoves,
        pipDelta: 0,
        pointsScored: 0,
        boardState: snapshotBoardState(stateNow?.board ?? null),
        boardRenderState: cloneBoardState(stateNow?.board ?? null),
        handSnapshot: handBefore,
        engineBestMove: pickEngineBestMove(
          legalMovesNow
            .filter((m) => m.type === 'play' && m.tile)
            .map((m) => ({ tile: toTileTuple(m.tile as Tile), position: m.position })),
          boardEnds,
          handBefore,
        ),
      });
    } catch (e) {
      mpPerfMarkAck(false);
      showToast(e instanceof Error ? e.message : 'Action failed', 2000);
    } finally {
      setPendingUiAction((prev) => (prev === 'draw' ? null : prev));
      pendingActionRef.current = false;
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
    pendingActionRef,
    mpAutoDrawSuppressUntilSequenceRef,
    autoTurnActionKeyRef,
    setActionError,
    setPendingUiAction,
  ]);

  const pass = useCallback(async () => {
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
    pendingActionRef.current = true;
    const boardEnds = getBoardEnds(stateNow?.board ?? null);
    const handBefore = (stateNow?.players[you]?.hand ?? []).map(toTileTuple);
    const validMoves = legalMovesNow
      .filter((m) => m.type === 'play' && m.tile)
      .map((m) => toTileTuple(m.tile as Tile));
    try {
      const resp = await emitGameAction(socket, joinedRoom, { type: 'PASS' });
      mpPerfMarkAck(Boolean(resp?.ok), resp?.sequence);
      if (!resp?.ok) {
        setActionError(resp?.error ?? 'Unable to pass.');
        return;
      }
      appendMultiplayerMove({
        player: 'you',
        action: 'pass',
        boardEnds,
        handBefore,
        validMoves,
        pipDelta: 0,
        pointsScored: 0,
        boardState: snapshotBoardState(stateNow?.board ?? null),
        boardRenderState: cloneBoardState(stateNow?.board ?? null),
        handSnapshot: handBefore,
        engineBestMove: pickEngineBestMove(
          legalMovesNow
            .filter((m) => m.type === 'play' && m.tile)
            .map((m) => ({ tile: toTileTuple(m.tile as Tile), position: m.position })),
          boardEnds,
          handBefore,
        ),
      });
    } catch (e) {
      mpPerfMarkAck(false);
      showToast(e instanceof Error ? e.message : 'Action failed', 2000);
    } finally {
      setPendingUiAction((prev) => (prev === 'pass' ? null : prev));
      pendingActionRef.current = false;
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
    pendingActionRef,
    setActionError,
    setPendingUiAction,
  ]);

  const play = useCallback(
    async (position: PlacementPosition) => {
      setActionError('');
      const stateNow = stateRef.current;
      const legalMovesNow = legalMovesRef.current;
      const selected = selectedTileRef.current;
      if (!socket || !joinedRoom || !selected) return;

      if (isGameplayActionBlocked()) return;

      const tileToPlay = selected;
      const selectedMove = legalMovesNow.find(
        (m) =>
          m.type === 'play' &&
          m.tile &&
          m.position === position &&
          tileEquals(m.tile, tileToPlay),
      );
      if (!selectedMove) {
        emitDraggingState(false);
        setSelectedTile(null);
        setActionError('That tile cannot be played there.');
        return;
      }
      emitDraggingState(false);
      const baselineSequence = stateNow?.sequence ?? -1;
      pendingGameplayActionRef.current = { kind: 'play', baselineSequence };
      mpPerfBeginAction('play', baselineSequence);
      setPendingUiAction('play');
      playTileSound('standard', isMutedRef.current);
      pendingActionRef.current = true;
      setSelectedTile(null);
      setDrawStepMyHand(null);
      const boardEnds = getBoardEnds(stateNow?.board ?? null);
      const handBefore = (stateNow?.players[you]?.hand ?? []).map(toTileTuple);
      const validMoves = legalMovesNow
        .filter((m) => m.type === 'play' && m.tile)
        .map((m) => toTileTuple(m.tile as Tile));
      const playedTile = toTileTuple(tileToPlay);

      try {
        const resp = await emitGameAction(socket, joinedRoom, {
          type: 'MOVE',
          move: { tile: tileToPlay, position },
        });

        mpPerfMarkAck(Boolean(resp?.ok), resp?.sequence);
        if (!resp?.ok) {
          setActionError(resp?.error ?? 'Unable to play tile.');
          return;
        }
        if (joinedRoom && typeof resp.sequence === 'number' && Number.isFinite(resp.sequence)) {
          mpAutoDrawSuppressUntilSequenceRef.current = resp.sequence;
          autoTurnActionKeyRef.current = '';
        }
        flashLastPlayed(selectedMove?.tile ?? tileToPlay);
        appendMultiplayerMove({
          player: 'you',
          action: 'place',
          tile: playedTile,
          boardEnds,
          handBefore,
          validMoves,
          pipDelta: -(playedTile[0] + playedTile[1]),
          pointsScored: (() => {
            const possibleEnds = nextEndsForTile(playedTile, boardEnds);
            for (const ends of possibleEnds) {
              const s = ends[0] + ends[1];
              if (s > 0 && s % 5 === 0) return s / 5;
            }
            return 0;
          })(),
          boardState: snapshotBoardState(stateNow?.board ?? null),
          boardRenderState: cloneBoardState(stateNow?.board ?? null),
          handSnapshot: handBefore,
          engineBestMove: pickEngineBestMove(
            legalMovesNow
              .filter((m) => m.type === 'play' && m.tile)
              .map((m) => ({ tile: toTileTuple(m.tile as Tile), position: m.position })),
            boardEnds,
            handBefore,
          ),
        });
      } catch (e) {
        mpPerfMarkAck(false);
        showToast(e instanceof Error ? e.message : 'Action failed', 2000);
      } finally {
        setPendingUiAction((prev) => (prev === 'play' ? null : prev));
        pendingActionRef.current = false;
        pendingGameplayActionRef.current = null;
      }
    },
    [
      socket,
      joinedRoom,
      you,
      appendMultiplayerMove,
      emitDraggingState,
      showToast,
      flashLastPlayed,
      isGameplayActionBlocked,
      stateRef,
      legalMovesRef,
      selectedTileRef,
      pendingGameplayActionRef,
      pendingActionRef,
      mpAutoDrawSuppressUntilSequenceRef,
      autoTurnActionKeyRef,
      isMutedRef,
      setActionError,
      setPendingUiAction,
      setSelectedTile,
      setDrawStepMyHand,
    ],
  );

  useEffect(() => {
    const handActive = Boolean(state) && !state?.handOver && !state?.gameOver;

    if (
      joinedRoom &&
      mpAutoDrawSuppressUntilSequenceRef.current != null &&
      state &&
      typeof state.sequence === 'number'
    ) {
      if (state.sequence < mpAutoDrawSuppressUntilSequenceRef.current) {
        return;
      }
      mpAutoDrawSuppressUntilSequenceRef.current = null;
      autoTurnActionKeyRef.current = '';
    }

    if (
      !handActive ||
      !isMyTurn ||
      hasPlayMoves ||
      roomRecoveryState !== 'idle' ||
      isRecoveringConnection ||
      pendingActionRef.current
    ) {
      autoTurnActionKeyRef.current = '';
      return;
    }

    const autoAction: 'draw' | 'pass' | null = canDrawNow ? 'draw' : canPass ? 'pass' : null;
    if (!autoAction) return;

    const turnKey = `${state?.handNumber ?? 0}:${state?.currentPlayerIndex ?? -1}:${myHandLength}:${boneyardCount}:${autoAction}`;
    if (autoTurnActionKeyRef.current === turnKey) return;

    autoTurnActionKeyRef.current = turnKey;
    if (autoAction === 'draw') {
      drawAudit('forced-state-detected', {
        roomCode: joinedRoom ?? '',
        playerId: you,
        handCount: myHandLength,
        boneyardCount,
        legalMoveCount: legalMoves.filter((m) => m.type === 'play').length,
        canDraw,
        canPass,
        reason: 'auto_turn_effect',
      });
      draw();
    } else {
      drawAudit('auto-pass', {
        roomCode: joinedRoom ?? '',
        playerId: you,
        boneyardCount,
        reason: 'auto_turn_effect_blocked',
      });
      pass();
    }
  }, [
    state,
    joinedRoom,
    isMyTurn,
    hasPlayMoves,
    canDrawNow,
    canPass,
    myHandLength,
    boneyardCount,
    draw,
    pass,
    roomRecoveryState,
    isRecoveringConnection,
    legalMoves,
    canDraw,
    you,
    mpAutoDrawSuppressUntilSequenceRef,
    autoTurnActionKeyRef,
    pendingActionRef,
  ]);

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