import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import GameReviewer from '../analyzer/GameReviewer';
import type { BoardHandle } from '../components';
import type { GameAnalysis } from '../analyzer/moveAnalyzer';
import {
  type MoveEntry,
  snapshotBoardState,
  cloneBoardState,
  toTileTuple,
} from '../analyzer/moveLogger';
import {
  assertDisplayedOpenCountMatchesCanonical,
  computeOpenEndsSum,
} from '../game/openEndsGeometry';
import { isRenderableMultiplayerSnapshot } from './boardSnapshotGuards';
import { useRoomSocketSync } from './useRoomSocketSync';
import { useLiveMatchSession } from '../match/session/useLiveMatchSession';
import {
  findPlacedTile,
  getBoardEnds,
  getBoardTileCount,
} from '../match/boardSessionUtils';
import {
  normalizeRoomPlayers,
  type MultiplayerLiveMatchRecoveryRuntime,
  type MultiplayerLiveMatchRoomRuntime,
  type MultiplayerRoomRecoverySetters,
  type MultiplayerSessionRefsRuntime,
} from './multiplayerRuntime';
import { useRenderProfiler } from '../debug/renderProfiler';
import {
  playMatchLoseSound,
  playMatchWinSound,
  playScoreSound,
  playDrawSound,
} from '../utils/sound';
import {
  publishGameSnapshot,
  resetGameSnapshot,
  type MultiplayerGameRouteProps,
  type MultiplayerGameSnapshot,
} from './multiplayerGameSnapshot';
import type {
  MultiplayerGameShellBridge,
  MultiplayerGameShellProps,
} from './multiplayerGameShellTypes';

