import React, { Suspense, useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Socket } from 'socket.io-client';
import './App.css';
import './match/match-live.css';
import type { BoardHandle } from './components';
import { ScreenLoader } from './ui/ScreenLoader';
import {
  playDrawSound,
  playMatchLoseSound,
  playMatchWinSound,
  playScoreSound,
  playTileSound,
} from './utils/sound';
import { isTemporaryUsername, useAuth } from './auth/useAuth';
import type { GameAnalysis } from './analyzer/moveAnalyzer';
import {
  type MoveEntry,
  snapshotBoardState,
  cloneBoardState,
  toTileTuple,
} from './analyzer/moveLogger';
import { fetchGhostProfileSummary, type GhostProfileSummary } from './ghost/api';
import type { GameState } from './types';
import type { BotDealSize } from './bot/botEngine';
import {
  assertDisplayedOpenCountMatchesCanonical,
  computeOpenEndsSum,
} from './game/openEndsGeometry';
import type { FritzTier } from './bot/fritzConfig';
import { resolveDefaultPvfFritzTier, writeStoredPvfFritzTier } from './bot/pvfTierPreference';
import { resolveGameServerUrl } from './lib/gameServerUrl';
import { useRoomSocketSync, type StateUpdatePayload } from './multiplayer/useRoomSocketSync';
import { hasHandIdentityMismatch } from './multiplayer/handIdentity';
import { isRenderableMultiplayerSnapshot } from './multiplayer/boardSnapshotGuards';
import {
  useLiveMatchSession,
  findPlacedTile,
  getBoardEnds,
  getBoardTileCount,
} from './match/session/useLiveMatchSession';
import { useTournamentMatchSession } from './match/session/useTournamentMatchSession';
import { useMultiplayerConnectionHostParams } from './multiplayer/useMultiplayerConnectionHostParams';
import { useMultiplayerConnectionActionsBridge } from './multiplayer/useMultiplayerConnectionContext';
import { useMultiplayerRoomSocialRuntimeBridge } from './multiplayer/useMultiplayerLobbyController';
import { useMultiplayerLobbyHostProps } from './multiplayer/useMultiplayerLobbyHostProps';
import { AuthModalsLayer, FriendInvitePopupOverlay } from './AppOverlays';
import type {
  MultiplayerLiveMatchRecoveryRuntime,
  MultiplayerLiveMatchRoomRuntime,
  MultiplayerRoomRecoverySetters,
  MultiplayerSessionRefsRuntime,
} from './multiplayer/multiplayerRuntime';
import { useRenderProfiler } from './debug/renderProfiler';
import { useTournament } from './tournament/useTournament';
import { isTerminalTournamentMatch } from './tournament/terminalMatches';
import type { OutboundChallenge } from './multiplayer/friendChallenge';
import type { MatchFoundPayload } from './matchmaking/types';
import {
  emitWithAck,
  emitRoomAbandonMatch,
  emitRoomCreate,
  emitRoomJoin,
} from './multiplayer/roomTransport';
import {
  clearLastRoomCode,
  getOrCreateGuestIdentityId,
  LAST_ROOM_STORAGE_KEY,
  readRoomInviteCodeFromLocation,
  saveLastRoomCode,
  shouldPersistLastRoomCode,
} from './match/recovery/matchRecovery';

// ─── Utilities ───────────────────────────────────────────────
type RoomPlayer = { id: string; username: string; userId: string | null };
type RoomEventMeta = {
  matchId?: string;
  lastEventSequence?: number;
  eventCount?: number;
};
type RoomRecoveryState = 'idle' | 'reconnecting' | 'resyncing' | 'failed';

import type { AppMode } from './appRouteTypes';
import { LEARN_MODE_VISIBLE } from './appRouteTypes';
import { useAppRoutesProps } from './useAppRoutesProps';
import { useAppRoutesInput } from './useAppRoutesInput';
import { useAppSessionRuntime } from './useAppSessionRuntime';

const AppRoutes = React.lazy(() => import('./AppRoutes'));




function normalizeUsername(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  return raw || 'Guest';
}

function normalizeRoomCode(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function normalizeRoomPlayers(value: unknown): RoomPlayer[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === 'string') {
        return { id: entry, username: 'Guest', userId: null };
      }
      if (entry && typeof entry === 'object') {
        const rec = entry as { id?: unknown; username?: unknown; userId?: unknown };
        const id = typeof rec.id === 'string' ? rec.id : '';
        const userId = typeof rec.userId === 'string' ? rec.userId.trim() || null : null;
        return { id, username: normalizeUsername(rec.username), userId };
      }
      return { id: '', username: 'Guest', userId: null };
    })
    .filter((p) => Boolean(p.id));
}



// ─── Main App ────────────────────────────────────────────────

const SOCKET_MODES = new Set<AppMode>(['multiplayer', 'bot', 'botSetup', 'ghost', 'ghostSetup']);

const MODE_TO_PATH: Partial<Record<AppMode, string>> = {
  home: '/',
  stats: '/stats',
  friends: '/friends',
  daily: '/daily',
  dailyFritz: '/daily-fritz',
  ratingHistory: '/rating-history',
  singlePlayerHub: '/solo',
  tournament: '/tournament',
  noBrainer: '/practice',
  learn: '/learn',
  guidedMatchRecorder: '/learn/recorder',
  guidedMatchAnnotator: '/learn/guided-annotator',
};

const PATH_TO_MODE: Record<string, AppMode> = Object.fromEntries(
  Object.entries(MODE_TO_PATH).map(([mode, path]) => [path, mode as AppMode])
);

