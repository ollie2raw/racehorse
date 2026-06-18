import React, { useMemo, useState, useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import type { Socket } from 'socket.io-client';
import './App.css';
import './match/match-live.css';
import { isTemporaryUsername, useAuth } from './auth/useAuth';
import { fetchGhostProfileSummary, type GhostProfileSummary } from './ghost/api';
import type { GameState } from './types';
import type { BotDealSize } from './bot/botEngine';
import type { FritzTier } from './bot/fritzConfig';
import { resolveDefaultPvfFritzTier, writeStoredPvfFritzTier } from './bot/pvfTierPreference';
import { resolveGameServerUrl } from './lib/gameServerUrl';
import { type StateUpdatePayload } from './multiplayer/useRoomSocketSync';
import { hasHandIdentityMismatch } from './multiplayer/handIdentity';
import { useTournamentMatchSession } from './match/session/useTournamentMatchSession';
import { useMultiplayerConnectionHostParams } from './multiplayer/useMultiplayerConnectionHostParams';
import type { RecoveryEvent, RecoveryMachineSnapshot } from './multiplayer/recoveryMachine';
import { useMultiplayerConnectionActionsBridge } from './multiplayer/useMultiplayerConnectionContext';
import { useMultiplayerRoomSocialRuntimeBridge } from './multiplayer/useMultiplayerLobbyController';
import { useMultiplayerLobbyHostProps } from './multiplayer/useMultiplayerLobbyHostProps';
import { AuthModalsLayer } from './AppOverlays';
import { MultiplayerGameShell } from './multiplayer/MultiplayerGameShell';
import { AppRoutesGamePropsHost } from './multiplayer/AppRoutesGamePropsHost';
import type { MultiplayerGameShellBridge } from './multiplayer/multiplayerGameShellTypes';
import {
  getHasLiveGameState,
  getLiveGameOver,
  subscribeHasLiveGameState,
  subscribeLiveGameOver,
} from './multiplayer/multiplayerGameSnapshot';
import { useMultiplayerShellDelegates } from './multiplayer/useMultiplayerShellDelegates';
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
  type PrivateRoomCreateSettings,
  type RoomAckResponse,
} from './multiplayer/roomTransport';
import type { LegacyTournamentState } from './multiplayer/legacyTournamentTypes';
import type {
  PresenceOnlineSocketAck,
  StatsWeeklySocketAck,
  WeeklyAwardsPayload,
} from './stats/weeklyAwardsTypes';
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
import { useAppSessionRuntime } from './useAppSessionRuntime';




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
  const [tournamentId, setTournamentId] = useState<string | null>(null);
  const [tournamentState, setTournamentState] = useState<LegacyTournamentState | null>(null);
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
  const [_weeklyAwards, setWeeklyAwards] = useState<WeeklyAwardsPayload | null>(null);
  const [, setPlayersOnlineCount] = useState<number | null>(null);
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
    socket.emit("stats:weekly", (resp: StatsWeeklySocketAck) => {
      if (!resp?.ok) return;
      setWeeklyAwards(resp.awards ?? null);
    });
  }, [socket]);

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

  const joinedRoomRef = useRef<string | null>(null);
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
  const intentionalDisconnectRef = useRef(false);
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
  const applyJoinedRoomResponseRef = useRef<(resp: RoomAckResponse) => void>(() => {});
  const trySchedulePlayerReadyRef = useRef<() => void>(() => {});

  const dispatchRecovery = useCallback((event: RecoveryEvent) => {
    recoveryDispatchRef.current?.(event);
  }, []);

  const gameShellBridgeRef = useRef<MultiplayerGameShellBridge | null>(null);
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

  const shellDelegates = useMultiplayerShellDelegates(gameShellBridgeRef);
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
  } = shellDelegates;

  const liveGameOver = useSyncExternalStore(subscribeLiveGameOver, getLiveGameOver, () => false);
  const hasLiveGameState = useSyncExternalStore(
    subscribeHasLiveGameState,
    getHasLiveGameState,
    () => false,
  );

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
    consumedTournamentGameOverMatchIdsRef,
    clearTournamentAttachRefs,
    applyTournamentMetadataFromJoin,
    attachAssignedTournamentMatch,
    exitToTournamentHub,
    enterTournamentLobby,
    navigateAfterTournamentMatch,
  } = tournamentSession;

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
        gameOver: liveGameOver,
        isTerminalTournamentMatch: Boolean(
          tournamentMatch?.matchId && isTerminalTournamentMatch(tournamentMatch.matchId),
        ),
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
    playerReadyEmittedRef.current = false;
    matchStartedRef.current = false;
    clearTournamentAttachRefs();
    resyncBufferedUpdateRef.current = null;
    gameShellBridgeRef.current?.resetShellClientGameSession();
  }, [clearTournamentAttachRefs]);

  resetClientGameSessionRef.current = resetClientGameSession;

  const resetMultiplayerRoomState = useCallback(
    (options: { keepPlayers?: boolean; clearRoomCode?: boolean } = {}) => {
      const { keepPlayers = false, clearRoomCode = true } = options;
      setJoinedRoom(null);
      setTournamentMatch(null);
      roomIdentityRef.current = null;
      if (clearRoomCode) setRoomCode('');
      shellSetState(null);
      shellSetLegalMoves([]);
      shellSetCanDraw(false);
      shellSetSelectedTile(null);
      shellSetHandReveal(null);
      shellSetRematchRequested(false);
      shellSetRematchReadyIds([]);
      if (!keepPlayers) {
        setPlayers([]);
      }
      resetClientGameSession();
    },
    [
      resetClientGameSession,
      setTournamentMatch,
      shellSetCanDraw,
      shellSetHandReveal,
      shellSetLegalMoves,
      shellSetRematchReadyIds,
      shellSetRematchRequested,
      shellSetSelectedTile,
      shellSetState,
    ],
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
    [authProfile?.username, multiplayerIdentityUserId, multiplayerAuthToken, resolvePendingCreate, dispatchRecovery],
  );

  const applyJoinedRoomResponse = useCallback((resp: RoomAckResponse) => {
    joinedRoomResponseRef.current = resp;
    applyRoomEventMeta(resp.eventMeta as RoomEventMeta | null | undefined);

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

    flushSync(() => {
      setJoinedRoom(resp.roomCode ?? null);
      setRoomCode(resp.roomCode ?? '');
    });

    const { ok, nextState } = gameShellBridgeRef.current?.applyJoinResponseGameState(resp) ?? {
      ok: false,
      nextState: null,
    };
    if (!ok && resp.state != null) {
      console.warn('[mp] room:join handshake state failed projection validation — resync scheduled');
      const roomCode = normalizeRoomCode(resp.roomCode ?? joinedRoomRef.current);
      if (roomCode) {
        dispatchRecovery({ type: 'RESYNC_NEEDED', roomCode });
      }
    }

    const normalized = normalizeRoomPlayers(resp.players);
    roomPlayersRef.current = normalized;
    setPlayers(normalized);
    dispatchRecovery({ type: 'ROOM_JOIN_OK' });
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
      const roomCode = normalizeRoomCode(resp.roomCode ?? joinedRoomRef.current);
      if (roomCode) {
        dispatchRecovery({ type: 'RESYNC_NEEDED', roomCode });
      }
    } else if (seated && !matchStartedRef.current) {
      trySchedulePlayerReadyRef.current();
    }
  }, [
    applyRoomEventMeta,
    applyTournamentMetadataFromJoin,
    authProfile?.username,
    multiplayerIdentityUserId,
    multiplayerAuthToken,
    normalizeRoomPlayers,
    dispatchRecovery,
  ]);

  /** Fetch full authoritative game state from the server (room:join ack). */
  const fetchGameState = useCallback(
    async (reason: string) => {
      const roomCode = normalizeRoomCode(joinedRoomRef.current);
      if (!roomCode) return false;

      if (reason !== 'recovery_machine') {
        dispatchRecovery({ type: 'RESYNC_NEEDED', roomCode });
        return true;
      }

      const activeSocket = socketRef.current;
      if (!activeSocket?.connected) return false;
      if (resyncInFlightRef.current || rejoinInFlightRef.current) return false;
      const now = Date.now();
      if (now < resyncCooldownUntilRef.current) return false;

      resyncInFlightRef.current = true;
      resyncCooldownUntilRef.current = now + 1200;

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
      }
    },
    [
      normalizeRoomCode,
      applyJoinedRoomResponse,
      authProfile?.username,
      multiplayerIdentityUserId,
      multiplayerAuthToken,
      dispatchRecovery,
    ],
  );

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
      const ack = await emitWithAck<RoomAckResponse>(activeSocket, 'player:ready', roomCode);
      if (ack?.ok === false) {
        playerReadyEmittedRef.current = false;
        return;
      }
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
        (resp: RoomAckResponse) => {
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
    if (mpSubView !== 'quick' || !joinedRoom || hasLiveGameState) return;
    const timer = window.setTimeout(() => {
      if (!matchStartedRef.current && isSeatedPlayerRef.current) {
        playerReadyEmittedRef.current = false;
        trySchedulePlayerReadyRef.current();
      }
      void fetchGameState('quick_match_stall');
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [mpSubView, joinedRoom, hasLiveGameState, fetchGameState]);

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
    setTournamentId,
    setTournamentState,
    setTournamentActiveRoom,
    setRoomCode,
    setHandReveal: shellSetHandReveal,
    setPlayers,
    setSelectedTile: shellSetSelectedTile,
    setPendingUiAction: shellSetPendingUiAction,
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
      socket.emit('presence:online', [], (resp: PresenceOnlineSocketAck) => {
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
    shellSetActionError('');
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
      shellSetActionError('Could not leave the match right now.');
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
        shellSetActionError(errorMessage);
        showToast(errorMessage, 2200);
        return;
      }
      console.log('[leave-game] ack/success', {
        roomCode: activeRoomCode,
      });
      clearRecoverableRoomState();
      resetMultiplayerRoomState({ keepPlayers: true });
      shellSetActionError('');
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
      shellSetActionError(message);
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

  useEffect(() => {
    if (appMode !== 'multiplayer' || !authUser?.id) {
      setPrivateLobbyHostWinStreak(null);
      return;
    }
    const showPrivateMatchLobby =
      (!isConnected && !isRecoveringConnection) ||
      (isConnected && !joinedRoom) ||
      (isConnected && Boolean(joinedRoom) && !hasLiveGameState);
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
    intentionalDisconnectRef,
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
    friendInvite,
    toast,
    error,
    setError,
    setActionError: shellSetActionError,
    mpSubView,
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
  };

  return (
    <>
      {joinedRoom ? (
        <MultiplayerGameShell
          socket={socket}
          joinedRoom={joinedRoom}
          you={you}
          players={players}
          isConnected={isConnected}
          showToast={showToast}
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
          tournamentId={tournamentId}
          tournamentState={tournamentState}
          tournamentOpponentLabel={tournamentOpponentLabel}
          rejoinInFlightRef={rejoinInFlightRef}
          joinedRoomRef={joinedRoomRef}
          maxSequenceRef={maxSequenceRef}
          roomPlayersRef={roomPlayersRef}
          resyncInFlightRef={resyncInFlightRef}
          resyncBufferedUpdateRef={resyncBufferedUpdateRef}
          resyncFlushRef={resyncFlushRef}
          fetchGameState={fetchGameState}
          applyRoomEventMeta={applyRoomEventMeta}
          shellBridgeRef={gameShellBridgeRef}
          sharedGameplayRefs={sharedGameplayRefs}
        />
      ) : null}
      <AppRoutesGamePropsHost source={appRoutesHostSource} />
    </>
  );
}
