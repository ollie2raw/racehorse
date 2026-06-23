import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { GameState, Move, PlacementPosition, Tile } from '../../types';
import { tileEquals } from '../../game/tileUtils';
import { projectMultiplayerGameState } from '../../multiplayer/boardSnapshotGuards';
import { drawAudit, nextDrawRequestId } from '../../multiplayer/drawAudit';
import {
  mpPerfBeginAction,
  mpPerfMarkAck,
  mpPerfMarkPendingUiCleared,
  mpPerfResetAction,
} from '../../multiplayer/mpPerf';
import { type UseRoomSocketSyncParams } from '../../multiplayer/useRoomSocketSync';
import {
  cloneBoardState,
  nextEndsForTile,
  pickEngineBestMove,
  snapshotBoardState,
  toTileTuple,
} from '../../analyzer/moveLogger';
import {
  emitGameAction,
  emitGameRematch,
  emitGameStart,
  emitHandReady,
  type RoomAckResponse,
} from '../../multiplayer/roomTransport';
import {
  getBoardEnds,
  tileListEquals,
} from '../boardSessionUtils';
import type {
  FlyingTile,
  HandEndedPayload,
  LiveMatchSessionApi,
  UseLiveMatchSessionParams,
} from './liveMatchSessionTypes';
import { flattenLiveMatchSessionParams } from './liveMatchSessionTypes';

export type { LiveMatchSessionApi, UseLiveMatchSessionParams } from './liveMatchSessionTypes';

