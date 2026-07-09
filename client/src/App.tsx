import { useMemo, useState, useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Socket } from 'socket.io-client';
import './App.css';
import './match/match-live.css';
import { isTemporaryUsername } from './auth/useAuth';
import { useAuthSession } from './auth/useAuthSession';
import { fetchGhostProfileSummary, type GhostProfileSummary } from './ghost/api';
import type { GameState } from './types';
import type { BotDealSize } from './bot/botEngine';
import type { FritzTier } from './bot/fritzConfig';
import { resolveDefaultPvfFritzTier, writeStoredPvfFritzTier } from './bot/pvfTierPreference';
import { mutePreference } from './utils/mutePreference';
import { logger } from './utils/logger';
import { ErrorBoundary } from './components/ErrorBoundary';
import { resolveGameServerUrl } from './lib/gameServerUrl';

import { useTournamentMatchSession } from './match/session/useTournamentMatchSession';
import { useJoinAckCoordinator } from './multiplayer/useJoinAckCoordinator';
import type { RoomEventMeta } from './multiplayer/protocol';
import {
  attachSocketEventBus,
  dispatchSocketEvent,
  registerNormalizedSocketRouter,
  registerRawSocketEventHandler,
} from './multiplayer/socketEventBus';
import { useMultiplayerConnectionHostParams } from './multiplayer/useMultiplayerConnectionHostParams';
import type { RecoveryEvent, RecoveryMachineSnapshot } from './multiplayer/recoveryMachine';
import { useMultiplayerConnectionActionsBridge } from './multiplayer/useMultiplayerConnectionContext';
import { useMultiplayerRoomSocialRuntimeBridge } from './multiplayer/useMultiplayerLobbyController';
import { useMultiplayerLobbyHostProps } from './multiplayer/useMultiplayerLobbyHostProps';
import { AuthModalsLayer } from './AppOverlays';
import { MultiplayerGameShell } from './multiplayer/MultiplayerGameShell';
import { AppRoutesGamePropsHost } from './multiplayer/AppRoutesGamePropsHost';
import type { MultiplayerShellDelegates } from './multiplayer/multiplayerGameShellTypes';
import {
  getHasLiveGameState,
  getLiveGameOver,
  subscribeHasLiveGameState,
  subscribeLiveGameOver,
} from './multiplayer/multiplayerGameSnapshot';
import { useMultiplayerShellDelegates } from './multiplayer/useMultiplayerShellDelegates';
import { useMultiplayerResync } from './multiplayer/useMultiplayerResync';
import { shouldAutoConnectForMode } from './multiplayer/connectPolicy';
import { shouldShowPrivateMatchLobby } from './multiplayer/privateLobbyVisibility';
import {
  canAttemptMatchmakingRoomJoin,
  emitMatchmakingRoomJoin,
  handleMatchmakingRoomJoinAck,
} from './multiplayer/matchmakingRoomJoin';
import {
  canAttemptMatchAbandon,
  emitMatchAbandonTransport,
  handleMatchAbandonFailure,
  performMatchAbandonSuccessCleanup,
  performPostGameHomeTeardown,
} from './multiplayer/postGameExit';
import { useRenderProfiler } from './debug/renderProfiler';
import { useTournament } from './tournament/useTournament';
import { friendsSocketScopeRef } from './friends/friendsSocketScope';
import { useRegisterFriendsSocketHandlers } from './friends/useRegisterFriendsSocketHandlers';
import { matchmakingSocketScopeRef } from './matchmaking/matchmakingSocketScope';
import { useRegisterMatchmakingSocketHandlers } from './matchmaking/useRegisterMatchmakingSocketHandlers';
import { useRegisterTournamentSocketHandlers } from './tournament/useRegisterTournamentSocketHandlers';

import type { OutboundChallenge } from './multiplayer/friendChallenge';
import type { MatchFoundPayload } from './matchmaking/types';
import {
  emitWithAck,
  emitRoomCreate,
  type PrivateRoomCreateSettings,
  type RoomAckResponse,
} from './multiplayer/roomTransport';
import {
  clearLastRoomCode,
  LAST_ROOM_STORAGE_KEY,
  readRoomInviteCodeFromLocation,
  saveLastRoomCode,
} from './match/recovery/matchRecovery';
import { shouldPersistJoinedRoom } from './match/recovery/joinedRoomPersistPolicy';
import {
  normalizeRoomPlayers,
  type RoomPlayer,
  type RoomRecoveryState,
} from './multiplayer/protocol';

// ─── Utilities ───────────────────────────────────────────────