function MultiplayerGameShellComponent({
  socket,
  joinedRoom,
  you,
  players,
  isConnected,
  showToast,
  connectionRecovery,
  setError,
  setPlayers,
  setFriendInvite,
  isMutedRef,
  trayCenterRef,
  authUser,
  authProfile,
  refreshAuthProfile,
  authProfileRef,
  supabaseEnabled,
  tournamentMatch,
  tournamentOpponentLabel,
  rejoinInFlightRef,
  joinedRoomRef,
  maxSequenceRef,
  roomPlayersRef,
  resyncInFlightRef,
  resyncBufferedUpdateRef,
  resyncFlushRef,
  fetchGameState,
  applyRoomEventMeta,
  shellBridgeRef,
  sharedGameplayRefs,
}: MultiplayerGameShellProps) {
  const { roomRecoveryState, isRecoveringConnection, setRoomRecoveryState, setRoomRecoveryMessage } =
    connectionRecovery;

  const [scoreToast, setScoreToast] = useState<MultiplayerGameRouteProps['scoreToast']>(null);
  const [scoreTrackOpen, setScoreTrackOpen] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [multiplayerMoveLog, setMultiplayerMoveLog] = useState<MoveEntry[]>([]);
  const multiplayerMoveCounterRef = useRef(1);
  const multiplayerHandNumberRef = useRef(1);
  const previousStateForAnalysisRef = useRef<import('../types').GameState | null>(null);
  const [analyzerOpen, setAnalyzerOpen] = useState(false);
  const [currentAnalysis, setCurrentAnalysis] = useState<GameAnalysis | null>(null);
  const [handTileSize, setHandTileSize] = useState(44);
  const prevOppCountRef = useRef<number | null>(null);
  const [hudScorePulse, setHudScorePulse] = useState<Record<string, boolean>>({});
  const prevHudScoresRef = useRef<Record<string, number>>({});
  const prevMyHandLenRef = useRef(0);
  const prevOpponentHandLenRef = useRef(0);
  const prevForcedDrawActiveRef = useRef(false);
  const localFlyingTileIdRef = useRef(0);
  const boardRef = useRef<BoardHandle>(null);
  const confettiCanvasRef = useRef<HTMLCanvasElement>(null);
  const matchRecordKeyRef = useRef('');
  const prevGameOverRef = useRef(false);
  const scoreToastHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scoreToastClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [multiplayerRatingBaseline, setMultiplayerRatingBaseline] = useState<number | null>(null);
  const [multiplayerRatingPending, setMultiplayerRatingPending] = useState(false);
  const multiplayerRatingRefreshKeyRef = useRef('');
  const previousMultiplayerGameOverRef = useRef(false);

  const isSeatedPlayerRef = useRef(false);
  const matchStartedRef = useRef(false);
  const playerReadyEmittedRef = useRef(false);
  const schedulePlayerReadyRef = useRef<() => Promise<void>>(async () => {});
  const trySchedulePlayerReadyRef = useRef<() => void>(() => {});

  const appendMultiplayerMove = useCallback((entry: Omit<MoveEntry, 'moveNumber' | 'handNumber'>) => {
    const moveNumber =
      entry.player === 'you'
        ? multiplayerMoveCounterRef.current++
        : multiplayerMoveCounterRef.current;
    const handNumber = multiplayerHandNumberRef.current;
    setMultiplayerMoveLog((prev) => [...prev, { ...entry, moveNumber, handNumber }]);
  }, []);

  const liveMatchRoomRuntime = useMemo(
    (): MultiplayerLiveMatchRoomRuntime => ({
      joinedRoomRef,
      maxSequenceRef,
      roomPlayersRef,
    }),
    [joinedRoomRef, maxSequenceRef, roomPlayersRef],
  );

  const liveMatchRecoverySetters = useMemo(
    (): MultiplayerRoomRecoverySetters => ({
      setRoomRecoveryState,
      setRoomRecoveryMessage,
    }),
    [setRoomRecoveryMessage, setRoomRecoveryState],
  );

  const liveMatchSessionRefsRuntime = useMemo(
    (): MultiplayerSessionRefsRuntime => ({
      isSeatedPlayerRef,
      matchStartedRef,
      playerReadyEmittedRef,
      schedulePlayerReadyRef,
      trySchedulePlayerReadyRef,
      isMutedRef,
    }),
    [isMutedRef],
  );

  const resetShellClientGameSessionRef = useRef<() => void>(() => {});

  const liveMatchRecoveryRuntime = useMemo(
    (): MultiplayerLiveMatchRecoveryRuntime => ({
      resyncInFlightRef,
      resyncBufferedUpdateRef,
      resyncFlushRef,
      fetchGameState,
      resetClientGameSession: () => {
        resetShellClientGameSessionRef.current();
      },
    }),
    [fetchGameState, resyncBufferedUpdateRef, resyncFlushRef, resyncInFlightRef],
  );

  const liveMatch = useLiveMatchSession({
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
    roomRuntime: liveMatchRoomRuntime,
    recoveryRuntime: liveMatchRecoveryRuntime,
    recoverySetters: liveMatchRecoverySetters,
    sessionRefsRuntime: liveMatchSessionRefsRuntime,
    setPlayers,
    playDrawSound,
    onGameStart: () => {
      setMultiplayerMoveLog([]);
      multiplayerMoveCounterRef.current = 1;
      previousStateForAnalysisRef.current = null;
    },
    appendMultiplayerMove,
  });

  const {
    state,
    setState,
    legalMoves,
    setLegalMoves,
    canDraw,
    setCanDraw,
    selectedTile,
    setSelectedTile,
    optimisticPlayedTile,
    setOptimisticPlayedTile: _setOptimisticPlayedTile,
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
    flyingTiles,
    setFlyingTiles,
    drawSequenceActive,
    opponentDragging,
    setOpponentDragging,
    opponentDisconnected,
    setOpponentDisconnectMessage,
    opponentDisconnectMessage,
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
    boardForDisplay,
    boardLegalMoves,
    boardSelectedTile,
    boardShowOpenEndGlow,
    handSelectedTile,
    stateRef,
    draggingStateRef,
    handRevealShownRef,
    handRevealTimerRef,
    rematchAwaitingStateRef,
    drawSequenceTimeoutRef,
    mpAutoDrawSuppressUntilSequenceRef,
    autoTurnActionKeyRef,
    frozenHandOverBoardRef,
    pendingForcedHandRevealRef: _pendingForcedHandRevealRef,
    boneyardRef,
    handAreaRef,
    opponentPillRef,
    youRef,
    clearTransientRoomUi,
    play,
    startGame,
    requestRematch,
    handleTileTap,
    setDrawSequenceActiveBoth,
    flashLastPlayed,
    applyJoinResponseGameState,
    roomSocketSyncParams,
    setDrawStepMyHand,
    setDrawStepOpponentHandCount,
    preGameDraw,
    onPregameTileTap,
  } = liveMatch;

  useRoomSocketSync(roomSocketSyncParams);

  useRenderProfiler(inGame ? 'MultiplayerGameShell' : 'MultiplayerGameShellLobby');

  const resetShellClientGameSession = useCallback(() => {
    autoTurnActionKeyRef.current = '';
    mpAutoDrawSuppressUntilSequenceRef.current = null;
    frozenHandOverBoardRef.current = null;
    playerReadyEmittedRef.current = false;
    matchStartedRef.current = false;
    rematchAwaitingStateRef.current = false;
    resyncBufferedUpdateRef.current = null;
    setOpponentDragging(false);
    setOpponentDisconnectMessage('');
    setBoneyardDisplayCount(null);
    clearTransientRoomUi();
  }, [
    autoTurnActionKeyRef,
    clearTransientRoomUi,
    frozenHandOverBoardRef,
    matchStartedRef,
    mpAutoDrawSuppressUntilSequenceRef,
    playerReadyEmittedRef,
    rematchAwaitingStateRef,
    resyncBufferedUpdateRef,
    setBoneyardDisplayCount,
    setOpponentDisconnectMessage,
    setOpponentDragging,
  ]);

  resetShellClientGameSessionRef.current = resetShellClientGameSession;

  useEffect(() => {
    return () => {
      if (scoreToastHideTimerRef.current) clearTimeout(scoreToastHideTimerRef.current);
      if (scoreToastClearTimerRef.current) clearTimeout(scoreToastClearTimerRef.current);
    };
  }, []);

  const showScoreLikeToast = useCallback((message: string, tone: 'you' | 'opp') => {
    if (scoreToastHideTimerRef.current) clearTimeout(scoreToastHideTimerRef.current);
    if (scoreToastClearTimerRef.current) clearTimeout(scoreToastClearTimerRef.current);
    setScoreToast({
      message,
      tone,
      visible: true,
    });
    scoreToastHideTimerRef.current = setTimeout(() => {
      setScoreToast((prev) => (prev ? { ...prev, visible: false } : prev));
    }, 2800);
    scoreToastClearTimerRef.current = setTimeout(() => setScoreToast(null), 3200);
  }, []);

  const showScoreToast = useCallback(
    (player: 'you' | 'opp', points: number, label?: string) => {
      const currentScore =
        player === 'you'
          ? (stateRef.current?.players[you]?.score ?? 0)
          : (stateRef.current?.players[stateRef.current?.playerIds.find((p) => p !== you) ?? '']?.score ??
            0);
      showScoreLikeToast(
        `${label ?? (player === 'you' ? 'You' : 'Opponent')} scored +${points} · ${currentScore} pts`,
        player,
      );
    },
    [showScoreLikeToast, stateRef, you],
  );

  useEffect(() => {
    if (state) return;
    if (drawSequenceTimeoutRef.current) {
      clearTimeout(drawSequenceTimeoutRef.current);
      drawSequenceTimeoutRef.current = null;
    }
    setDrawSequenceActiveBoth(false);
    setDrawStepMyHand(null);
    setDrawStepOpponentHandCount(null);
    setBoneyardDisplayCount(null);
  }, [state, setBoneyardDisplayCount, setDrawSequenceActiveBoth, setDrawStepMyHand, setDrawStepOpponentHandCount, drawSequenceTimeoutRef]);

  useEffect(() => {
    if (!joinedRoom) return;
    if (!state) return;
    if (!isRenderableMultiplayerSnapshot(state)) {
      void fetchGameState('runtime_state_projection_guard');
    }
  }, [joinedRoom, state, fetchGameState]);

  useEffect(() => {
    setRematchRequested(false);
    setRematchReadyIds([]);
    setMultiplayerMoveLog([]);
    setScoreTrackOpen(false);
    multiplayerMoveCounterRef.current = 1;
    previousStateForAnalysisRef.current = null;
    setOpponentDragging(false);
    draggingStateRef.current = false;
    setMultiplayerRatingBaseline(
      authProfile?.glicko_rating != null ? Number(authProfile.glicko_rating) : null,
    );
    setMultiplayerRatingPending(false);
    multiplayerRatingRefreshKeyRef.current = '';
    previousMultiplayerGameOverRef.current = false;
  }, [joinedRoom, authProfile?.glicko_rating, draggingStateRef, setOpponentDragging, setRematchReadyIds, setRematchRequested]);

  useEffect(() => {
    if (!joinedRoom || state?.gameOver) return;
    if (multiplayerRatingBaseline != null) return;
    if (authProfile?.glicko_rating == null) return;
    setMultiplayerRatingBaseline(Number(authProfile.glicko_rating));
  }, [authProfile?.glicko_rating, joinedRoom, multiplayerRatingBaseline, state?.gameOver]);

  useEffect(() => {
    const wasGameOver = previousMultiplayerGameOverRef.current;
    const isGameOver = Boolean(state?.gameOver);
    if (wasGameOver && !isGameOver) {
      setMultiplayerRatingBaseline(
        authProfile?.glicko_rating != null ? Number(authProfile.glicko_rating) : null,
      );
      setMultiplayerRatingPending(false);
      multiplayerRatingRefreshKeyRef.current = '';
    }
    previousMultiplayerGameOverRef.current = isGameOver;
  }, [authProfile?.glicko_rating, state?.gameOver]);

  const isSpectatingMatch = Boolean(
    tournamentMatch?.isTournament && joinedRoom && state && !state.playerIds.includes(you),
  );
  const isTournamentMatch = Boolean(tournamentMatch?.isTournament);

  useEffect(() => {
    if (state?.handNumber != null) {
      multiplayerHandNumberRef.current = state.handNumber;
    }
  }, [state?.handNumber]);

  useEffect(() => {
    if (!state?.gameOver || !joinedRoom || !authUser || isSpectatingMatch || isTournamentMatch) return;
    const ratingEligible = players.length === 2 && players.every((p) => Boolean(p.userId));
    if (!ratingEligible) return;
    const key = `${joinedRoom}:${state.handNumber}:${state.players[you]?.score ?? 0}:${state.winnerId ?? ''}`;
    if (multiplayerRatingRefreshKeyRef.current === key) return;
    multiplayerRatingRefreshKeyRef.current = key;
    setMultiplayerRatingPending(true);
    let cancelled = false;
    const baselineRating = multiplayerRatingBaseline;
    const retryDelaysMs = [0, 700, 1400, 2400, 3600, 5200];

    void (async () => {
      try {
        for (let i = 0; i < retryDelaysMs.length; i += 1) {
          const delayMs = retryDelaysMs[i];
          if (delayMs > 0) {
            await new Promise((resolve) => window.setTimeout(resolve, delayMs));
          }
          if (cancelled) return;

          try {
            await Promise.resolve(refreshAuthProfile());
          } catch (err) {
            console.warn('[Multiplayer Rating] profile refresh failed:', err);
          }

          if (cancelled) return;
          const latestRating = authProfileRef.current?.glicko_rating;
          if (
            latestRating != null &&
            (baselineRating == null ||
              Number(latestRating) !== baselineRating ||
              i === retryDelaysMs.length - 1)
          ) {
            return;
          }
        }
      } finally {
        if (!cancelled) {
          setMultiplayerRatingPending(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    authProfileRef,
    authUser,
    isSpectatingMatch,
    isTournamentMatch,
    joinedRoom,
    multiplayerRatingBaseline,
    players,
    refreshAuthProfile,
    state,
    you,
  ]);

  useEffect(() => {
    const updateHandTileSize = () => {
      const tileCount = Math.max(1, myHand.length);
      const isLandscape = window.innerWidth > window.innerHeight;
      const isMobileWidth = window.innerWidth <= 900;
      const forceTwoRows = tileCount > 9;
      const maxTileSize = isLandscape && isMobileWidth ? 42 : tileCount > 9 ? 50 : 68;
      const containerWidth = trayCenterRef.current?.offsetWidth ?? window.innerWidth - 40;
      const effectiveLen = forceTwoRows ? Math.ceil(tileCount / 2) : tileCount;
      const tileWidth = Math.min(maxTileSize, Math.floor((containerWidth - 20) / effectiveLen));
      setHandTileSize(tileWidth);
    };

    updateHandTileSize();
    window.addEventListener('resize', updateHandTileSize);
    return () => window.removeEventListener('resize', updateHandTileSize);
  }, [myHand.length, trayCenterRef]);

  useEffect(() => {
    if (!inGame) {
      prevMyHandLenRef.current = 0;
      setDrawPulseIndex(null);
      return;
    }

    if (myHand.length > prevMyHandLenRef.current) {
      setDrawPulseIndex(myHand.length - 1);
      const timer = setTimeout(() => setDrawPulseIndex(null), 360);
      prevMyHandLenRef.current = myHand.length;
      return () => clearTimeout(timer);
    }

    prevMyHandLenRef.current = myHand.length;
    setDrawPulseIndex(null);
  }, [inGame, myHand.length, setDrawPulseIndex]);

  useEffect(() => {
    const timers: number[] = [];

    if (!inGame || !state) {
      prevMyHandLenRef.current = 0;
      prevOpponentHandLenRef.current = 0;
      return;
    }

    const isForcedDrawActive = drawSequenceActive;
    const wasForcedDrawActive = prevForcedDrawActiveRef.current;
    prevForcedDrawActiveRef.current = isForcedDrawActive;

    const currentMyHandLen = myHand.length;
    const currentOppHandLen = opponentTileCount;

    const prevMyHandLen = prevMyHandLenRef.current;
    const prevOppHandLen = prevOpponentHandLenRef.current;

    if (prevMyHandLen === 0 && prevOppHandLen === 0) {
      prevMyHandLenRef.current = currentMyHandLen;
      prevOpponentHandLenRef.current = currentOppHandLen;
      return;
    }

    if (isForcedDrawActive || wasForcedDrawActive) {
      prevMyHandLenRef.current = currentMyHandLen;
      prevOpponentHandLenRef.current = currentOppHandLen;
      return;
    }

    if (currentMyHandLen > prevMyHandLen) {
      const drawnCount = currentMyHandLen - prevMyHandLen;
      for (let i = 0; i < drawnCount; i++) {
        const t = window.setTimeout(() => {
          if (!boneyardRef.current || !handAreaRef.current) return;
          playDrawSound(isMutedRef.current);
          const from = boneyardRef.current.getBoundingClientRect();
          const to = handAreaRef.current.getBoundingClientRect();
          const id = ++localFlyingTileIdRef.current;
          setFlyingTiles((prevTiles) => [
            ...(prevTiles || []),
            {
              x: from.left + from.width / 2,
              y: from.top + from.height / 2,
              toX: to.left + to.width / 2,
              toY: to.top + to.height / 2,
              id,
            },
          ]);
          const ftRemove = window.setTimeout(() => {
            setFlyingTiles((prevTiles) => (prevTiles || []).filter((tile) => tile.id !== id));
          }, 520);
          timers.push(ftRemove);
        }, i * 150);
        timers.push(t);
      }
    }

    if (currentOppHandLen > prevOppHandLen) {
      const drawnCount = currentOppHandLen - prevOppHandLen;
      for (let i = 0; i < drawnCount; i++) {
        const t = window.setTimeout(() => {
          if (!boneyardRef.current || !opponentPillRef.current) return;
          playDrawSound(isMutedRef.current);
          const from = boneyardRef.current.getBoundingClientRect();
          const to = opponentPillRef.current.getBoundingClientRect();
          const id = ++localFlyingTileIdRef.current;
          setFlyingTiles((prevTiles) => [
            ...(prevTiles || []),
            {
              x: from.left + from.width / 2,
              y: from.top + from.height / 2,
              toX: to.left + to.width / 2,
              toY: to.top + to.height / 2,
              id,
            },
          ]);
          const ftRemove = window.setTimeout(() => {
            setFlyingTiles((prevTiles) => (prevTiles || []).filter((tile) => tile.id !== id));
          }, 520);
          timers.push(ftRemove);
        }, i * 150);
        timers.push(t);
      }
    }

    prevMyHandLenRef.current = currentMyHandLen;
    prevOpponentHandLenRef.current = currentOppHandLen;

    return () => {
      timers.forEach((timer) => clearTimeout(timer));
    };
  }, [
    inGame,
    state,
    myHand.length,
    opponentTileCount,
    drawSequenceActive,
    setFlyingTiles,
    playDrawSound,
    boneyardRef,
    handAreaRef,
    opponentPillRef,
    isMutedRef,
  ]);

  useEffect(() => {
    if (!state) {
      previousStateForAnalysisRef.current = null;
      return;
    }
    const prev = previousStateForAnalysisRef.current;
    previousStateForAnalysisRef.current = state;
    if (!prev) return;
    if (state.handNumber !== prev.handNumber) return;
    const actorId = prev.playerIds[prev.currentPlayerIndex] ?? null;
    if (!actorId || actorId === you) return;

    const prevBoardCount = getBoardTileCount(prev.board);
    const nextBoardCount = getBoardTileCount(state.board);
    let action: MoveEntry['action'] = 'pass';
    if (nextBoardCount > prevBoardCount) action = 'place';
    else if ((state.boneyard?.length ?? 0) < (prev.boneyard?.length ?? 0)) action = 'draw';
    if (action === 'place') {
      flashLastPlayed(findPlacedTile(prev.board, state.board));
    }

    appendMultiplayerMove({
      player: 'opponent',
      action,
      boardEnds: getBoardEnds(prev.board),
      handBefore: [],
      validMoves: [],
      pipDelta: 0,
      pointsScored: 0,
      boardState: snapshotBoardState(prev.board),
      boardRenderState: cloneBoardState(prev.board),
      handSnapshot: (prev.players[you]?.hand ?? []).map(toTileTuple),
      engineBestMove: null,
    });
  }, [state, you, appendMultiplayerMove, flashLastPlayed]);

  useEffect(() => {
    if (prevOppCountRef.current !== null && prevOppCountRef.current !== opponentTileCount) {
      const t = setTimeout(() => {}, 250);
      prevOppCountRef.current = opponentTileCount;
      return () => clearTimeout(t);
    }
    prevOppCountRef.current = opponentTileCount;
  }, [opponentTileCount]);

  const opponent = players.find((pl) => pl.id !== you) ?? null;
  const opponentName = tournamentMatch
    ? tournamentOpponentLabel ?? 'Opponent'
    : opponent?.username
      ? opponent.username.startsWith('@')
        ? opponent.username
        : `@${opponent.username}`
      : 'Rival';

  useEffect(() => {
    if (!state) return;

    const nextScores: Record<string, number> = {};
    const nextPulse: Record<string, boolean> = {};
    let changed = false;

    for (const pid of state.playerIds) {
      const score = state.players[pid]?.score ?? 0;
      const prevScore = prevHudScoresRef.current[pid];
      nextScores[pid] = score;
      if (prevScore !== undefined && prevScore !== score) {
        nextPulse[pid] = true;
        changed = true;
        const delta = score - prevScore;
        if (delta > 0 && !state.handOver && !state.gameOver) {
          playScoreSound(delta, isMutedRef.current);
          if (pid === you) {
            showScoreToast('you', delta, 'You');
          } else {
            const playerName =
              players.find((p) => p.id === pid)?.username?.trim() || opponentName || 'Opponent';
            showScoreToast('opp', delta, playerName);
          }
        }
      }
    }

    prevHudScoresRef.current = nextScores;
    if (!changed) return;

    setHudScorePulse(nextPulse);
    const timeout = setTimeout(() => setHudScorePulse({}), 260);
    return () => clearTimeout(timeout);
  }, [state, you, players, opponentName, showScoreToast, isMutedRef]);

  useEffect(() => {
    const finalState = state;
    const isGameOver = Boolean(finalState?.gameOver);
    if (!isGameOver) {
      prevGameOverRef.current = false;
      matchRecordKeyRef.current = '';
      return;
    }
    if (!finalState) return;
    if (prevGameOverRef.current) return;
    prevGameOverRef.current = true;
    if (!joinedRoom) return;

    const winnerSocketId = finalState?.winnerId ?? null;
    if (!winnerSocketId) return;
    if (winnerSocketId === you) {
      playMatchWinSound(isMutedRef.current);
    } else {
      playMatchLoseSound(isMutedRef.current);
    }
    if (winnerSocketId === you) {
      const canvas = confettiCanvasRef.current;
      if (canvas) {
        void import('canvas-confetti')
          .then(({ default: confetti }) => {
            const myConfetti = confetti.create(canvas, { resize: true, useWorker: true });
            const colors = ['#2ecc8e', '#95f0ca', '#d8b56f', '#ffffff', '#f59e0b'];

            myConfetti({
              particleCount: 120,
              spread: 100,
              origin: { x: 0.5, y: 0.4 },
              colors,
              scalar: 1.3,
            });
            setTimeout(
              () =>
                myConfetti({
                  particleCount: 80,
                  spread: 120,
                  origin: { x: 0.2, y: 0.5 },
                  colors,
                  scalar: 1.1,
                }),
              200,
            );
            setTimeout(
              () =>
                myConfetti({
                  particleCount: 80,
                  spread: 120,
                  origin: { x: 0.8, y: 0.5 },
                  colors,
                  scalar: 1.1,
                }),
              400,
            );
          })
          .catch(() => {});
      }
    }
    const loserSocketId = finalState.playerIds.find((pid) => pid !== winnerSocketId) ?? null;
    if (!loserSocketId) return;

    const key = `${joinedRoom}:${winnerSocketId}:${loserSocketId}`;
    if (matchRecordKeyRef.current === key) return;
    matchRecordKeyRef.current = key;

    if (!supabaseEnabled || !authUser) return;

    const bySocketId = new Map(players.map((p) => [p.id, p.userId ?? null] as const));
    let winnerUserId = bySocketId.get(winnerSocketId) ?? null;
    let loserUserId = bySocketId.get(loserSocketId) ?? null;

    if (winnerSocketId === you) {
      winnerUserId = authUser.id;
    } else if (loserSocketId === you) {
      loserUserId = authUser.id;
    }

    if (winnerUserId !== authUser.id && loserUserId !== authUser.id) return;
    if (winnerUserId && loserUserId) return;

    const winnerScore = finalState.players[winnerSocketId]?.score ?? null;
    const loserScore = finalState.players[loserSocketId]?.score ?? null;

    void Promise.all([import('../analyzer/moveAnalyzer'), import('../stats/statsApi')])
      .then(([{ analyzeMoveLogDeferred }, { recordMatchResult }]) =>
        analyzeMoveLogDeferred(multiplayerMoveLog, true, { oracleMode: 'tier', tierPlayed: 'standard' }).then(
          (matchAnalysis) => {
            const avgMoveQuality =
              matchAnalysis.analyzedMoves.length > 0 && matchAnalysis.accuracy > 0
                ? matchAnalysis.accuracy
                : undefined;

            return recordMatchResult({
              mode: 'online',
              opponentType: 'online',
              winnerUserId,
              loserUserId,
              winnerScore,
              loserScore,
              avgMoveQuality,
              moveCount: null,
              roomCode: joinedRoom,
              metadata: { roomCode: joinedRoom, winnerSocketId, loserSocketId },
            });
          },
        ),
      )
      .catch(() => {});
  }, [
    authUser,
    isMutedRef,
    joinedRoom,
    multiplayerMoveLog,
    players,
    state,
    supabaseEnabled,
    you,
  ]);

  const openMultiplayerAnalyzer = useCallback(() => {
    void import('../analyzer/moveAnalyzer').then(({ analyzeMoveLogDeferred, saveGameAnalysis }) => {
      void analyzeMoveLogDeferred(multiplayerMoveLog, true, { oracleMode: 'tier', tierPlayed: 'standard' }).then(
        (analysis) => {
          setCurrentAnalysis(analysis);
          saveGameAnalysis('multiplayer', analysis);
          setAnalyzerOpen(true);
        },
      );
    });
  }, [multiplayerMoveLog]);

  const isHandActive = Boolean(state) && !state?.handOver && !state?.gameOver;
  const handCompactStacked = myHand.length > 9;
  const opponentId = state?.playerIds.find((pid) => pid !== you) ?? null;
  const myScore = state?.players[you]?.score ?? 0;
  const opponentScore = opponentId ? (state?.players[opponentId]?.score ?? 0) : 0;
  const myName = authProfile?.username ? `@${authProfile.username}` : 'you';
  const spectateRightPlayerId = isSpectatingMatch ? (state?.playerIds?.[1] ?? null) : null;
  const spectateRightPlayer = spectateRightPlayerId
    ? (players.find((pl) => pl.id === spectateRightPlayerId) ?? null)
    : null;
  const hudRightLabel = isSpectatingMatch
    ? spectateRightPlayer?.username
      ? `@${spectateRightPlayer.username}`
      : 'Spectating'
    : myName;
  const hudRightScore =
    isSpectatingMatch && spectateRightPlayerId
      ? (state?.players[spectateRightPlayerId]?.score ?? 0)
      : myScore;
  const hudRightScorePulse = isSpectatingMatch
    ? spectateRightPlayerId
      ? Boolean(hudScorePulse[spectateRightPlayerId])
      : false
    : Boolean(hudScorePulse[you]);
  const openEndsSum = state?.board ? computeOpenEndsSum(state.board) : 0;
  if (state?.board) {
    assertDisplayedOpenCountMatchesCanonical(state.board, openEndsSum, 'multiplayer');
  }
  const canUseRematch = Boolean(
    state?.gameOver &&
      joinedRoom &&
      !isSpectatingMatch &&
      !isTournamentMatch &&
      state.playerIds.includes(you),
  );
  const isRoomHost = players[0]?.id === you;
  const rematchWaitingText = rematchRequested
    ? (() => {
        const readyNames = rematchReadyIds
          .map((pid) => {
            if (pid === you) return 'You';
            const player = players.find((pl) => pl.id === pid);
            return player?.username ? `@${player.username}` : 'Opponent';
          })
          .join(', ');
        return readyNames ? `Waiting for opponent... Ready: ${readyNames}` : 'Waiting for opponent...';
      })()
    : undefined;
  const multiplayerRatingEligible = Boolean(
    !isTournamentMatch &&
      !isSpectatingMatch &&
      authUser &&
      players.length === 2 &&
      players.every((p) => Boolean(p.userId)),
  );
  const multiplayerRatingSummary =
    multiplayerRatingEligible && state?.gameOver
      ? {
          pending: multiplayerRatingPending,
          delta:
            multiplayerRatingBaseline != null && authProfile?.glicko_rating != null
              ? Math.round(Number(authProfile.glicko_rating) - multiplayerRatingBaseline)
              : null,
          newRating:
            authProfile?.glicko_rating != null ? Math.round(Number(authProfile.glicko_rating)) : null,
        }
      : null;

  const routeProps = useMemo((): MultiplayerGameRouteProps => {
    return {
      state,
      pendingUiAction,
      opponentId,
      opponentName,
      myName,
      myScore,
      opponentScore,
      opponentTileCount,
      isMyTurn,
      isHandActive,
      hudScorePulse,
      hudRightLabel,
      hudRightScore,
      hudRightScorePulse,
      opponentPillRef,
      boneyardRef,
      boneyardCount,
      openEndsSum,
      boardRef,
      handAreaRef,
      confettiCanvasRef,
      boardForDisplay,
      boardLegalMoves,
      boardSelectedTile,
      lastPlayedTile,
      boardShowOpenEndGlow,
      play,
      myHand,
      handSelectedTile,
      handleTileTap,
      legalMoves,
      handTileSize,
      handCompactStacked,
      drawPulseIndex,
      scoreToast,
      scoreTrackOpen,
      setScoreTrackOpen,
      opponentDisconnected,
      opponentDisconnectMessage,
      handReveal,
      handRevealAutoProgress,
      flyingTiles,
      canUseRematch,
      rematchRequested,
      rematchWaitingText,
      requestRematch,
      multiplayerRatingSummary,
      openMultiplayerAnalyzer,
      showLeaveConfirm,
      setShowLeaveConfirm,
      startGame,
      actionError,
      isRoomHost,
      preGameDraw,
      onPregameTileTap,
    };
  }, [
    actionError,
    boardForDisplay,
    boardLegalMoves,
    boardRef,
    boardSelectedTile,
    boardShowOpenEndGlow,
    boneyardCount,
    boneyardRef,
    canUseRematch,
    confettiCanvasRef,
    drawPulseIndex,
    flyingTiles,
    handAreaRef,
    handCompactStacked,
    handReveal,
    handRevealAutoProgress,
    handSelectedTile,
    handTileSize,
    handleTileTap,
    hudRightLabel,
    hudRightScore,
    hudRightScorePulse,
    hudScorePulse,
    isHandActive,
    isMyTurn,
    isRoomHost,
    lastPlayedTile,
    legalMoves,
    multiplayerRatingSummary,
    myHand,
    myName,
    myScore,
    openEndsSum,
    openMultiplayerAnalyzer,
    opponentDisconnected,
    opponentDisconnectMessage,
    opponentId,
    opponentName,
    opponentPillRef,
    opponentScore,
    opponentTileCount,
    pendingUiAction,
    play,
    rematchRequested,
    rematchWaitingText,
    requestRematch,
    scoreToast,
    scoreTrackOpen,
    setShowLeaveConfirm,
    showLeaveConfirm,
    startGame,
    state,
    preGameDraw,
    onPregameTileTap,
  ]);

  const bridge = useMemo(
    (): MultiplayerGameShellBridge => ({
      stateRef,
      draggingStateRef,
      handRevealShownRef,
      handRevealTimerRef,
      rematchAwaitingStateRef,
      setState,
      setLegalMoves,
      setCanDraw,
      setRematchRequested,
      setRematchReadyIds,
      setOpponentDragging,
      setHandReveal,
      setSelectedTile,
      setPendingUiAction,
      setActionError,
      clearTransientRoomUi,
      applyJoinResponseGameState,
      resetShellClientGameSession,
      inGame,
    }),
    [
      applyJoinResponseGameState,
      clearTransientRoomUi,
      draggingStateRef,
      handRevealShownRef,
      handRevealTimerRef,
      inGame,
      rematchAwaitingStateRef,
      resetShellClientGameSession,
      setActionError,
      setCanDraw,
      setHandReveal,
      setLegalMoves,
      setOpponentDragging,
      setPendingUiAction,
      setRematchReadyIds,
      setRematchRequested,
      setSelectedTile,
      setState,
      stateRef,
    ],
  );

  useLayoutEffect(() => {
    sharedGameplayRefs.stateRef.current = stateRef.current;
    sharedGameplayRefs.draggingStateRef.current = draggingStateRef.current;
    sharedGameplayRefs.handRevealShownRef.current = handRevealShownRef.current;
    sharedGameplayRefs.handRevealTimerRef.current = handRevealTimerRef.current;
    sharedGameplayRefs.rematchAwaitingStateRef.current = rematchAwaitingStateRef.current;
  });

  useLayoutEffect(() => {
    shellBridgeRef.current = bridge;
    return () => {
      shellBridgeRef.current = null;
      resetGameSnapshot();
    };
  }, [bridge, shellBridgeRef]);

  useEffect(() => {
    const snapshot: MultiplayerGameSnapshot = {
      routeProps,
      inGame,
      liveGameOver: Boolean(state?.gameOver),
      hasState: Boolean(state),
    };
    publishGameSnapshot(snapshot);
  }, [inGame, routeProps, state]);

  void boneyardDisplayCount;
  void canDraw;
  void opponentDragging;
  void optimisticPlayedTile;
  void _setOptimisticPlayedTile;
  void _pendingForcedHandRevealRef;
  void selectedTile;
  void youRef;

  return (
    <GameReviewer
      open={analyzerOpen}
      onClose={() => setAnalyzerOpen(false)}
      analysis={currentAnalysis}
      title="Game Review"
    />
  );
}

export const MultiplayerGameShell = React.memo(MultiplayerGameShellComponent);