const EMPTY_MOVES: Move[] = [];

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
    fetchGameState,
    normalizeRoomPlayers,
    applyRoomEventMeta,
    setFriendInvite,
    joinedRoomRef,
    maxSequenceRef,
    setPlayers,
    roomPlayersRef,
    setRoomRecoveryState,
    setRoomRecoveryMessage,
    isSeatedPlayerRef,
    matchStartedRef,
    playerReadyEmittedRef,
    schedulePlayerReadyRef,
    trySchedulePlayerReadyRef,
    isMutedRef,
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
  const [selectedTile, setSelectedTile] = useState<Tile | null>(null);
  const [optimisticPlayedTile, setOptimisticPlayedTile] = useState<Tile | null>(null);
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
  const [drawStepActorId, setDrawStepActorId] = useState<string | null>(null);
  const [drawStepOpponentHandCount, setDrawStepOpponentHandCount] = useState<number | null>(null);
  const [drawSequenceActive, setDrawSequenceActive] = useState(false);
  const [flyingTiles, setFlyingTiles] = useState<FlyingTile[]>([]);
  const [opponentDragging, setOpponentDragging] = useState(false);
  const [opponentDisconnected, setOpponentDisconnected] = useState(false);
  const [opponentDisconnectMessage, setOpponentDisconnectMessage] = useState('');
  const [handRevealAutoProgress, setHandRevealAutoProgress] = useState(1);

  const stateRef = useRef<GameState | null>(state);
  const legalMovesRef = useRef<Move[]>(legalMoves);
  const selectedTileRef = useRef<Tile | null>(selectedTile);
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
  const handReadyRecoveryRef = useRef(false);
  const lastPlayedTileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const youRef = useRef(you);
  const handRevealAutoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handRevealAutoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    legalMovesRef.current = legalMoves;
  }, [legalMoves]);

  useEffect(() => {
    selectedTileRef.current = selectedTile;
  }, [selectedTile]);

  useEffect(() => {
    youRef.current = you;
  }, [you]);

  const setDrawSequenceActiveBoth = useCallback((val: boolean) => {
    drawSequenceActiveRef.current = val;
    setDrawSequenceActive(val);
  }, []);

  const flashLastPlayed = useCallback((tile: Tile | null) => {
    if (lastPlayedTileTimerRef.current) {
      clearTimeout(lastPlayedTileTimerRef.current);
    }
    setLastPlayedTile(tile);
    if (tile) {
      lastPlayedTileTimerRef.current = setTimeout(() => {
        setLastPlayedTile(null);
        lastPlayedTileTimerRef.current = null;
      }, 2400);
    }
  }, []);

  const clearTransientRoomUi = useCallback(() => {
    setSelectedTile(null);
    setPendingUiAction(null);
    setActionError('');
    setOptimisticPlayedTile(null);
    setOpponentDragging(false);
    draggingStateRef.current = false;
    pendingActionRef.current = false;
    pendingGameplayActionRef.current = null;
    mpPerfResetAction();
    setHandReveal(null);
    if (drawSequenceTimeoutRef.current) {
      clearTimeout(drawSequenceTimeoutRef.current);
      drawSequenceTimeoutRef.current = null;
    }
    setDrawSequenceActiveBoth(false);
    setDrawStepMyHand(null);
    setDrawStepActorId(null);
    setDrawStepOpponentHandCount(null);
    setFlyingTiles([]);
  }, [setDrawSequenceActiveBoth]);

  const clearPendingGameplayUiOnAuthoritativeState = useCallback((nextState: GameState | null) => {
    const pending = pendingGameplayActionRef.current;
    if (!pending || !nextState) return;
    const sequence = nextState.sequence;
    if (typeof sequence !== 'number' || !Number.isFinite(sequence)) return;
    if (sequence <= pending.baselineSequence) return;

    setPendingUiAction((prev) => (prev === pending.kind ? null : prev));
    mpPerfMarkPendingUiCleared();
  }, []);

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
      clearTransientRoomUi();

      return { ok: true, nextState };
    },
    [clearTransientRoomUi, maxSequenceRef],
  );

  const roomSocketSyncParams = useMemo(
    (): UseRoomSocketSyncParams => ({
      socket,
      syncRuntime: {
        roomRuntime: {
          joinedRoomRef,
          maxSequenceRef,
        },
        recoveryRuntime: {
          resyncInFlightRef,
          resyncBufferedUpdateRef,
          resyncFlushRef,
          rematchAwaitingStateRef,
          fetchGameState,
          resetClientGameSession,
        },
        sessionRefsRuntime: {
          isSeatedPlayerRef,
          matchStartedRef,
          playerReadyEmittedRef,
          schedulePlayerReadyRef,
          trySchedulePlayerReadyRef,
          isMutedRef,
        },
      },
      syncUi: {
        showToast,
        normalizeRoomPlayers,
        applyRoomEventMeta,
        setFriendInvite,
        setRoomRecoveryState,
        setRoomRecoveryMessage,
        setOptimisticPlayedTile,
        setLegalMoves,
        setCanDraw,
        setOpponentDisconnected,
        setOpponentDisconnectMessage,
        setDrawSequenceActiveBoth,
        setDrawStepMyHand,
        setDrawStepActorId,
        setDrawStepOpponentHandCount,
        setFlyingTiles,
        setBoneyardDisplayCount,
        setDrawPulseIndex,
        playDrawSound,
        tileEquals,
        onAuthoritativeGameplayStateApplied: clearPendingGameplayUiOnAuthoritativeState,
        setError,
      },
      syncDom: {
        drawSequenceActiveRef,
        drawSequenceTimeoutRef,
        boneyardRef,
        handAreaRef,
        opponentPillRef,
        youRef,
        stateRef,
        flyingTileIdRef,
        pendingForcedHandRevealRef,
      },
      setState,
      setPlayers,
      roomPlayersRef,
    }),
    [
      socket,
      showToast,
      normalizeRoomPlayers,
      applyRoomEventMeta,
      setFriendInvite,
      joinedRoomRef,
      maxSequenceRef,
      setPlayers,
      roomPlayersRef,
      fetchGameState,
      resyncInFlightRef,
      resyncBufferedUpdateRef,
      resyncFlushRef,
      resetClientGameSession,
      isSeatedPlayerRef,
      matchStartedRef,
      playerReadyEmittedRef,
      trySchedulePlayerReadyRef,
      schedulePlayerReadyRef,
      clearPendingGameplayUiOnAuthoritativeState,
      setDrawSequenceActiveBoth,
      isMutedRef,
      playDrawSound,
      setError,
    ],
  );

  const emitDraggingState = useCallback(
    (dragging: boolean) => {
      if (draggingStateRef.current === dragging) return;
      draggingStateRef.current = dragging;
      if (!socket || !joinedRoom || !state || state.gameOver || state.handOver) return;
      if (!state.playerIds.includes(you)) return;
      socket.emit('player:dragging', joinedRoom, { dragging });
    },
    [socket, joinedRoom, state, you],
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
    if (pendingActionRef.current) return true;
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
          playerReadyEmittedRef.current = false;
          void schedulePlayerReadyRef.current();
          playerReadyEmittedRef.current = false;
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
  }, [socket, joinedRoom, setError, showToast, onGameStart, playerReadyEmittedRef, schedulePlayerReadyRef, trySchedulePlayerReadyRef]);

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
  }, [socket, joinedRoom, state?.gameOver, rematchRequested, showToast]);

  const draw = useCallback(async () => {
    setActionError('');
    const stateNow = stateRef.current;
    const legalMovesNow = legalMovesRef.current;
    const boneyardLockedNow = (stateNow?.boneyard.length ?? 0) <= 2;
    if (
      !socket ||
      !joinedRoom ||
      boneyardLockedNow ||
      !canDraw ||
      isGameplayActionBlocked()
    ) {
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
  }, [socket, joinedRoom, you, appendMultiplayerMove, emitDraggingState, showToast, isGameplayActionBlocked]);

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
    ],
  );

  const currentTurnId = state?.playerIds[state.currentPlayerIndex] ?? null;
  const isMyTurn = currentTurnId === you;
  const myHand = drawStepMyHand ?? state?.players[you]?.hand ?? [];
  const opponentId = state?.playerIds.find((pid) => pid !== you) ?? null;
  const authoritativeOpponentTileCount =
    state && opponentId ? (state.handCounts?.[opponentId] ?? 0) : 0;
  const opponentTileCount = drawStepOpponentHandCount ?? authoritativeOpponentTileCount;
  const hasPlayMoves = legalMoves.some((m) => m.type === 'play');
  const canDrawNow = canDraw && !hasPlayMoves;
  const canPass = legalMoves.some((m) => m.type === 'pass');
  const boneyardCount = boneyardDisplayCount ?? state?.boneyard.length ?? 0;
  const inGame = Boolean(isConnected && joinedRoom && state);

  const boardLegalMoves = useMemo(
    () =>
      isMyTurn &&
      roomRecoveryState === 'idle' &&
      !isRecoveringConnection &&
      pendingUiAction !== 'draw' &&
      pendingUiAction !== 'pass' &&
      pendingUiAction !== 'play'
        ? legalMoves
        : EMPTY_MOVES,
    [isMyTurn, legalMoves, roomRecoveryState, isRecoveringConnection, pendingUiAction],
  );

  const selectedTileHasLegalPlay = useMemo(
    () =>
      Boolean(
        selectedTile &&
          boardLegalMoves.some(
            (m) =>
              m.type === 'play' &&
              m.tile &&
              m.position &&
              tileEquals(m.tile, selectedTile),
          ),
      ),
    [boardLegalMoves, selectedTile],
  );

  const boardSelectedTile = useMemo(
    () => (selectedTileHasLegalPlay ? selectedTile : null),
    [selectedTileHasLegalPlay, selectedTile],
  );

  const boardShowOpenEndGlow = useMemo(
    () => Boolean(isMyTurn && opponentDragging),
    [isMyTurn, opponentDragging],
  );

  const handSelectedTile = useMemo(
    () => (selectedTileHasLegalPlay ? selectedTile : null),
    [selectedTileHasLegalPlay, selectedTile],
  );

  const boardForDisplay = useMemo(() => {
    const rawBoard =
      state?.board ??
      (state?.handOver &&
      frozenHandOverBoardRef.current?.handNumber === state.handNumber
        ? frozenHandOverBoardRef.current.board
        : null);
    return rawBoard ?? null;
  }, [state?.board, state?.handOver, state?.handNumber]);

  const handleTileTap = useCallback(
    (tile: Tile) => {
      if (
        !isMyTurn ||
        state?.handOver ||
        state?.gameOver ||
        roomRecoveryState !== 'idle' ||
        isRecoveringConnection ||
        pendingActionRef.current
      ) {
        return;
      }
      if (selectedTile && tileEquals(selectedTile, tile)) {
        setSelectedTile(null);
        emitDraggingState(false);
        return;
      }
      setSelectedTile(tile);
      emitDraggingState(true);
    },
    [
      isMyTurn,
      state?.handOver,
      state?.gameOver,
      roomRecoveryState,
      isRecoveringConnection,
      selectedTile,
      emitDraggingState,
    ],
  );

  useEffect(() => {
    emitDraggingState(Boolean(selectedTile));
  }, [selectedTile, emitDraggingState]);

  useEffect(() => {
    if (!isMyTurn || state?.gameOver || state?.handOver) {
      emitDraggingState(false);
      setSelectedTile(null);
    }
  }, [isMyTurn, state?.gameOver, state?.handOver, emitDraggingState]);

  const continueAfterHandReveal = useCallback(() => {
    const readyHandNumber = handReveal?.handNumber ?? state?.handNumber;
    if (socket && joinedRoom) {
      emitHandReady(socket, joinedRoom, readyHandNumber).catch((error) => {
        if (import.meta.env.DEV) {
          console.warn('[hand:ready] failed:', error instanceof Error ? error.message : error);
        }
      });
    }
    setHandReveal(null);
  }, [socket, joinedRoom, handReveal?.handNumber, state?.handNumber]);

  const continueAfterHandRevealRef = useRef(continueAfterHandReveal);
  continueAfterHandRevealRef.current = continueAfterHandReveal;

  useEffect(() => {
    const needsReady =
      Boolean(state?.handOver) &&
      !state?.gameOver &&
      !handReveal &&
      handRevealShownRef.current !== state?.handNumber &&
      Boolean(joinedRoom) &&
      socket?.connected;
    if (!needsReady) {
      handReadyRecoveryRef.current = false;
      return;
    }
    if (handReadyRecoveryRef.current) return;
    handReadyRecoveryRef.current = true;
    if (import.meta.env.DEV) {
      console.log('[hand:ready] recovering lost hand:ready signal after reconnect');
    }
    emitHandReady(socket!, joinedRoom!, state?.handNumber).catch((error) => {
      handReadyRecoveryRef.current = false;
      showToast('Could not signal hand ready. Reconnecting…', 2500);
      if (import.meta.env.DEV) {
        console.warn('[hand:ready] recovery failed:', error instanceof Error ? error.message : error);
      }
    });
  }, [state?.handOver, state?.gameOver, state?.handNumber, handReveal, joinedRoom, socket, showToast]);

  useEffect(() => {
    if (!inGame || !state || state.gameOver || !state.handOver) return;
    if (handRevealShownRef.current === state.handNumber) return;
    const opponentIdFromState = state.playerIds.find((pid) => pid !== you) ?? null;
    handRevealShownRef.current = state.handNumber;
    const tid = window.setTimeout(() => {
      setHandReveal({
        handNumber: state.handNumber,
        yourRemainingTiles: state.players[you]?.hand ?? [],
        opponentRemainingTiles: opponentIdFromState
          ? (state.players[opponentIdFromState]?.hand ?? [])
          : [],
        pointsAwarded: { you: 0, opponent: 0 },
      });
    }, 1400);
    return () => window.clearTimeout(tid);
  }, [inGame, state, you]);

  useEffect(() => {
    if (!handReveal || !state || state.gameOver || !state.handOver) return;
    const opponentIdFromState = state.playerIds.find((pid) => pid !== you) ?? null;
    const nextYourRemaining = state.players[you]?.hand ?? [];
    const nextOpponentRemaining = opponentIdFromState
      ? (state.players[opponentIdFromState]?.hand ?? [])
      : [];
    if (
      tileListEquals(handReveal.yourRemainingTiles, nextYourRemaining) &&
      tileListEquals(handReveal.opponentRemainingTiles, nextOpponentRemaining)
    ) {
      return;
    }
    setHandReveal((prev) =>
      prev
        ? {
            ...prev,
            yourRemainingTiles: nextYourRemaining,
            opponentRemainingTiles: nextOpponentRemaining,
          }
        : prev,
    );
  }, [handReveal, state, you]);

  useEffect(() => {
    if (handRevealAutoTimeoutRef.current) clearTimeout(handRevealAutoTimeoutRef.current);
    if (handRevealAutoIntervalRef.current) clearInterval(handRevealAutoIntervalRef.current);

    if (!handReveal || state?.gameOver) {
      setHandRevealAutoProgress(1);
      return;
    }

    const durationMs = 4000;
    const start = Date.now();
    setHandRevealAutoProgress(1);

    handRevealAutoIntervalRef.current = setInterval(() => {
      const elapsed = Date.now() - start;
      const nextProgress = Math.max(0, 1 - elapsed / durationMs);
      setHandRevealAutoProgress(nextProgress);
    }, 50);

    handRevealAutoTimeoutRef.current = setTimeout(() => {
      continueAfterHandRevealRef.current();
    }, durationMs);

    return () => {
      if (handRevealAutoTimeoutRef.current) clearTimeout(handRevealAutoTimeoutRef.current);
      if (handRevealAutoIntervalRef.current) clearInterval(handRevealAutoIntervalRef.current);
    };
  }, [handReveal, state?.gameOver]);

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

    const turnKey = `${state?.handNumber ?? 0}:${state?.currentPlayerIndex ?? -1}:${myHand.length}:${boneyardCount}:${autoAction}`;
    if (autoTurnActionKeyRef.current === turnKey) return;

    autoTurnActionKeyRef.current = turnKey;
    if (autoAction === 'draw') {
      drawAudit('forced-state-detected', {
        roomCode: joinedRoom ?? '',
        playerId: you,
        handCount: myHand.length,
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
    myHand.length,
    boneyardCount,
    draw,
    pass,
    roomRecoveryState,
    isRecoveringConnection,
    legalMoves,
    canDraw,
    you,
  ]);

  useEffect(() => {
    if (!state) {
      frozenHandOverBoardRef.current = null;
      return;
    }

    if (state.board) {
      frozenHandOverBoardRef.current = {
        handNumber: state.handNumber,
        board: state.board,
      };
      return;
    }

    if (!state.handOver) {
      frozenHandOverBoardRef.current = null;
    }
  }, [state]);

  useEffect(() => {
    return () => {
      if (handRevealAutoTimeoutRef.current) clearTimeout(handRevealAutoTimeoutRef.current);
      if (handRevealAutoIntervalRef.current) clearInterval(handRevealAutoIntervalRef.current);
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
    selectedTile,
    setSelectedTile,
    optimisticPlayedTile,
    setOptimisticPlayedTile,
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
    handRevealAutoProgress,
    inGame,
    isMyTurn,
    myHand,
    opponentTileCount,
    boneyardCount,
    hasPlayMoves,
    canDrawNow,
    canPass,
    boardForDisplay,
    boardLegalMoves,
    selectedTileHasLegalPlay,
    boardSelectedTile,
    boardShowOpenEndGlow,
    handSelectedTile,
    stateRef,
    legalMovesRef,
    selectedTileRef,
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
    continueAfterHandRevealRef,
    handReadyRecoveryRef,
    lastPlayedTileTimerRef,
    youRef,
    clearTransientRoomUi,
    clearPendingGameplayUiOnAuthoritativeState,
    play,
    draw,
    pass,
    startGame,
    requestRematch,
    continueAfterHandReveal,
    emitDraggingState,
    isGameplayActionBlocked,
    handleTileTap,
    setDrawSequenceActiveBoth,
    flashLastPlayed,
    applyJoinResponseGameState,
    roomSocketSyncParams,
  };
}