import type { AppMode } from './appRouteTypes';
import { LEARN_MODE_VISIBLE, JOURNEY_MODE_VISIBLE } from './appRouteTypes';
import { selectLegacyAppSessionRuntime } from './multiplayer/runtime/runtimeSelectors';
import { createMultiplayerRuntime } from './multiplayer/runtime/createMultiplayerRuntime';
import { MultiplayerRuntimeProvider } from './multiplayer/runtime/runtimeProvider';
import type { MultiplayerRuntime, MultiplayerRuntimeBootstrap } from './multiplayer/runtime/runtimeTypes';
import {
  selectCanSendReady,
  selectJoinedRoomCode,
  selectMatchStarted,
} from './multiplayer/session/sessionStateMachine';

function normalizeRoomCode(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
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
  journey: '/journey',
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
  const [isMuted, setIsMuted] = useState<boolean>(() => mutePreference.get());
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
  const [, setTournamentActiveRoom] = useState<string | null>(null);
  const roomSocialRuntime = useMultiplayerRoomSocialRuntimeBridge();
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
    if (!JOURNEY_MODE_VISIBLE && appMode === 'journey') {
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
  const youRef = useRef('');
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
  const [abandonedMatchNotice, setAbandonedMatchNotice] = useState<{
    context: 'tournament' | 'multiplayer';
    title: string;
    detail: string;
    tournamentId?: string | null;
  } | null>(null);
  const {
    authUser,
    authProfile,
    authLoading,
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
    multiplayerIdentityUserId,
    multiplayerAuthToken,
    authUserRef,
    authProfileRef,
    authAccessTokenRef,
    multiplayerIdentityUserIdRef,
    isAdmin,
  } = useAuthSession();
  // Single tournament hook instance, shared by Hub/Bracket/Result screens.
  // Hoisted from the screens so that registration changes / bracket updates /
  // pending match-ready events are observed in App.tsx and can trigger top-level
  // navigation (auto-route to result on tournament:completed).
  const tournament = useTournament({
    userId: authUser?.id ?? null,
  });

  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [weeklyStatsOpen, setWeeklyStatsOpen] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [serverWaking, setServerWaking] = useState(false);
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

  const [usernameModalOpen, setUsernameModalOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const appModeRef = useRef(appMode);
  const mpSubViewRef = useRef(mpSubView);
  const roomPlayersRef = useRef<RoomPlayer[]>([]);
  const joinedRoomResponseRef = useRef<RoomAckResponse | null>(null);
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

  const reconnectRoomCodeRef = useRef<string | null>(null);
  const reconnectShouldJoinRef = useRef(false);
  const preventAutoRejoinRef = useRef(false);
  const recoveryDispatchRef = useRef<
    (event: RecoveryEvent) => RecoveryMachineSnapshot | null
  >(() => null);
  const autoJoinAttemptedRef = useRef(false);
  const joinInFlightRef = useRef(false);
  const clearRecoverableRoomStateRef = useRef<() => void>(() => {});
  const resetMultiplayerRoomStateRef = useRef<
    (options?: { keepPlayers?: boolean; clearRoomCode?: boolean }) => void
  >(() => {});
  const createInFlightRef = useRef(false);
  const inviteJoinInFlightRef = useRef(false);
  const rejoinInFlightRef = useRef(false);
  const reconnectAttemptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptCountRef = useRef(0);
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

  const prevConnectedRef = useRef(false);
  const prevRecoveryStateRef = useRef<RoomRecoveryState>('idle');

  useEffect(() => {
    if (appMode === 'multiplayer') {
      const prev = prevConnectedRef.current;
      if (prev !== isConnected) {
        prevConnectedRef.current = isConnected;
        if (isConnected) {
          showToast('Connected to server.', 1200);
        } else if (!isRecoveringConnection && roomRecoveryState === 'idle') {
          showToast('Disconnected from server.', 1500);
        }
      }
    } else {
      prevConnectedRef.current = isConnected;
    }
  }, [isConnected, appMode, isRecoveringConnection, roomRecoveryState, showToast]);

  useEffect(() => {
    const prev = prevRecoveryStateRef.current;
    if (prev !== roomRecoveryState) {
      prevRecoveryStateRef.current = roomRecoveryState;
      if (prev === 'idle' && (roomRecoveryState === 'reconnecting' || roomRecoveryState === 'resyncing')) {
        showToast('Connection lost. Reconnecting...', 2000);
      } else if ((prev === 'reconnecting' || prev === 'resyncing') && roomRecoveryState === 'idle') {
        showToast('Connection restored. Match recovered.', 2000);
      } else if (roomRecoveryState === 'failed') {
        showToast('Reconnection failed.', 3000);
      }
    }
  }, [roomRecoveryState, showToast]);

  const isMutedRef = useRef(isMuted);
  const applyRoomEventMetaRef = useRef<(meta?: RoomEventMeta | null) => void>(() => {});
  const resetClientGameSessionRef = useRef<() => void>(() => {});
  const schedulePlayerReadyRef = useRef<() => Promise<void>>(async () => {});
  const applyJoinedRoomResponseRef = useRef<(resp: RoomAckResponse) => void>(() => {});
  const trySchedulePlayerReadyRef = useRef<() => void>(() => {});
  const resyncInFlightRef = useRef(false);
  const resyncBufferedUpdateRef = useRef<import('./multiplayer/protocol').StateUpdatePayload | null>(null);
  const resyncFlushRef = useRef<(() => void) | null>(null);

  const runtimeBootstrapRef = useRef<MultiplayerRuntimeBootstrap | null>(null);
  const multiplayerRuntimeRef = useRef<MultiplayerRuntime | null>(null);

  const dispatchRecovery = useCallback((event: RecoveryEvent) => {
    recoveryDispatchRef.current?.(event);
  }, []);

  const shellDelegatesRef = useRef<MultiplayerShellDelegates | null>(null);
  const sharedGameplayRefs = useMemo(
    () => ({
      stateRef: { current: null as GameState | null },
      draggingStateRef: { current: false },
      handRevealShownRef: { current: null as number | null },
      handRevealTimerRef: { current: null as ReturnType<typeof setTimeout> | null },
      rematchAwaitingStateRef: { current: false },
    }),
    [],
  );
  const stateRef = sharedGameplayRefs.stateRef;
  const draggingStateRef = sharedGameplayRefs.draggingStateRef;
  const handRevealShownRef = sharedGameplayRefs.handRevealShownRef;
  const handRevealTimerRef = sharedGameplayRefs.handRevealTimerRef;
  const rematchAwaitingStateRef = sharedGameplayRefs.rematchAwaitingStateRef;

  if (!runtimeBootstrapRef.current) {
    runtimeBootstrapRef.current = {
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
      rejoinInFlightRef,
      authUserRef,
      authProfileRef,
      authAccessTokenRef,
      multiplayerIdentityUserIdRef,
      appModeRef,
      setAppMode,
      joinedRoomResponseRef,
      roomIdentityRef,
      youRef,
      stateRef,
      maxSequenceRef,
      roomPlayersRef,
      applyJoinedRoomResponseRef,
      clearRecoverableRoomStateRef,
      resetMultiplayerRoomStateRef,
      resyncInFlightRef,
      resyncBufferedUpdateRef,
      resyncFlushRef,
      rematchAwaitingStateRef,
      schedulePlayerReadyRef,
      trySchedulePlayerReadyRef,
      isMutedRef,
      gameplayRefs: {
        draggingStateRef,
        handRevealShownRef,
        handRevealTimerRef,
      },
    };
  }

  if (!multiplayerRuntimeRef.current) {
    multiplayerRuntimeRef.current = createMultiplayerRuntime(runtimeBootstrapRef.current);
  }
  const multiplayerRuntime = multiplayerRuntimeRef.current;
  const { sessionRef, dispatchSession } = multiplayerRuntime.session;

  const shellDelegateActions = useMultiplayerShellDelegates(shellDelegatesRef);
  const {
    setState: shellSetState,
    setLegalMoves: shellSetLegalMoves,
    setCanDraw: shellSetCanDraw,
    setRematchRequested: shellSetRematchRequested,
    setRematchReadyIds: shellSetRematchReadyIds,
    setOpponentDragging: shellSetOpponentDragging,
    setHandReveal: shellSetHandReveal,
    setSelectedTile: shellSetSelectedTile,
    setPendingUiAction: shellSetPendingUiAction,
    setActionError: shellSetActionError,
    clearTransientRoomUi,
  } = shellDelegateActions;

  const liveGameOver = useSyncExternalStore(subscribeLiveGameOver, getLiveGameOver, () => false);
  const hasLiveGameState = useSyncExternalStore(
    subscribeHasLiveGameState,
    getHasLiveGameState,
    () => false,
  );

  const { fetchGameState } = useMultiplayerResync({
    socketRef,
    sessionRef,
    dispatchSession,
    roomIdentityRef,
    rejoinInFlightRef,
    applyJoinedRoomResponseRef,
    dispatchRecovery,
    normalizeRoomCode,
    authProfileUsername: authProfile?.username,
    multiplayerIdentityUserId,
    multiplayerAuthToken,
    mpSubView,
    joinedRoom,
    hasLiveGameState,
    trySchedulePlayerReadyRef,
  });

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
    sessionRuntime,
    tournamentAttachRuntime,
  } = selectLegacyAppSessionRuntime(multiplayerRuntime);

  const tournamentSession = useTournamentMatchSession({
    socket,
    attachRuntime: tournamentAttachRuntime,
    appMode,
    authUserId: authUser?.id ?? null,
    multiplayerIdentityUserId,
    joinedRoom,
    liveGameOver,
    showToast,
    setActionError: shellSetActionError,
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
    consumedTournamentGameOverMatchIds,
    clearTournamentAttachRefs,
    applyTournamentMetadataFromJoin,
    attachAssignedTournamentMatch,
    exitToTournamentHub,
    enterTournamentLobby,
    navigateAfterTournamentMatch,
    sessionSocketDelegatesRef,
  } = tournamentSession;

  useRegisterTournamentSocketHandlers({
    enabled: Boolean(socket),
    getScope: () => ({
      hub: tournament.hubSocketDelegatesRef.current,
      session: sessionSocketDelegatesRef.current,
    }),
  });

  useRegisterMatchmakingSocketHandlers({
    enabled: Boolean(socket),
    getScope: () => matchmakingSocketScopeRef.current,
  });

  useRegisterFriendsSocketHandlers({
    enabled: Boolean(socket),
    getScope: () => friendsSocketScopeRef.current,
  });

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
      if (reconnectAttemptTimerRef.current) clearTimeout(reconnectAttemptTimerRef.current);
    };
  }, []);

  const clearReconnectAttemptTimer = useCallback(() => {
    if (reconnectAttemptTimerRef.current) {
      clearTimeout(reconnectAttemptTimerRef.current);
      reconnectAttemptTimerRef.current = null;
    }
  }, []);

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
    mutePreference.set(isMuted);
  }, [isMuted]);


  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    if (justVerified) {
      showToast('✓ Email verified! Welcome to Racehorse Dominoes.', 5000);
    }
  }, [justVerified, showToast]);

  useEffect(() => {
    socketRef.current = socket;
  }, [socket]);

  // Joined-room persist policy: see shouldPersistJoinedRoom in match/recovery/joinedRoomPersistPolicy.ts
  useEffect(() => {
    if (
      shouldPersistJoinedRoom({
        joinedRoom,
        preventAutoRejoin: preventAutoRejoinRef.current,
        liveGameOver,
        tournamentMatchId: tournamentMatch?.matchId,
      })
    ) {
      saveLastRoomCode(joinedRoom!);
    }
  }, [joinedRoom, liveGameOver, tournamentMatch?.matchId]);

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
    dispatchSession({ type: 'SESSION_RESET_GAME' });
    clearTournamentAttachRefs();
    resyncBufferedUpdateRef.current = null;
    shellDelegatesRef.current?.resetShellClientGameSession();
  }, [clearTournamentAttachRefs, dispatchSession]);

  resetClientGameSessionRef.current = resetClientGameSession;

  type RoomIdentityResetPart = 'joined' | 'identity' | 'players';
  type GameShellResetPart = 'ui' | 'session';

  const resetRoomIdentityState = useCallback(
    (options: { keepPlayers?: boolean; clearRoomCode?: boolean } = {}, part: RoomIdentityResetPart) => {
      const { keepPlayers = false, clearRoomCode = true } = options;
      if (part === 'joined') {
        setJoinedRoom(null);
        return;
      }
      if (part === 'identity') {
        roomIdentityRef.current = null;
        if (clearRoomCode) setRoomCode('');
        return;
      }
      if (!keepPlayers) {
        setPlayers([]);
      }
    },
    [setJoinedRoom, setRoomCode, setPlayers],
  );

  const resetGameShellState = useCallback(
    (part: GameShellResetPart) => {
      if (part === 'ui') {
        shellSetState(null);
        shellSetLegalMoves([]);
        shellSetCanDraw(false);
        shellSetSelectedTile(null);
        shellSetHandReveal(null);
        shellSetRematchRequested(false);
        shellSetRematchReadyIds([]);
        return;
      }
      resetClientGameSession();
    },
    [
      resetClientGameSession,
      shellSetCanDraw,
      shellSetHandReveal,
      shellSetLegalMoves,
      shellSetRematchReadyIds,
      shellSetRematchRequested,
      shellSetSelectedTile,
      shellSetState,
    ],
  );

  const resetTournamentAttachState = useCallback(() => {
    setTournamentMatch(null);
  }, [setTournamentMatch]);

  // Room/shell/tournament reset composition: see resetMultiplayerRoomState below.
  const resetMultiplayerRoomState = useCallback(
    (options: { keepPlayers?: boolean; clearRoomCode?: boolean } = {}) => {
      resetRoomIdentityState(options, 'joined');
      resetTournamentAttachState();
      resetRoomIdentityState(options, 'identity');
      resetGameShellState('ui');
      resetRoomIdentityState(options, 'players');
      resetGameShellState('session');
    },
    [resetGameShellState, resetRoomIdentityState, resetTournamentAttachState],
  );
  resetMultiplayerRoomStateRef.current = resetMultiplayerRoomState;

  const resetRoomRecoveryState = useCallback(() => {
    dispatchRecovery({ type: 'SET_POLICY', policy: 'disabled' });
    dispatchRecovery({ type: 'SET_TARGET_ROOM', roomCode: null });
  }, [dispatchRecovery]);

  const clearRecoverableRoomState = useCallback(() => {
    resetRoomRecoveryState();
    clearLastRoomCode();
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
    async (targetSocket: Socket, settings?: PrivateRoomCreateSettings) => {
      setError('');
      shellSetActionError('');
      try {
        const username = authProfile?.username ?? 'Guest';
        const userId = multiplayerIdentityUserId;
        const authToken = multiplayerAuthToken;

        const resp = await emitRoomCreate(targetSocket, {
          username,
          userId,
          authToken,
          tilesPerPlayer: settings?.dealFormat ?? 7,
          winningScore: settings?.winTarget ?? 60,
        });
        if (!resp?.ok) {
          throw new Error(resp?.error ?? 'Unable to create room.');
        }

        applyJoinedRoomResponseRef.current(resp);
        autoJoinAttemptedRef.current = false;
        dispatchRecovery({ type: 'SET_POLICY', policy: 'auto' });
        resolvePendingCreate(resp.roomCode ?? null);
        return resp;
      } catch (e) {
        resolvePendingCreate(null);
        throw e;
      }
    },
    [authProfile?.username, multiplayerIdentityUserId, multiplayerAuthToken, resolvePendingCreate, dispatchRecovery, shellSetActionError],
  );

  const trySchedulePlayerReady = useCallback(() => {
    if (!selectCanSendReady(sessionRef.current)) {
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
  }, [sessionRef]);

  /**
   * Emit player:ready only after room:join ack is applied (seated, lobby before deal).
   * Uses server matchStarted — not local state — so a partial state:update cannot block ready.
   */
  const schedulePlayerReady = useCallback(async () => {
    const session = sessionRef.current;
    if (!selectCanSendReady(session)) return;
    const activeSocket = socketRef.current;
    const roomCode = normalizeRoomCode(selectJoinedRoomCode(session));
    if (!activeSocket?.connected || !roomCode || selectMatchStarted(session)) {
      return;
    }

    dispatchSession({ type: 'PLAYER_READY_EMITTED' });
    try {
      const ack = await emitWithAck<RoomAckResponse>(activeSocket, 'player:ready', roomCode);
      if (ack?.ok === false) {
        dispatchSession({ type: 'ROOM_REQUEST_READY' });
        return;
      }
      dispatchSession({
        type: 'PLAYER_READY_ACK',
        matchStarted: ack?.started === true,
      });
    } catch (error) {
      dispatchSession({ type: 'ROOM_REQUEST_READY' });
      logger.error('App.tsx', new Error('[mp] player:ready failed'), {
        detail: error instanceof Error ? error.message : error,
      });
    }
  }, [dispatchSession, normalizeRoomCode, emitWithAck, sessionRef]);

  const applySnapshot = useCallback(
    (resp: RoomAckResponse) =>
      shellDelegatesRef.current?.applyJoinResponseGameState(resp) ?? {
        ok: false,
        nextState: null,
      },
    [],
  );

  const { handleJoinAck } = useJoinAckCoordinator({
    dispatchRecovery,
    normalizeRoomCode,
    applySnapshot,
    applyRoomEventMeta,
    setJoinedRoom,
    setRoomCode,
    setYou,
    setPlayers,
    normalizeRoomPlayers,
    sessionRef,
    dispatchSession,
    joinedRoomResponseRef,
    youRef,
    roomPlayersRef,
    roomIdentityRef,
    authProfileUsername: authProfile?.username,
    multiplayerIdentityUserId,
    multiplayerAuthToken,
    onTerminalJoinHandled: (resp, nextState) =>
      applyTournamentMetadataFromJoin(resp, nextState) === 'terminal_handled'
        ? 'terminal_handled'
        : undefined,
    trySchedulePlayerReady,
  });

  const applyJoinedRoomResponse = useCallback((resp: RoomAckResponse) => {
    dispatchSocketEvent({ type: 'ROOM_JOIN_OK', payload: resp });
  }, []);

  useEffect(() => {
    return registerNormalizedSocketRouter({ roomJoinOk: handleJoinAck });
  }, [handleJoinAck]);

  useEffect(() => {
    if (!socket) return;
    return attachSocketEventBus(socket);
  }, [socket]);

  applyRoomEventMetaRef.current = applyRoomEventMeta;
  schedulePlayerReadyRef.current = schedulePlayerReady;
  applyJoinedRoomResponseRef.current = applyJoinedRoomResponse;
  trySchedulePlayerReadyRef.current = trySchedulePlayerReady;

  // Matchmaking auto-join: see matchmakingRoomJoin.ts (join transport + ack); App owns optimistic navigation below.
  const handleMatchmakingAutoJoin = useCallback(
    (payload: MatchFoundPayload) => {
      const activeSocket = socketRef.current;
      if (
        !canAttemptMatchmakingRoomJoin({
          socket: activeSocket,
          roomCode: payload.roomCode,
          currentJoinedRoom: selectJoinedRoomCode(sessionRef.current),
          normalizeRoomCode,
        })
      ) {
        return;
      }

      // Optimistic overlay + mode switch before ack — keeps countdown/match-found UI responsive while join runs.
      setOverlayPayload(payload);
      setAppMode('multiplayer');

      const username = authProfile?.username ?? authUser?.email?.split('@')[0] ?? 'Guest';
      void emitMatchmakingRoomJoin({
        socket: activeSocket!,
        roomCode: payload.roomCode,
        identity: {
          username,
          userId: multiplayerIdentityUserId,
          authToken: multiplayerAuthToken,
        },
      }).then((resp) => {
        handleMatchmakingRoomJoinAck(resp, { applyJoinedRoomResponse, showToast });
      });
    },
    [
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
    if (!friendInvite) return;
    const timer = setTimeout(() => {
      setFriendInvite(null);
    }, 60_000);
    return () => clearTimeout(timer);
  }, [friendInvite]);

  useEffect(() => {
    const unregisterDeclined = registerRawSocketEventHandler(
      'friend:invite:declined',
      (payload) => {
        const data = payload as { inviteId?: string; fromUsername?: string };
        setOutboundChallenge((current) => {
          if (!current) return null;
          if (data.inviteId && current.inviteId !== data.inviteId) return current;
          const name = data.fromUsername ?? current.friendUsername;
          showToast(`${name} declined the challenge.`, 2400);
          return null;
        });
      },
    );

    const unregisterInvited = registerRawSocketEventHandler('friend:invited', (payload) => {
      const data = payload as {
        inviteId?: string;
        fromUsername: string;
        fromUserId?: string | null;
        roomCode: string;
        inviteUrl: string;
        matchSummary?: string;
      };
      setFriendInvite({
        inviteId: String(data.inviteId ?? `${Date.now()}-${data.roomCode}`),
        fromUsername: data.fromUsername,
        fromUserId: data.fromUserId ?? null,
        roomCode: data.roomCode,
        inviteUrl: data.inviteUrl,
        matchSummary: data.matchSummary ?? '7-Tile · First to 60 · Untimed',
      });
    });

    return () => {
      unregisterDeclined();
      unregisterInvited();
    };
  }, [showToast]);

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

  // Feed lazy-connect policy: see shouldAutoConnectForMode in multiplayer/connectPolicy.ts
  useEffect(() => {
    if (
      !shouldAutoConnectForMode({
        appMode,
        hasAuthUser: Boolean(authUser),
        isSocketConnected: Boolean(socket?.connected),
      })
    ) {
      return;
    }
    connectRef.current();
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
    authAccessToken: multiplayerAuthToken,
    roomCode,
    socketRuntime,
    roomRuntime,
    sessionRuntime,
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
    resyncInFlightRef,
    recoveryDispatchRef,
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
    setActionError: shellSetActionError,
    setRematchRequested: shellSetRematchRequested,
    setRematchReadyIds: shellSetRematchReadyIds,
    setOpponentDragging: shellSetOpponentDragging,
    setJoinedRoom,
    setState: shellSetState,
    setLegalMoves: shellSetLegalMoves,
    setCanDraw: shellSetCanDraw,
    setTournamentActiveRoom,
    setRoomCode,
    setHandReveal: shellSetHandReveal,
    setPlayers,
    setSelectedTile: shellSetSelectedTile,
    setPendingUiAction: shellSetPendingUiAction,
  });

  const { connect, disconnect, retryRoomRecovery } = connectionActions;

  useEffect(() => {
    if (appMode !== 'botSetup') return;
    setBotDealSize(7);
  }, [appMode]);




  // Post-game / abandon exit: transport in multiplayer/postGameExit.ts; App owns navigation below.
  const handlePostGame = useCallback(() => {
    resetRoomRecoveryState();
    // Tournament matches should return to tournament lobby, not disconnect to Home.
    if (currentTournamentContext) {
      navigateAfterTournamentMatch('bracket');
      return;
    }
    // LEGACY TOURNAMENT — TournamentScreen.tsx is unmounted and unreachable.
    // This branch is dead code. Do not remove yet — remove in Phase 2 cleanup.
    // const inTournament =
    //   Boolean(currentTournamentContext) ||
    //   Boolean(tournamentId) ||
    //   tournamentState?.status === 'running';
    // if (!inTournament) return disconnect('post-game to home');
    // resetMultiplayerRoomState({ keepPlayers: true });
    // shellSetActionError('');
    // setAppMode('tournament');
    // Orchestrate post-game cleanup:
    // 1. Reset room + shell state (tournament match, room code, identity ref, shell bridge, sequence refs)
    // 2. Transport teardown (socket close, leave/abandon emit, recovery flags, navigate home)
    // Order matters: reset room state before transport so shell unmounts cleanly.
    performPostGameHomeTeardown({ resetMultiplayerRoomState, disconnect });
  }, [
    currentTournamentContext,
    disconnect,
    navigateAfterTournamentMatch,
    resetMultiplayerRoomState,
    resetRoomRecoveryState,
  ]);

  const abandonCurrentMatch = useCallback(async () => {
    const activeSocket = socketRef.current;
    const activeRoomCode = normalizeRoomCode(selectJoinedRoomCode(sessionRef.current));
    if (!canAttemptMatchAbandon({ socket: activeSocket, activeRoomCode })) {
      shellSetActionError('Could not leave the match right now.');
      return;
    }
    console.log('[leave-game] confirm', {
      mode: currentTournamentContext ? 'tournament' : 'multiplayer',
      roomCode: activeRoomCode,
      tournamentMatchId: currentTournamentContext?.matchId ?? null,
    });
    try {
      const resp = await emitMatchAbandonTransport(activeSocket!, {
        roomCode: activeRoomCode,
        tournamentMatchId: currentTournamentContext?.matchId ?? null,
      });
      if (!resp?.ok) {
        const errorMessage = resp?.error ?? 'Could not leave the match.';
        console.log('[leave-game] ack/error', {
          roomCode: activeRoomCode,
          error: errorMessage,
        });
        handleMatchAbandonFailure(errorMessage, { shellSetActionError, showToast });
        return;
      }
      console.log('[leave-game] ack/success', {
        roomCode: activeRoomCode,
      });
      performMatchAbandonSuccessCleanup({
        clearRecoverableRoomState,
        resetMultiplayerRoomState,
        shellSetActionError,
      });
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
      handleMatchAbandonFailure(message, { shellSetActionError, showToast });
    }
  }, [
    clearRecoverableRoomState,
    currentTournamentContext,
    normalizeRoomCode,
    resetMultiplayerRoomState,
    showToast,
    tournament,
  ]);

  const opponentForTournamentLabel = players.find((pl) => pl.id !== you) ?? null;
  const [tournamentOpponentLabel, setTournamentOpponentLabel] = useState<string | null>(null);
  const tournamentMyLabel = authProfile?.username
    ? authProfile.username.replace(/^@/, '')
    : 'You';
  const myHandle = authProfile?.username
    ? `@${authProfile.username}`
    : authUser?.email
      ? `@${authUser.email.split('@')[0]}`
      : '@player';
  const homeRatingLabel = (authProfile?.glicko_rating != null ? Math.round(Number(authProfile.glicko_rating)) : 800).toLocaleString();
  const [activeHomeMode, setActiveHomeMode] = useState<
    'multiplayer' | 'dailyFritz' | 'daily' | 'singlePlayerHub' | 'tournament' | 'learn'
  >('multiplayer');
  useRenderProfiler('AppNonGame');
  const isRoomHost = players[0]?.id === you;

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
          roomOpponentUsername: opponentForTournamentLabel?.username ?? null,
        }),
      );
    });

    return () => {
      cancelled = true;
    };
  }, [
    opponentForTournamentLabel?.username,
    tournamentMatch?.opponentUserId,
    tournamentMatch?.opponentUsername,
    tournamentMatch?.round,
    tournamentMatch,
  ]);

  // Private lobby visibility: see shouldShowPrivateMatchLobby in multiplayer/privateLobbyVisibility.ts
  useEffect(() => {
    if (appMode !== 'multiplayer' || !authUser?.id) {
      setPrivateLobbyHostWinStreak(null);
      return;
    }
    if (
      !shouldShowPrivateMatchLobby({
        isConnected,
        isRecoveringConnection,
        joinedRoom,
        hasLiveGameState,
      })
    ) {
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
  }, [appMode, authUser?.id, isConnected, isRecoveringConnection, joinedRoom, hasLiveGameState]);

  // ─── Render ───────────────────────────────────────────────
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
        shellSetActionError('');
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
    sessionRuntime,
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
    setActionError: shellSetActionError,
    setPendingUiAction: shellSetPendingUiAction,
    setRoomRecoveryState,
    setRoomRecoveryMessage,
    setFriendInvite,
    setMpSubView,
    setOutboundChallenge,
    reconnectAttemptCountRef,
    rejoinInFlightRef,
    autoJoinAttemptedRef,
  });

  const appRoutesHostSource = {
    host: {
      multiplayerConnectionHostParams,
      connectionActions,
      multiplayerLobbyHostProps,
      authModalsLayer,
    },
    routeBundles: {
      navigation: { appMode, setAppMode, appRootRef },
      auth: {
        isAdmin,
        authUser,
        authProfile,
        supabaseEnabled,
        supabaseConfigError,
        refreshAuthProfile,
        applyProfilePatch,
        setAuthModalOpen,
        setUsernameModalOpen,
        myHandle,
        homeRatingLabel,
      },
      learn: {
        canOpenHowToPlayPreview,
        selectedLearnLessonId,
        setSelectedLearnLessonId,
        learnHowToPlayOpen,
        setLearnHowToPlayOpen,
        setIsGuidedMode,
        setIsAuthoringMode,
        setIsAuthoringV2Mode,
        setIsGuidedV2Mode,
      },
      botMatch: {
        setBotFritzTier,
        setBotDealSize,
        botDealSize,
        botFritzTier,
        isGuidedMode,
        isAuthoringMode,
        isAuthoringV2Mode,
        isGuidedV2Mode,
      },
      ghost: {
        ghostProfile,
        setGhostProfile,
        ghostOpponentName,
        ghostOpponentUserId,
        setGhostOpponentName,
        setGhostOpponentUserId,
      },
      social: {
        socket,
        joinedRoom,
        showToast,
        outboundChallenge,
        clearOutboundChallenge,
        profileTarget,
        setProfileTarget,
        toast,
      },
      homeOverlays: {
        activeHomeMode,
        setActiveHomeMode,
        welcomeOpen,
        setWelcomeOpen,
        weeklyStatsOpen,
        setWeeklyStatsOpen,
      },
      tournament: {
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
      },
      multiplayerRoute: { mpSubView, error, setError },
    },
    multiplayerConnectionState,
    multiplayerConnectionConfig,
    connect,
    retryRoomRecovery,
    isRecoveringConnection,
    serverWaking,
    roomRecoveryMessage,
    overlayPayload,
    setOverlayPayload,
    handleMatchmakingAutoJoin,
    privateLobbyHostWinStreak,
    fallbackIsRoomHost: isRoomHost,
    you,
    players,
    trayCenterRef,
    isMuted,
    setIsMuted,
    isFullscreen,
    toggleFullscreen,
    handlePostGame,
    abandonCurrentMatch,
    abandonedMatchNotice,
    setAbandonedMatchNotice,
    tournamentMatch,
    consumedTournamentGameOverMatchIds,
    tournamentMyLabel,
    tournamentOpponentLabel,
    navigateAfterTournamentMatch,
    currentTournamentContext,
    friendInvite,
    setActionError: shellSetActionError,
  };

  return (
    <MultiplayerRuntimeProvider runtime={multiplayerRuntime}>
    <>
      {joinedRoom ? (
        <ErrorBoundary
          context="multiplayer-shell"
          fallback={
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100vh',
                background: '#040b17',
                color: '#f0e6cc',
                fontFamily: 'var(--font-display, sans-serif)',
                gap: '16px',
              }}
            >
              <div style={{ fontSize: '32px' }}>⚠</div>
              <h2 style={{ fontSize: '20px', fontWeight: 700, margin: 0 }}>Match unavailable</h2>
              <p style={{ color: '#6b7a94', fontSize: '14px', margin: 0 }}>
                Something went wrong during your match.
              </p>
              <button
                onClick={() => {
                  window.location.href = '/';
                }}
                style={{
                  background: '#C9A84C',
                  color: '#040b17',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '10px 24px',
                  fontSize: '14px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  marginTop: '8px',
                }}
              >
                Return to home
              </button>
            </div>
          }
        >
          <MultiplayerGameShell
            socket={socket}
            joinedRoom={joinedRoom}
            you={you}
            players={players}
            isConnected={isConnected}
            showToast={showToast}
            joinedRoomResponseRef={joinedRoomResponseRef}
            connectionRecovery={{
              roomRecoveryState,
              isRecoveringConnection,
              roomRecoveryMessage,
              setRoomRecoveryState,
              setRoomRecoveryMessage,
            }}
            setError={setError}
            setPlayers={setPlayers}
            setFriendInvite={setFriendInvite}
            isMuted={isMuted}
            isMutedRef={isMutedRef}
            trayCenterRef={trayCenterRef}
            authUser={authUser}
            authProfile={authProfile}
            refreshAuthProfile={refreshAuthProfile}
            authProfileRef={authProfileRef}
            supabaseEnabled={supabaseEnabled}
            tournamentMatch={tournamentMatch}
            tournamentOpponentLabel={tournamentOpponentLabel}
            rejoinInFlightRef={rejoinInFlightRef}
            sessionRuntime={sessionRuntime}
            schedulePlayerReadyRef={schedulePlayerReadyRef}
            trySchedulePlayerReadyRef={trySchedulePlayerReadyRef}
            maxSequenceRef={maxSequenceRef}
            roomPlayersRef={roomPlayersRef}
            resyncInFlightRef={resyncInFlightRef}
            resyncBufferedUpdateRef={resyncBufferedUpdateRef}
            resyncFlushRef={resyncFlushRef}
            fetchGameState={fetchGameState}
            applyRoomEventMeta={applyRoomEventMeta}
            shellDelegatesRef={shellDelegatesRef}
            sharedGameplayRefs={sharedGameplayRefs}
            setAbandonedMatchNotice={setAbandonedMatchNotice}
          />
        </ErrorBoundary>
      ) : null}
      <AppRoutesGamePropsHost source={appRoutesHostSource} />
    </>
    </MultiplayerRuntimeProvider>
  );
}