export default function App() {
  useRenderProfiler('App');
  const appRootRef = useRef<HTMLDivElement>(null);
  const trayCenterRef = useRef<HTMLDivElement>(null);
  const autoConnectAttemptedRef = useRef(false);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const connectRef = useRef<() => void>(() => {});
  const connectionActions = useMultiplayerConnectionActionsBridge(connectRef);
  const pendingCreateOnConnectRef = useRef(false);
  const pendingCreateResolversRef = useRef<Array<(code: string | null) => void>>([]);
  const [serverUrl] = useState(() => resolveGameServerUrl());
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const navigate = useNavigate();
  const [appMode, setAppMode] = useState<AppMode>(() => {
    const hash = window.location.hash.replace(/^#/, '') || '/';
    const mode = PATH_TO_MODE[hash];
    return mode && !SOCKET_MODES.has(mode) ? mode : 'home';
  });
  const [selectedLearnLessonId, setSelectedLearnLessonId] = useState<string | null>(null);
  const [learnHowToPlayOpen, setLearnHowToPlayOpen] = useState(false);
  const [mpSubView, setMpSubView] = useState<'quick' | 'private'>('quick');
  const [overlayPayload, setOverlayPayload] = useState<MatchFoundPayload | null>(null);
  const [isMuted, setIsMuted] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('racehorse_muted') === '1';
  });
  const [botDealSize, setBotDealSize] = useState<BotDealSize>(() => {
    if (typeof window === 'undefined') return 7;
    const stored = window.localStorage.getItem('racehorse_bot_deal_size');
    return stored === '14' ? 14 : 7;
  });
  const [botFritzTier, setBotFritzTier] = useState<FritzTier>(() => resolveDefaultPvfFritzTier());
  const [isGuidedMode, setIsGuidedMode] = useState(false);
  const [isAuthoringMode, setIsAuthoringMode] = useState(false);
  const [isAuthoringV2Mode, setIsAuthoringV2Mode] = useState(false);
  const [isGuidedV2Mode, setIsGuidedV2Mode] = useState(false);
  const [ghostProfile, setGhostProfile] = useState<GhostProfileSummary | null>(null);
  const [ghostOpponentName, setGhostOpponentName] = useState<string>('Ghost');
  const [ghostOpponentUserId, setGhostOpponentUserId] = useState<string | null>(null);

  const [profileTarget, setProfileTarget] = useState<string | null>(null);

  const [roomCode, setRoomCode] = useState('');
  const [tournamentCode, setTournamentCode] = useState('');
  const [tournamentId, setTournamentId] = useState<string | null>(null);
  const [tournamentState, setTournamentState] = useState<any>(null);
  const [tournamentActiveRoom, setTournamentActiveRoom] = useState<string | null>(null);
  const roomSocialRuntime = useMultiplayerRoomSocialRuntimeBridge();
  const [multiplayerRatingBaseline, setMultiplayerRatingBaseline] = useState<number | null>(null);
  const [multiplayerRatingPending, setMultiplayerRatingPending] = useState(false);
  const multiplayerRatingRefreshKeyRef = useRef('');
  const [privateLobbyHostWinStreak, setPrivateLobbyHostWinStreak] = useState<number | null>(null);

  // Sync appMode → URL hash (side effect only; appMode is still source of truth)
  useEffect(() => {
    const path = SOCKET_MODES.has(appMode) ? '/' : (MODE_TO_PATH[appMode] ?? '/');
    navigate(path, { replace: true });
  }, [appMode, navigate]);

  useEffect(() => {
    if (!LEARN_MODE_VISIBLE && appMode === 'learn') {
      setSelectedLearnLessonId(null);
      setLearnHowToPlayOpen(false);
      setAppMode('singlePlayerHub');
    }
  }, [appMode]);

  useEffect(() => {
    if (appMode !== 'learn') {
      setLearnHowToPlayOpen(false);
    }
  }, [appMode]);

  const [joinedRoom, setJoinedRoom] = useState<string | null>(null);
  const [you, setYou] = useState<string>('');
  const [players, setPlayers] = useState<RoomPlayer[]>([]);
  const [error, setError] = useState<string>('');
  const [toast, setToast] = useState<string>('');

  const showToast = useCallback((msg: string, duration = 3000) => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    setToast(msg);
    toastTimeoutRef.current = setTimeout(() => setToast(''), duration);
  }, []);
  const [scoreToast, setScoreToast] = useState<{
    message: string;
    tone: 'you' | 'opp';
    visible: boolean;
  } | null>(null);
  const [scoreTrackOpen, setScoreTrackOpen] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [abandonedMatchNotice, setAbandonedMatchNotice] = useState<{
    context: 'tournament' | 'multiplayer';
    title: string;
    detail: string;
    tournamentId?: string | null;
  } | null>(null);
  const [multiplayerMoveLog, setMultiplayerMoveLog] = useState<MoveEntry[]>([]);
  const multiplayerMoveCounterRef = useRef(1);
  const previousStateForAnalysisRef = useRef<GameState | null>(null);
  const [analyzerOpen, setAnalyzerOpen] = useState(false);
  const [currentAnalysis, setCurrentAnalysis] = useState<GameAnalysis | null>(null);
  const {
    user: authUser,
    profile: authProfile,
    accessToken: authAccessToken,
    loading: authLoading,
    justVerified,
    supabaseEnabled,
    supabaseConfigError,
    signIn,
    signUp,
    resetPassword,
    updatePassword,
    passwordRecoveryPending,
    clearPasswordRecoveryPending,
    signOut,
    updateUsername,
    refreshAuthProfile,
    applyProfilePatch,
  } = useAuth();
  const [guestIdentityId] = useState(getOrCreateGuestIdentityId);
  const multiplayerIdentityUserId = authUser?.id ?? guestIdentityId;
  const multiplayerAuthToken = authUser?.id ? authAccessToken : null;
  // Single tournament hook instance, shared by Hub/Bracket/Result screens.
  // Hoisted from the screens so that registration changes / bracket updates /
  // pending match-ready events are observed in App.tsx and can trigger top-level
  // navigation (auto-route to result on tournament:completed).
  const tournament = useTournament({
    socket,
    userId: authUser?.id ?? null,
  });

  const authUserRef = useRef(authUser);
  const authProfileRef = useRef(authProfile);
  const authAccessTokenRef = useRef<string | null>(authAccessToken);
  const multiplayerIdentityUserIdRef = useRef(multiplayerIdentityUserId);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [weeklyStatsOpen, setWeeklyStatsOpen] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [serverWaking, setServerWaking] = useState(false);
  const [weeklyAwards, setWeeklyAwards] = useState<any | null>(null);
  const [playersOnlineCount, setPlayersOnlineCount] = useState<number | null>(null);
  const [friendInvite, setFriendInvite] = useState<{
    inviteId: string;
    fromUsername: string;
    fromUserId: string | null;
    roomCode: string;
    inviteUrl: string;
    matchSummary: string;
  } | null>(null);
  const [outboundChallenge, setOutboundChallenge] = useState<OutboundChallenge | null>(null);
  const clearOutboundChallenge = useCallback(() => setOutboundChallenge(null), []);

  useEffect(() => {
    if (!authUser) {
      setGhostProfile(null);
      return;
    }
    let active = true;
    void fetchGhostProfileSummary(authUser.id)
      .then((summary) => {
        if (active) setGhostProfile(summary);
      })
      .catch(() => {
        if (active) setGhostProfile(null);
      });
    return () => {
      active = false;
    };
  }, [authUser]);

  const loadWeeklyAwards = useCallback(() => {
    if (!socket || !socket.connected) return;
    socket.emit("stats:weekly", (resp: any) => {
      if (!resp?.ok) return;
      setWeeklyAwards(resp.awards ?? null);
    });
  }, [socket]);

  const [usernameModalOpen, setUsernameModalOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const appModeRef = useRef(appMode);
  const mpSubViewRef = useRef(mpSubView);
  const roomPlayersRef = useRef<RoomPlayer[]>([]);
  const joinedRoomResponseRef = useRef<any>(null);
  const roomIdentityRef = useRef<{
    username: string;
    userId: string | null;
    authToken: string | null;
  } | null>(null);

  useEffect(() => {
    appModeRef.current = appMode;
  }, [appMode]);
  useEffect(() => {
    mpSubViewRef.current = mpSubView;
  }, [mpSubView]);

  const joinedRoomRef = useRef<string | null>(null);
  const reconnectRoomCodeRef = useRef<string | null>(null);
  const reconnectShouldJoinRef = useRef(false);
  const preventAutoRejoinRef = useRef(false);
  const autoJoinAttemptedRef = useRef(false);
  const joinInFlightRef = useRef(false);
  const clearRecoverableRoomStateRef = useRef<() => void>(() => {});
  const resetMultiplayerRoomStateRef = useRef<
    (options?: { keepPlayers?: boolean; clearRoomCode?: boolean }) => void
  >(() => {});
  const createInFlightRef = useRef(false);
  const inviteJoinInFlightRef = useRef(false);
  const rejoinInFlightRef = useRef(false);
  const intentionalDisconnectRef = useRef(false);
  const reconnectAttemptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptCountRef = useRef(0);
  const previousMultiplayerGameOverRef = useRef(false);
  const maxSequenceRef = useRef<number>(-1);
  const [isRecoveringConnection, setIsRecoveringConnection] = useState(false);
  const [roomRecoveryState, setRoomRecoveryState] = useState<RoomRecoveryState>('idle');
  const [roomRecoveryMessage, setRoomRecoveryMessage] = useState('');
  const roomMatchIdRef = useRef<string | null>(null);
  const maxEventSequenceRef = useRef<number>(-1);

  useEffect(() => {
    maxSequenceRef.current = -1;
    maxEventSequenceRef.current = -1;
    roomMatchIdRef.current = null;
  }, [joinedRoom]);

  const isMutedRef = useRef(isMuted);
  const applyRoomEventMetaRef = useRef<(meta?: RoomEventMeta | null) => void>(() => {});
  const fetchGameStateRef = useRef<(reason: string) => Promise<boolean>>(async () => false);
  const resetClientGameSessionRef = useRef<() => void>(() => {});
  const resyncInFlightRef = useRef(false);
  const resyncCooldownUntilRef = useRef(0);
  const resyncBufferedUpdateRef = useRef<StateUpdatePayload | null>(null);
  const resyncFlushRef = useRef<(() => void) | null>(null);
  const playerReadyEmittedRef = useRef(false);
  const isSeatedPlayerRef = useRef(false);
  const matchStartedRef = useRef(false);
  const schedulePlayerReadyRef = useRef<() => Promise<void>>(async () => {});
  const applyJoinedRoomResponseRef = useRef<(resp: any) => void>(() => {});
  const trySchedulePlayerReadyRef = useRef<() => void>(() => {});

  const appendMultiplayerMove = useCallback((entry: Omit<MoveEntry, 'moveNumber'>) => {
    const moveNumber =
      entry.player === 'you'
        ? multiplayerMoveCounterRef.current++
        : multiplayerMoveCounterRef.current;
    setMultiplayerMoveLog((prev) => [...prev, { ...entry, moveNumber }]);
  }, []);

  const liveMatchRoomRuntime = useMemo(
    (): MultiplayerLiveMatchRoomRuntime => ({
      joinedRoomRef,
      maxSequenceRef,
      roomPlayersRef,
    }),
    [],
  );

  const liveMatchRecoverySetters = useMemo(
    (): MultiplayerRoomRecoverySetters => ({
      setRoomRecoveryState,
      setRoomRecoveryMessage,
    }),
    [],
  );

  const liveMatchSessionRefsRuntime = useMemo(
    (): MultiplayerSessionRefsRuntime => ({
      isSeatedPlayerRef,
      matchStartedRef,
      playerReadyEmittedRef,
      trySchedulePlayerReadyRef,
      isMutedRef,
    }),
    [],
  );

  const liveMatchRecoveryRuntime = useMemo(
    (): MultiplayerLiveMatchRecoveryRuntime => ({
      resyncInFlightRef,
      resyncBufferedUpdateRef,
      resyncFlushRef,
      fetchGameState: (reason) => fetchGameStateRef.current(reason),
      resetClientGameSession: () => resetClientGameSessionRef.current(),
    }),
    [],
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
    applyRoomEventMeta: (meta) => applyRoomEventMetaRef.current(meta),
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
    lastPlayedTileTimerRef,
    youRef,
    clearTransientRoomUi,
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
  } = liveMatch;

  const onTournamentMatchAbandoned = useCallback(
    (notice: {
      context: 'tournament';
      title: string;
      detail: string;
      tournamentId: string;
    }) => {
      setAbandonedMatchNotice(notice);
    },
    [],
  );
  const onPrivateMatchAbandoned = useCallback(
    (notice: { context: 'multiplayer'; title: string; detail: string }) => {
      setAbandonedMatchNotice(notice);
    },
    [],
  );

  const {
    socketRuntime,
    joinFlightRuntime,
    reconnectRuntime,
    authRuntime,
    navigationRuntime,
    roomRuntime,
    tournamentAttachRuntime,
  } = useAppSessionRuntime({
    socketRef,
    connectRef,
    pendingCreateOnConnectRef,
    pendingCreateResolversRef,
    autoJoinAttemptedRef,
    joinInFlightRef,
    createInFlightRef,
    inviteJoinInFlightRef,
    autoConnectAttemptedRef,
    reconnectRoomCodeRef,
    reconnectShouldJoinRef,
    preventAutoRejoinRef,
    reconnectAttemptTimerRef,
    reconnectAttemptCountRef,
    intentionalDisconnectRef,
    rejoinInFlightRef,
    authUserRef,
    authProfileRef,
    authAccessTokenRef,
    multiplayerIdentityUserIdRef,
    appModeRef,
    setAppMode,
    joinedRoomRef,
    joinedRoomResponseRef,
    roomIdentityRef,
    youRef,
    stateRef,
    maxSequenceRef,
    roomPlayersRef,
    applyJoinedRoomResponseRef,
    clearRecoverableRoomStateRef,
    resetMultiplayerRoomStateRef,
  });

  const tournamentSession = useTournamentMatchSession({
    socket,
    attachRuntime: tournamentAttachRuntime,
    appMode,
    authUserId: authUser?.id ?? null,
    multiplayerIdentityUserId,
    joinedRoom,
    liveGameOver: state?.gameOver,
    showToast,
    setActionError,
    normalizeRoomCode,
    tournament,
    onTournamentMatchAbandoned,
    onPrivateMatchAbandoned,
  });

  const {
    tournamentSubView,
    setTournamentSubView,
    activeTournamentId,
    setActiveTournamentId,
    tournamentMatch,
    setTournamentMatch,
    currentTournamentContext,
    tournamentAttachPhase,
    tournamentAttachError,
    tournamentResult,
    setTournamentResult,
    tournamentResultLoading,
    setTournamentResultLoading,
    tournamentResultError,
    setTournamentResultError,
    consumedTournamentGameOverMatchIdsRef,
    clearTournamentAttachRefs,
    applyTournamentMetadataFromJoin,
    attachAssignedTournamentMatch,
    exitToTournamentHub,
    enterTournamentLobby,
    navigateAfterTournamentMatch,
  } = tournamentSession;

  useRoomSocketSync(roomSocketSyncParams);

  const [handTileSize, setHandTileSize] = useState(44);
  const prevOppCountRef = useRef<number | null>(null);
  const [oppTilePulse, setOppTilePulse] = useState(false);
  const prevBoardTileCountRef = useRef(0);
  const prevTurnIdRef = useRef<string | null>(null);
  const [hudScorePulse, setHudScorePulse] = useState<Record<string, boolean>>({});
  const prevHudScoresRef = useRef<Record<string, number>>({});
  const prevMyHandLenRef = useRef(0);
  const boardRef = useRef<BoardHandle>(null);
  const confettiCanvasRef = useRef<HTMLCanvasElement>(null);
  const matchRecordKeyRef = useRef('');
  const prevGameOverRef = useRef(false);
  const scoreToastHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scoreToastClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const adminEmail = import.meta.env.VITE_ADMIN_EMAIL as string | undefined;
  const isAdmin = Boolean(
    authUser?.email && adminEmail && authUser.email.toLowerCase() === adminEmail.toLowerCase(),
  );
  const canOpenHowToPlayPreview = true;
  const needsUsernameOnboarding = Boolean(
    authUser && !authLoading && authProfile !== null && isTemporaryUsername(authProfile.username),
  );
  const [onboardingDismissed, setOnboardingDismissed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const raw = window.localStorage.getItem('username_onboarding_dismissed');
    if (!raw) return false;
    // Only snooze for 24 hours - after that the prompt returns
    const dismissedAt = parseInt(raw, 10);
    const SNOOZE_MS = 24 * 60 * 60 * 1000;
    return Date.now() - dismissedAt < SNOOZE_MS;
  });

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
      if (scoreToastHideTimerRef.current) clearTimeout(scoreToastHideTimerRef.current);
      if (scoreToastClearTimerRef.current) clearTimeout(scoreToastClearTimerRef.current);
      if (reconnectAttemptTimerRef.current) clearTimeout(reconnectAttemptTimerRef.current);
    };
  }, []);

  const clearReconnectAttemptTimer = useCallback(() => {
    if (reconnectAttemptTimerRef.current) {
      clearTimeout(reconnectAttemptTimerRef.current);
      reconnectAttemptTimerRef.current = null;
    }
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
      const currentScore = player === 'you'
        ? (stateRef.current?.players[you]?.score ?? 0)
        : (stateRef.current?.players[stateRef.current?.playerIds.find(p => p !== you) ?? '']?.score ?? 0);
      showScoreLikeToast(`${label ?? (player === 'you' ? 'You' : 'Opponent')} scored +${points} · ${currentScore} pts`, player);
    },
    [showScoreLikeToast, you],
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hasSeen = window.localStorage.getItem('hasSeenWelcome');
    if (!hasSeen) setWelcomeOpen(true);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('racehorse_bot_deal_size', String(botDealSize));
  }, [botDealSize]);

  useEffect(() => {
    writeStoredPvfFritzTier(botFritzTier);
  }, [botFritzTier]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('racehorse_muted', isMuted ? '1' : '0');
  }, [isMuted]);


  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    authUserRef.current = authUser;
  }, [authUser]);

  useEffect(() => {
    authProfileRef.current = authProfile;
  }, [authProfile]);

  useEffect(() => {
    authAccessTokenRef.current = authAccessToken;
  }, [authAccessToken]);

  useEffect(() => {
    multiplayerIdentityUserIdRef.current = multiplayerIdentityUserId;
  }, [multiplayerIdentityUserId]);

  useEffect(() => {
    if (justVerified) {
      showToast('✓ Email verified! Welcome to Racehorse Dominoes.', 5000);
    }
  }, [justVerified, showToast]);

  useEffect(() => {
    socketRef.current = socket;
  }, [socket]);

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
  }, [state, setDrawSequenceActiveBoth]);

  useEffect(() => {
    if (!socket || !authUser?.id) return;

    const username = authProfile?.username ?? authUser.email?.split('@')[0] ?? 'player';

    const emitIdentify = () => {
      console.log('[presence] emitting presence:identify', { userId: authUser.id, connected: socket.connected });
      socket.emit('presence:identify', { userId: authUser.id, username, authToken: authAccessToken }, () => {
        console.log('[presence] identify ack received');
      });
    };

    // Always register reconnect handler
    socket.on('connect', emitIdentify);

    // Also fire immediately if already connected
    if (socket.connected) {
      emitIdentify();
    }

    return () => {
      socket.off('connect', emitIdentify);
    };
  }, [socket, authUser?.id, authProfile?.username, authUser?.email, authAccessToken]);

  useEffect(() => {
    joinedRoomRef.current = joinedRoom;
    if (
      shouldPersistLastRoomCode({
        joinedRoom,
        preventAutoRejoin: preventAutoRejoinRef.current,
        gameOver: state?.gameOver,
        isTerminalTournamentMatch: Boolean(
          tournamentMatch?.matchId && isTerminalTournamentMatch(tournamentMatch.matchId),
        ),
      })
    ) {
      saveLastRoomCode(joinedRoom!);
    }
  }, [joinedRoom, state?.gameOver, tournamentMatch?.matchId]);

  useEffect(() => {
    if (inviteJoinInFlightRef.current) return;
    const linkedRoom = readRoomInviteCodeFromLocation();
    if (!linkedRoom) return;
    setRoomCode(linkedRoom);
    setAppMode('home');
  }, []);

  const getInviteLink = useCallback((code: string) => {
    if (typeof window === 'undefined') return '';
    const url = new URL(window.location.href);
    url.searchParams.set('room', code);
    return url.toString();
  }, []);

  const resolvePendingCreate = useCallback((code: string | null) => {
    const pending = pendingCreateResolversRef.current.splice(0);
    pending.forEach((resolve) => resolve(code));
  }, []);

  const resetClientGameSession = useCallback(() => {
    maxSequenceRef.current = -1;
    maxEventSequenceRef.current = -1;
    roomMatchIdRef.current = null;
    autoTurnActionKeyRef.current = '';
    mpAutoDrawSuppressUntilSequenceRef.current = null;
    frozenHandOverBoardRef.current = null;
    playerReadyEmittedRef.current = false;
    matchStartedRef.current = false;
    rematchAwaitingStateRef.current = false;
    clearTournamentAttachRefs();
    resyncBufferedUpdateRef.current = null;
    setOpponentDisconnected(false);
    setOpponentDisconnectMessage('');
    setBoneyardDisplayCount(null);
    clearTransientRoomUi();
  }, [
    clearTournamentAttachRefs,
    clearTransientRoomUi,
    rematchAwaitingStateRef,
    setBoneyardDisplayCount,
    setOpponentDisconnected,
    setOpponentDisconnectMessage,
  ]);

  resetClientGameSessionRef.current = resetClientGameSession;

  const resetMultiplayerRoomState = useCallback(
    (options: { keepPlayers?: boolean; clearRoomCode?: boolean } = {}) => {
      const { keepPlayers = false, clearRoomCode = true } = options;
      setJoinedRoom(null);
      setTournamentMatch(null);
      roomIdentityRef.current = null;
      if (clearRoomCode) setRoomCode('');
      setState(null);
      setLegalMoves([]);
      setCanDraw(false);
      setSelectedTile(null);
      setHandReveal(null);
      setRematchRequested(false);
      setRematchReadyIds([]);
      setScoreTrackOpen(false);
      pendingActionRef.current = false;
      if (!keepPlayers) {
        setPlayers([]);
      }
      resetClientGameSession();
    },
    [resetClientGameSession, setTournamentMatch],
  );
  resetMultiplayerRoomStateRef.current = resetMultiplayerRoomState;

  const resetRoomRecoveryState = useCallback(() => {
    reconnectShouldJoinRef.current = false;
    reconnectRoomCodeRef.current = null;
    preventAutoRejoinRef.current = true;
    setRoomRecoveryState('idle');
    setRoomRecoveryMessage('');
  }, []);

  const clearRecoverableRoomState = useCallback(() => {
    resetRoomRecoveryState();
    clearLastRoomCode();
    rejoinInFlightRef.current = false;
    reconnectAttemptCountRef.current = 0;
    tournament.clearPendingMatch();
    tournament.clearRecoveryMatch();
  }, [resetRoomRecoveryState, tournament]);
  clearRecoverableRoomStateRef.current = clearRecoverableRoomState;


  const applyRoomEventMeta = useCallback((meta?: RoomEventMeta | null) => {
    if (!meta) return;
    const incomingMatchId = typeof meta.matchId === 'string' ? meta.matchId : null;
    if (incomingMatchId && roomMatchIdRef.current && roomMatchIdRef.current !== incomingMatchId) {
      maxSequenceRef.current = -1;
      maxEventSequenceRef.current = -1;
    }
    if (incomingMatchId) {
      roomMatchIdRef.current = incomingMatchId;
    }
    if (typeof meta.lastEventSequence === 'number') {
      maxEventSequenceRef.current = Math.max(maxEventSequenceRef.current, meta.lastEventSequence);
    }
  }, []);

  const emitCreateRoom = useCallback(
    async (targetSocket: Socket) => {
      setError('');
      setActionError('');
      try {
        const username = authProfile?.username ?? 'Guest';
        const userId = multiplayerIdentityUserId;
        const authToken = multiplayerAuthToken;

        const resp = await emitRoomCreate(targetSocket, {
          username,
          userId,
          authToken,
        });
        if (!resp?.ok) {
          throw new Error(resp?.error ?? 'Unable to create room.');
        }

        applyJoinedRoomResponseRef.current(resp);
        autoJoinAttemptedRef.current = false;
        preventAutoRejoinRef.current = false;
        resolvePendingCreate(resp.roomCode ?? null);
        return resp;
      } catch (e) {
        resolvePendingCreate(null);
        throw e;
      }
    },
    [authProfile?.username, multiplayerIdentityUserId, multiplayerAuthToken, resolvePendingCreate],
  );

  const applyJoinedRoomResponse = useCallback((resp: any) => {
    joinedRoomResponseRef.current = resp;
    applyRoomEventMeta(resp.eventMeta);

    if (!roomIdentityRef.current) {
      roomIdentityRef.current = {
        username: authProfile?.username ?? 'Guest',
        userId: multiplayerIdentityUserId,
        authToken: multiplayerAuthToken,
      };
    }

    const resolvedYou =
      typeof resp?.you === 'string' && resp.you ? resp.you : '';

    if (resolvedYou) {
      setYou(resolvedYou);
      youRef.current = resolvedYou;
    }

    const { ok, nextState } = applyJoinResponseGameState(resp);
    if (!ok && resp.state != null) {
      console.warn('[mp] room:join handshake state failed projection validation — resync scheduled');
      void fetchGameStateRef.current('join_ack_projection_invalid');
    }

    setJoinedRoom(resp.roomCode);
    setRoomCode(resp.roomCode);
    const normalized = normalizeRoomPlayers(resp.players);
    roomPlayersRef.current = normalized;
    setPlayers(normalized);
    setRoomRecoveryState('idle');
    setRoomRecoveryMessage('');
    if (
      applyTournamentMetadataFromJoin(resp, nextState) === 'terminal_handled'
    ) {
      return;
    }

    const roster = normalizeRoomPlayers(resp.players);
    const seated =
      Boolean(resolvedYou) &&
      (roster.some((p) => p.id === resolvedYou) ||
        (Array.isArray(nextState?.playerIds) && nextState.playerIds.includes(resolvedYou)));
    isSeatedPlayerRef.current = seated;
    matchStartedRef.current = resp.matchStarted === true;
    if (!seated) {
      playerReadyEmittedRef.current = false;
    } else if (!matchStartedRef.current) {
      playerReadyEmittedRef.current = false;
    }

    if (hasHandIdentityMismatch(nextState, resolvedYou)) {
      void fetchGameStateRef.current('hand_identity_mismatch_after_join');
    } else if (seated && !matchStartedRef.current) {
      trySchedulePlayerReadyRef.current();
    }
  }, [
    applyRoomEventMeta,
    applyJoinResponseGameState,
    applyTournamentMetadataFromJoin,
    socket?.id,
    authProfile?.username,
    multiplayerIdentityUserId,
    multiplayerAuthToken,
    normalizeRoomPlayers,
  ]);

  /** Fetch full authoritative game state from the server (room:join ack). */
  const fetchGameState = useCallback(
    async (reason: string) => {
      const activeSocket = socketRef.current;
      const roomCode = normalizeRoomCode(joinedRoomRef.current);
      if (!activeSocket?.connected || !roomCode) return false;
      if (resyncInFlightRef.current || rejoinInFlightRef.current) return false;
      const now = Date.now();
      if (now < resyncCooldownUntilRef.current) return false;

      resyncInFlightRef.current = true;
      resyncCooldownUntilRef.current = now + 1200;
      setRoomRecoveryState('resyncing');
      setRoomRecoveryMessage('Syncing game state…');

      const identity =
        roomIdentityRef.current ?? {
          username: authProfile?.username ?? 'Guest',
          userId: multiplayerIdentityUserId,
          authToken: multiplayerAuthToken,
        };

      try {
        const resp = await emitRoomJoin(activeSocket, roomCode, identity);
        if (!resp?.ok) {
          console.error('[mp] fetchGameState failed', { reason, error: resp?.error });
          return false;
        }
        applyJoinedRoomResponse(resp);
        return true;
      } catch (error) {
        console.error('[mp] fetchGameState error', {
          reason,
          message: error instanceof Error ? error.message : String(error),
        });
        return false;
      } finally {
        resyncInFlightRef.current = false;
        resyncFlushRef.current?.();
        if (joinedRoomRef.current) {
          setRoomRecoveryState('idle');
          setRoomRecoveryMessage('');
        }
      }
    },
    [
      normalizeRoomCode,
      emitWithAck,
      applyJoinedRoomResponse,
      authProfile?.username,
      multiplayerIdentityUserId,
      multiplayerAuthToken,
    ],
  );

  /** Last-line defense: malformed snapshots should never drive the tabletop UI in a joined room. */
  useEffect(() => {
    if (!joinedRoom) return;
    if (!state) return;
    if (!isRenderableMultiplayerSnapshot(state)) {
      void fetchGameState('runtime_state_projection_guard');
    }
  }, [joinedRoom, state, fetchGameState]);

  const markClientSpectator = useCallback(() => {
    isSeatedPlayerRef.current = false;
  }, []);

  const trySchedulePlayerReady = useCallback(() => {
    if (!isSeatedPlayerRef.current || matchStartedRef.current || playerReadyEmittedRef.current) {
      return;
    }

    // Quick match deferral: wait until both players are seated before emitting player:ready.
    // This prevents the server from timing out or starting a deal before the real opponent
    // has even finished their join handshake.
    const isQuickMatch = appModeRef.current === 'multiplayer' && mpSubViewRef.current === 'quick';
    if (isQuickMatch) {
      if (roomPlayersRef.current.length < 2) {
        return;
      }
    }

    void schedulePlayerReadyRef.current();
  }, []);

  /**
   * Emit player:ready only after room:join ack is applied (seated, lobby before deal).
   * Uses server matchStarted — not local state — so a partial state:update cannot block ready.
   */
  const schedulePlayerReady = useCallback(async () => {
    if (!isSeatedPlayerRef.current || playerReadyEmittedRef.current) return;
    const activeSocket = socketRef.current;
    const roomCode = normalizeRoomCode(joinedRoomRef.current);
    if (!activeSocket?.connected || !roomCode || matchStartedRef.current) {
      return;
    }

    playerReadyEmittedRef.current = true;
    try {
      const ack = await emitWithAck<any>(activeSocket, 'player:ready', roomCode);
      if (ack?.started === true) {
        matchStartedRef.current = true;
      }
    } catch (error) {
      playerReadyEmittedRef.current = false;
      console.error('[mp] player:ready failed', error instanceof Error ? error.message : error);
    }
  }, [normalizeRoomCode, emitWithAck]);

  fetchGameStateRef.current = fetchGameState;
  applyRoomEventMetaRef.current = applyRoomEventMeta;
  schedulePlayerReadyRef.current = schedulePlayerReady;
  applyJoinedRoomResponseRef.current = applyJoinedRoomResponse;
  trySchedulePlayerReadyRef.current = trySchedulePlayerReady;

  const handleMatchmakingAutoJoin = useCallback(
    (payload: MatchFoundPayload) => {
      const roomCode = payload.roomCode.trim().toUpperCase();
      const activeSocket = socketRef.current;
      if (!activeSocket?.connected) {
        return;
      }
      if (normalizeRoomCode(joinedRoomRef.current) === roomCode) {
        return;
      }

      setOverlayPayload(payload);

      const username = authProfile?.username ?? authUser?.email?.split('@')[0] ?? 'Guest';
      setAppMode('multiplayer');
      activeSocket.emit(
        'room:join',
        roomCode,
        { username, userId: multiplayerIdentityUserId, authToken: multiplayerAuthToken },
        (resp: any) => {
          if (!resp?.ok) {
            showToast(resp?.error ?? 'Could not join matched room.', 2500);
            return;
          }
          applyJoinedRoomResponse(resp);
        },
      );
    },
    [
      normalizeRoomCode,
      authProfile?.username,
      authUser?.email,
      multiplayerIdentityUserId,
      multiplayerAuthToken,
      applyJoinedRoomResponse,
      showToast,
      setAppMode,
    ],
  );

  useEffect(() => {
    if (mpSubView !== 'quick' || !joinedRoom || state) return;
    const roomCode = joinedRoom;
    const timer = window.setTimeout(() => {
      if (!matchStartedRef.current && isSeatedPlayerRef.current) {
        playerReadyEmittedRef.current = false;
        trySchedulePlayerReadyRef.current();
      }
      void fetchGameState('quick_match_stall');
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [mpSubView, joinedRoom, state, fetchGameState]);

  useEffect(() => {
    if (!friendInvite) return;
    const timer = setTimeout(() => {
      setFriendInvite(null);
    }, 60_000);
    return () => clearTimeout(timer);
  }, [friendInvite]);

  useEffect(() => {
    if (!socket) return;
    const onDeclined = (payload: { inviteId?: string; fromUsername?: string }) => {
      setOutboundChallenge((current) => {
        if (!current) return null;
        if (payload.inviteId && current.inviteId !== payload.inviteId) return current;
        const name = payload.fromUsername ?? current.friendUsername;
        showToast(`${name} declined the challenge.`, 2400);
        return null;
      });
    };
    socket.on('friend:invite:declined', onDeclined);
    return () => {
      socket.off('friend:invite:declined', onDeclined);
    };
  }, [showToast, socket]);

  useEffect(() => {
    if (!outboundChallenge) return;
    const delay = Math.max(0, outboundChallenge.expiresAt - Date.now());
    const timer = window.setTimeout(() => {
      setOutboundChallenge((current) => {
        if (!current || current.inviteId !== outboundChallenge.inviteId) return current;
        return null;
      });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [outboundChallenge]);

  useEffect(() => {
    if (players.length >= 2 && outboundChallenge) {
      clearOutboundChallenge();
    }
  }, [players.length, outboundChallenge, clearOutboundChallenge]);

  useEffect(() => {
    if (appMode !== 'feed' || !authUser) return;
    if (!socket?.connected) connectRef.current();
  }, [appMode, authUser, socket?.connected]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    handleFullscreenChange();

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (appRootRef.current) {
        await appRootRef.current.requestFullscreen();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to toggle fullscreen.';
      setError(`Fullscreen error: ${message}`);
    }
  }, []);

  const {
    multiplayerConnectionHostParams,
    multiplayerConnectionConfig,
    multiplayerConnectionState,
  } = useMultiplayerConnectionHostParams({
    emitWithAck,
    normalizeRoomCode,
    lastRoomStorageKey: LAST_ROOM_STORAGE_KEY,
    serverUrl,
    showToast,
    emitCreateRoom,
    socket,
    isConnecting,
    isConnected,
    roomRecoveryState,
    appMode,
    authUserId: authUser?.id ?? null,
    authEmail: authUser?.email ?? null,
    authProfileUsername: authProfile?.username ?? null,
    tournamentId,
    tournamentStateStatus: tournamentState?.status ?? null,
    roomCode,
    socketRuntime,
    roomRuntime,
    reconnectRuntime,
    joinFlightRuntime,
    authRuntime,
    navigationRuntime,
    roomSocialRuntime,
    draggingStateRef,
    handRevealShownRef,
    handRevealTimerRef,
    isMutedRef,
    rematchAwaitingStateRef,
    applyJoinedRoomResponse,
    fetchGameState,
    resetClientGameSession,
    clearReconnectAttemptTimer,
    clearTransientRoomUi,
    setSocket,
    setIsConnected,
    setIsConnecting,
    setIsRecoveringConnection,
    setRoomRecoveryState,
    setRoomRecoveryMessage,
    setYou,
    setServerWaking,
    setError,
    setActionError,
    setRematchRequested,
    setRematchReadyIds,
    setOpponentDragging,
    setJoinedRoom,
    setState,
    setLegalMoves,
    setCanDraw,
    setTournamentId,
    setTournamentState,
    setTournamentActiveRoom,
    setRoomCode,
    setHandReveal,
    setPlayers,
    setSelectedTile,
    setPendingUiAction,
  });

  const { connect, disconnect, retryRoomRecovery } = connectionActions;

  useEffect(() => {
    if (!weeklyStatsOpen) return;

    if (!socket || !socket.connected) {
      connect();
      window.setTimeout(() => loadWeeklyAwards(), 250);
      return;
    }

    loadWeeklyAwards();
  }, [weeklyStatsOpen, socket, connect, loadWeeklyAwards]);

  useEffect(() => {
    if (appMode !== 'home') return;
    if (!socket || !socket.connected) {
      setPlayersOnlineCount(null);
      return;
    }

    let active = true;
    const refreshPresence = () => {
      socket.emit('presence:online', [], (resp: any) => {
        if (!active || !resp?.ok) return;
        if (Number.isFinite(resp.onlineCount)) {
          setPlayersOnlineCount(Number(resp.onlineCount));
          return;
        }
        if (Array.isArray(resp.onlineUserIds)) {
          setPlayersOnlineCount(resp.onlineUserIds.length);
          return;
        }
        setPlayersOnlineCount(null);
      });
    };

    refreshPresence();
    const interval = window.setInterval(refreshPresence, 30000);
    const onConnect = () => refreshPresence();
    socket.on('connect', onConnect);

    return () => {
      active = false;
      window.clearInterval(interval);
      socket.off('connect', onConnect);
    };
  }, [appMode, socket]);

  useEffect(() => {
    if (appMode !== 'home') return;
    if (!socket || !socket.connected) return;

    loadWeeklyAwards();
    const interval = window.setInterval(loadWeeklyAwards, 60000);
    return () => window.clearInterval(interval);
  }, [appMode, socket, loadWeeklyAwards]);

  useEffect(() => {
    if (appMode !== 'botSetup') return;
    setBotDealSize(7);
  }, [appMode]);




  const handlePostGame = useCallback(() => {
    resetRoomRecoveryState();
    // Tournament matches should return to tournament lobby, not disconnect to Home.
    const inTournament = Boolean(currentTournamentContext) || Boolean(tournamentId) || tournamentState?.status === 'running';
    if (currentTournamentContext) {
      navigateAfterTournamentMatch('bracket');
      return;
    }
    if (!inTournament) return disconnect('post-game to home');
    resetMultiplayerRoomState({ keepPlayers: true });
    setActionError('');
    setAppMode('tournament');
  }, [
    currentTournamentContext,
    disconnect,
    navigateAfterTournamentMatch,
    tournamentId,
    tournamentState?.status,
    resetMultiplayerRoomState,
    resetRoomRecoveryState,
  ]);

  const _backToTournamentHub = useCallback(() => {
    navigateAfterTournamentMatch('hub');
  }, [navigateAfterTournamentMatch]);

  const abandonCurrentMatch = useCallback(async () => {
    const activeSocket = socketRef.current;
    const activeRoomCode = normalizeRoomCode(joinedRoomRef.current);
    if (!activeSocket?.connected || !activeRoomCode) {
      setActionError('Could not leave the match right now.');
      return;
    }
    console.log('[leave-game] confirm', {
      mode: currentTournamentContext ? 'tournament' : 'multiplayer',
      roomCode: activeRoomCode,
      tournamentMatchId: currentTournamentContext?.matchId ?? null,
    });
    try {
      const resp = await emitRoomAbandonMatch(activeSocket, {
        roomCode: activeRoomCode,
        tournamentMatchId: currentTournamentContext?.matchId ?? null,
      });
      if (!resp?.ok) {
        const errorMessage = resp?.error ?? 'Could not leave the match.';
        console.log('[leave-game] ack/error', {
          roomCode: activeRoomCode,
          error: errorMessage,
        });
        setActionError(errorMessage);
        showToast(errorMessage, 2200);
        return;
      }
      console.log('[leave-game] ack/success', {
        roomCode: activeRoomCode,
      });
      clearRecoverableRoomState();
      resetMultiplayerRoomState({ keepPlayers: true });
      setActionError('');
      if (currentTournamentContext?.tournamentId) {
        setActiveTournamentId(currentTournamentContext.tournamentId);
        setTournamentSubView('bracket');
        setAppMode('tournament');
        void tournament.openBracket(currentTournamentContext.tournamentId);
        void tournament.refresh();
      } else {
        setAppMode('multiplayer');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not leave the match.';
      console.log('[leave-game] ack/error', {
        roomCode: activeRoomCode,
        error: message,
      });
      setActionError(message);
      showToast(message, 2200);
    }
  }, [
    clearRecoverableRoomState,
    currentTournamentContext,
    emitWithAck,
    normalizeRoomCode,
    resetMultiplayerRoomState,
    showToast,
    tournament,
  ]);

  const openMultiplayerAnalyzer = useCallback(() => {
    void import('./analyzer/moveAnalyzer').then(({ analyzeMoveLog, saveGameAnalysis }) => {
      const analysis = analyzeMoveLog(multiplayerMoveLog, true);
      setCurrentAnalysis(analysis);
      saveGameAnalysis('multiplayer', analysis);
      setAnalyzerOpen(true);
    });
  }, [multiplayerMoveLog]);

  const isHandActive = Boolean(state) && !state?.handOver && !state?.gameOver;
  const handCompactStacked = myHand.length > 9;

  const opponentId = state?.playerIds.find((pid) => pid !== you) ?? null;
  const myScore = state?.players[you]?.score ?? 0;
  const opponentScore = opponentId ? (state?.players[opponentId]?.score ?? 0) : 0;
  const opponent = players.find((pl) => pl.id !== you) ?? null;
  const [tournamentOpponentLabel, setTournamentOpponentLabel] = useState<string | null>(null);
  const tournamentMyLabel = authProfile?.username
    ? authProfile.username.replace(/^@/, '')
    : 'You';
  const opponentName = tournamentMatch
    ? tournamentOpponentLabel ?? 'Opponent'
    : opponent?.username
      ? opponent.username.startsWith('@')
        ? opponent.username
        : `@${opponent.username}`
      : 'Rival';
  const myName = authProfile?.username ? `@${authProfile.username}` : 'you';
  const myHandle = authProfile?.username
    ? `@${authProfile.username}`
    : authUser?.email
      ? `@${authUser.email.split('@')[0]}`
      : '@player';
  const homeInitials = useMemo(() => {
    const source = authProfile?.username ?? authUser?.email?.split('@')[0] ?? 'racehorse';
    const parts = source
      .replace(/[^a-zA-Z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
    const initials = parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('');
    return initials || source.slice(0, 2).toUpperCase();
  }, [authProfile?.username, authUser?.email]);
  const homeRatingLabel = (authProfile?.glicko_rating != null ? Math.round(Number(authProfile.glicko_rating)) : 800).toLocaleString();
  const homeFriendsOnline = 3;
  const homePlayersOnline = playersOnlineCount ?? 142;
  const homeActiveRooms = Math.max(12, Math.round(homePlayersOnline / 12));
  const homeLeaderRating = '1,820';
  const [activeHomeMode, setActiveHomeMode] = useState<
    'multiplayer' | 'dailyFritz' | 'daily' | 'singlePlayerHub' | 'tournament' | 'learn'
  >('multiplayer');
  const weeklyAwardRows = Array.isArray(weeklyAwards?.awards) ? weeklyAwards.awards : [];
  const weeklyLeaderHandle = useMemo(() => {
    const mostWins = weeklyAwardRows.find((entry: any) =>
      `${entry?.key ?? ''} ${entry?.title ?? ''}`.toLowerCase().includes('most wins'),
    );
    const fallback = weeklyAwardRows.find((entry: any) => Boolean(entry?.leader?.username));
    const username = mostWins?.leader?.username ?? fallback?.leader?.username ?? null;
    return username ? `@${username}` : null;
  }, [weeklyAwardRows]);
  const homeLeaderHandle = weeklyLeaderHandle ?? '@kai';
  const weeklyRank: number | null = null;
  const hasSocialProofData =
    playersOnlineCount !== null && weeklyLeaderHandle !== null && weeklyRank !== null;
  useRenderProfiler(inGame ? 'MultiplayerGameShell' : 'AppNonGame');
  const isSpectatingMatch = Boolean(tournamentId && joinedRoom && state && !state.playerIds.includes(you));
  const isTournamentMatch = Boolean(tournamentMatch?.isTournament || tournamentId || tournamentState?.status === 'running');
  const spectateRightPlayerId = isSpectatingMatch ? (state?.playerIds?.[1] ?? null) : null;
  const spectateRightPlayer = spectateRightPlayerId ? players.find((pl) => pl.id === spectateRightPlayerId) ?? null : null;
  const hudRightLabel = isSpectatingMatch
    ? (spectateRightPlayer?.username ? `@${spectateRightPlayer.username}` : 'Spectating')
    : myName;
  const hudRightScore =
    isSpectatingMatch && spectateRightPlayerId ? (state?.players[spectateRightPlayerId]?.score ?? 0) : myScore;
  const hudRightScorePulse = isSpectatingMatch && spectateRightPlayerId ? Boolean(hudScorePulse[spectateRightPlayerId]) : Boolean(hudScorePulse[you]);
  const openEndsSum = state?.board ? computeOpenEndsSum(state.board) : 0;
  if (state?.board) {
    assertDisplayedOpenCountMatchesCanonical(state.board, openEndsSum, 'multiplayer');
  }
  const canUseRematch = Boolean(
    state?.gameOver && joinedRoom && !isSpectatingMatch && !isTournamentMatch && state.playerIds.includes(you),
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

  useEffect(() => {
    if (!tournamentMatch) {
      setTournamentOpponentLabel(null);
      return;
    }

    let cancelled = false;
    void import('./tournament/displayNames').then(({ resolveTournamentOpponentLabel }) => {
      if (cancelled) return;
      setTournamentOpponentLabel(
        resolveTournamentOpponentLabel({
          opponentUserId: tournamentMatch.opponentUserId,
          opponentUsername: tournamentMatch.opponentUsername,
          round: tournamentMatch.round,
          roomOpponentUsername: opponent?.username ?? null,
        }),
      );
    });

    return () => {
      cancelled = true;
    };
  }, [
    opponent?.username,
    tournamentMatch?.opponentUserId,
    tournamentMatch?.opponentUsername,
    tournamentMatch?.round,
  ]);

  useEffect(() => {
    setRematchRequested(false);
    setRematchReadyIds([]);
    setMultiplayerMoveLog([]);
    multiplayerMoveCounterRef.current = 1;
    previousStateForAnalysisRef.current = null;
    setOpponentDragging(false);
    draggingStateRef.current = false;
    setMultiplayerRatingBaseline(authProfile?.glicko_rating != null ? Number(authProfile.glicko_rating) : null);
    setMultiplayerRatingPending(false);
    multiplayerRatingRefreshKeyRef.current = '';
    previousMultiplayerGameOverRef.current = false;
  }, [joinedRoom]);

  useEffect(() => {
    if (appMode !== 'multiplayer' || !authUser?.id) {
      setPrivateLobbyHostWinStreak(null);
      return;
    }
    const showPrivateMatchLobby =
      (!isConnected && !isRecoveringConnection) ||
      (isConnected && !joinedRoom) ||
      (isConnected && Boolean(joinedRoom) && !state);
    if (!showPrivateMatchLobby) {
      setPrivateLobbyHostWinStreak(null);
      return;
    }
    let cancelled = false;
    void import('./stats/statsApi')
      .then(({ fetchUserStatsByUserId }) => fetchUserStatsByUserId(authUser.id))
      .then((res) => {
        if (cancelled) return;
        if (res.error || !res.data) {
          setPrivateLobbyHostWinStreak(null);
          return;
        }
        setPrivateLobbyHostWinStreak(res.data.currentWinStreak);
      });
    return () => {
      cancelled = true;
    };
  }, [appMode, authUser?.id, isConnected, isRecoveringConnection, joinedRoom, state]);

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
      setMultiplayerRatingBaseline(authProfile?.glicko_rating != null ? Number(authProfile.glicko_rating) : null);
      setMultiplayerRatingPending(false);
      multiplayerRatingRefreshKeyRef.current = '';
    }
    previousMultiplayerGameOverRef.current = isGameOver;
  }, [authProfile?.glicko_rating, state?.gameOver]);

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
            (baselineRating == null || Number(latestRating) !== baselineRating || i === retryDelaysMs.length - 1)
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
      const maxTileSize = (isLandscape && isMobileWidth) ? 42 : (tileCount > 9 ? 50 : 68);
      const containerWidth = trayCenterRef.current?.offsetWidth ?? window.innerWidth - 40;
      const effectiveLen = forceTwoRows ? Math.ceil(tileCount / 2) : tileCount;
      const tileWidth = Math.min(maxTileSize, Math.floor((containerWidth - 20) / effectiveLen));
      setHandTileSize(tileWidth);
    };

    updateHandTileSize();
    window.addEventListener('resize', updateHandTileSize);
    return () => window.removeEventListener('resize', updateHandTileSize);
  }, [myHand.length]);

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
  }, [inGame, myHand.length]);

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

  // Pulse the opp-tile card whenever the count changes
  useEffect(() => {
    if (prevOppCountRef.current !== null && prevOppCountRef.current !== opponentTileCount) {
      setOppTilePulse(true);
      const t = setTimeout(() => setOppTilePulse(false), 250);
      return () => clearTimeout(t);
    }
    prevOppCountRef.current = opponentTileCount;
  }, [opponentTileCount]);

  // Pulse score cards on scoring events.
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
  }, [state, you, players, opponentName, showScoreToast]);

  // Track turn changes for UI state sync.
  useEffect(() => {
    if (!inGame || !state) {
      prevBoardTileCountRef.current = 0;
      prevTurnIdRef.current = null;
      return;
    }

    const currentTileCount = getBoardTileCount(state.board);
    prevBoardTileCountRef.current = currentTileCount;

    const activePlayerId = state.playerIds[state.currentPlayerIndex] ?? null;
    prevTurnIdRef.current = activePlayerId;
  }, [inGame, state]);

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
        void import('canvas-confetti').then(({ default: confetti }) => {
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
        }).catch(() => {
          // Confetti is celebratory only; skip if the chunk fails to load.
        });
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

    // Always ensure the authenticated user's ID is set
    // correctly - never leave both sides unidentified.
    if (winnerSocketId === you) {
      winnerUserId = authUser.id;
    } else if (loserSocketId === you) {
      loserUserId = authUser.id;
    }

    // If we still can't place the current user as a
    // participant, skip recording - better no record
    // than a corrupted one.
    if (winnerUserId !== authUser.id && loserUserId !== authUser.id) return;

    // Server records authenticated online H2H once on game over; both clients used to insert.
    if (winnerUserId && loserUserId) return;

    const winnerScore = finalState.players[winnerSocketId]?.score ?? null;
    const loserScore = finalState.players[loserSocketId]?.score ?? null;

    void Promise.all([
      import('./analyzer/moveAnalyzer'),
      import('./stats/statsApi'),
    ])
      .then(([{ analyzeMoveLog }, { recordMatchResult }]) => {
        const matchAnalysis = analyzeMoveLog(multiplayerMoveLog, true);
        const avgMoveQuality =
          matchAnalysis.analyzedMoves.length > 0 && matchAnalysis.accuracy > 0
            ? matchAnalysis.accuracy
            : undefined;

        if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
          // eslint-disable-next-line no-console
          console.log('[StatsDebug] about to record match', {
            joinedRoom,
            you,
            winnerSocketId,
            loserSocketId,
            winnerUserId,
            loserUserId,
            winnerScore,
            loserScore,
          });
        }

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
      })
      .then(({ error }) => {
        if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
          // eslint-disable-next-line no-console
          console.log('[StatsDebug] recordMatchResult response', { error });
        }

        if (error && typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
          // eslint-disable-next-line no-console
          console.error('[Stats] recordMatchResult failed:', error);
        }
      });
  }, [state, joinedRoom, players, supabaseEnabled, authUser, you, multiplayerMoveLog]);



  // ─── Render ───────────────────────────────────────────────
  const friendInvitePopup = (
    <FriendInvitePopupOverlay invite={friendInvite} joining={pendingUiAction === 'join'} />
  );

  const authModalsLayer = (
    <AuthModalsLayer
      authModalOpen={authModalOpen}
      supabaseEnabled={supabaseEnabled}
      supabaseConfigError={supabaseConfigError}
      onAuthModalClose={() => setAuthModalOpen(false)}
      onSignIn={signIn}
      onSignUp={signUp}
      onResetPassword={resetPassword}
      passwordRecoveryPending={passwordRecoveryPending}
      onUpdatePassword={updatePassword}
      onPasswordRecoveryClose={clearPasswordRecoveryPending}
      usernameModalOpen={
        !passwordRecoveryPending &&
        ((!onboardingDismissed && needsUsernameOnboarding) || usernameModalOpen)
      }
      currentUsername={authProfile?.username ?? null}
      usernameIsProfileEdit={usernameModalOpen}
      onUsernameSave={async (username) => {
        const result = await updateUsername(username);
        if (!result.error) {
          window.localStorage.removeItem('username_onboarding_dismissed');
          setOnboardingDismissed(false);
          setUsernameModalOpen(false);
        }
        return result;
      }}
      onUsernameClose={() => {
        window.localStorage.setItem('username_onboarding_dismissed', Date.now().toString());
        setOnboardingDismissed(true);
        setUsernameModalOpen(false);
      }}
      onUsernameSignOut={async () => {
        resetRoomRecoveryState();
        setSigningOut(true);
        setAppMode('home');
        resetMultiplayerRoomState();
        setError('');
        setActionError('');
        try {
          void signOut().catch(() => {});
        } catch {
          // no-op
        } finally {
          setSigningOut(false);
          setUsernameModalOpen(false);
          setOnboardingDismissed(false);
          setAuthModalOpen(true);
        }
      }}
      signingOut={signingOut}
    />
  );

  const multiplayerLobbyHostProps = useMultiplayerLobbyHostProps({
    socket,
    socketRuntime,
    roomRuntime,
    joinFlightRuntime,
    reconnectRuntime,
    navigationRuntime,
    roomSocialRuntime,
    roomCode,
    joinedRoom,
    friendInvite,
    outboundChallenge,
    applyJoinedRoomResponse,
    emitCreateRoom,
    showToast,
    normalizeRoomCode,
    normalizeRoomPlayers,
    getInviteLink,
    resolvePendingCreate,
    clearReconnectAttemptTimer,
    clearOutboundChallenge,
    resetMultiplayerRoomState,
    setIsRecoveringConnection,
    authProfile,
    multiplayerIdentityUserId,
    multiplayerAuthToken,
    setRoomCode,
    setPlayers,
    setError,
    setActionError,
    setPendingUiAction,
    setRoomRecoveryState,
    setRoomRecoveryMessage,
    setFriendInvite,
    setMpSubView,
    setOutboundChallenge,
    intentionalDisconnectRef,
    reconnectAttemptCountRef,
    rejoinInFlightRef,
    autoJoinAttemptedRef,
  });

  const appRoutesInput = useAppRoutesInput({
    host: {
      multiplayerConnectionHostParams,
      connectionActions,
      multiplayerLobbyHostProps,
      authModalsLayer,
    },
    multiplayerConnectionState,
    multiplayerConnectionConfig,
    connect,
    retryRoomRecovery,
    isRecoveringConnection,
    serverWaking,
    roomRecoveryMessage,
    setAppMode,
    overlayPayload,
    setOverlayPayload,
    handleMatchmakingAutoJoin,
    isRoomHost,
    privateLobbyHostWinStreak,
    you,
    players,
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
    trayCenterRef,
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
    isMuted,
    setIsMuted,
    isFullscreen,
    toggleFullscreen,
    opponentDisconnected,
    opponentDisconnectMessage,
    handReveal,
    handRevealAutoProgress,
    flyingTiles,
    canUseRematch,
    rematchRequested,
    rematchWaitingText,
    requestRematch,
    handlePostGame,
    multiplayerRatingSummary,
    openMultiplayerAnalyzer,
    showLeaveConfirm,
    setShowLeaveConfirm,
    abandonCurrentMatch,
    abandonedMatchNotice,
    setAbandonedMatchNotice,
    tournamentMatch,
    consumedTournamentGameOverMatchIdsRef,
    tournamentMyLabel,
    tournamentOpponentLabel,
    navigateAfterTournamentMatch,
    currentTournamentContext,
    appMode,
    appRootRef,
    canOpenHowToPlayPreview,
    isAdmin,
    authUser,
    authProfile,
    supabaseEnabled,
    supabaseConfigError,
    selectedLearnLessonId,
    setSelectedLearnLessonId,
    learnHowToPlayOpen,
    setLearnHowToPlayOpen,
    setIsGuidedMode,
    setIsAuthoringMode,
    setIsAuthoringV2Mode,
    setIsGuidedV2Mode,
    setBotFritzTier,
    setBotDealSize,
    botDealSize,
    botFritzTier,
    isGuidedMode,
    isAuthoringMode,
    isAuthoringV2Mode,
    isGuidedV2Mode,
    refreshAuthProfile,
    applyProfilePatch,
    ghostProfile,
    setGhostProfile,
    ghostOpponentName,
    ghostOpponentUserId,
    setGhostOpponentName,
    setGhostOpponentUserId,
    setAuthModalOpen,
    setUsernameModalOpen,
    socket,
    joinedRoom,
    showToast,
    outboundChallenge,
    clearOutboundChallenge,
    profileTarget,
    setProfileTarget,
    friendInvitePopup,
    toast,
    error,
    actionError,
    state,
    setError,
    setActionError,
    mpSubView,
    startGame,
    myHandle,
    homeRatingLabel,
    activeHomeMode,
    setActiveHomeMode,
    welcomeOpen,
    setWelcomeOpen,
    weeklyStatsOpen,
    setWeeklyStatsOpen,
    tournament,
    tournamentSubView,
    activeTournamentId,
    tournamentAttachPhase,
    tournamentAttachError,
    tournamentResult,
    tournamentResultLoading,
    tournamentResultError,
    setTournamentSubView,
    setActiveTournamentId,
    setTournamentResult,
    setTournamentResultLoading,
    setTournamentResultError,
    exitToTournamentHub,
    enterTournamentLobby,
    attachAssignedTournamentMatch,
  });

  const appRoutesProps = useAppRoutesProps(appRoutesInput);

  return (
    <Suspense fallback={<ScreenLoader label="Loading…" />}>
      <AppRoutes {...appRoutesProps} />
    </Suspense>
  );
}
