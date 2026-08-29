import { useMemo, useState, useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import './App.css';
import './match/match-live.css';
import './styles/room-lobby.css';
import './styles/rotate-overlay.css';
import './styles/match-hud-corner-pills.css';
import './styles/large-mode.css';
import './styles/table-theme-toggle.css';
import './styles/weekly-awards.css';
import './styles/responsive.css';
import { useAuthSession } from './auth/useAuthSession';
import { useAppSessionUi } from './auth/useAppSessionUi';
import type { GameState } from './types';
import { useBotGamePreferences } from './bot/useBotGamePreferences';
import { ErrorBoundary } from './components/ErrorBoundary';

import { useTournamentMatchSession } from './match/session/useTournamentMatchSession';
import { useMultiplayerConnectionHostParams } from './multiplayer/useMultiplayerConnectionHostParams';
import type { RecoveryEvent, RecoveryMachineSnapshot } from './multiplayer/recoveryMachine';
import { useSocketConnectionState } from './multiplayer/useSocketConnectionState';
import { useMultiplayerRoomSocialRuntimeBridge } from './multiplayer/useMultiplayerLobbyController';
import { useMultiplayerLobbyHostProps } from './multiplayer/useMultiplayerLobbyHostProps';
import { AuthModalsLayer, MultiplayerShellErrorFallback } from './AppOverlays';
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
import { usePrivateLobbyWinStreak } from './multiplayer/usePrivateLobbyWinStreak';
import { useMatchExitHandlers } from './multiplayer/useMatchExitHandlers';
import { useMultiplayerRoomCallbacks } from './multiplayer/useMultiplayerRoomCallbacks';
import { useRenderProfiler } from './debug/renderProfiler';
import { useTournament } from './tournament/useTournament';
import { useTournamentDisplayLabels } from './tournament/useTournamentDisplayLabels';
import { friendsSocketScopeRef } from './friends/friendsSocketScope';
import { useRegisterFriendsSocketHandlers } from './friends/useRegisterFriendsSocketHandlers';
import { matchmakingSocketScopeRef } from './matchmaking/matchmakingSocketScope';
import { useRegisterMatchmakingSocketHandlers } from './matchmaking/useRegisterMatchmakingSocketHandlers';
import { useRegisterTournamentSocketHandlers } from './tournament/useRegisterTournamentSocketHandlers';

import { useSocialInviteState } from './multiplayer/useSocialInviteState';
import type { MatchFoundPayload } from './matchmaking/types';
import type { RoomAckResponse } from './multiplayer/roomTransport';
import { emitWithAck } from './multiplayer/roomTransport';
import type { RoomEventMeta } from './multiplayer/protocol/roomProtocol';
import {
  LAST_ROOM_STORAGE_KEY,
  readRoomInviteCodeFromLocation,
  saveLastRoomCode,
} from './match/recovery/matchRecovery';
import { shouldPersistJoinedRoom } from './match/recovery/joinedRoomPersistPolicy';
import {
  normalizeRoomPlayers,
  type RoomPlayer,
} from './multiplayer/protocol';

// ─── Utilities ───────────────────────────────────────────────

import type { AppMode } from './appRouteTypes';
import { selectLegacyAppSessionRuntime } from './multiplayer/runtime/runtimeSelectors';
import { createMultiplayerRuntime } from './multiplayer/runtime/createMultiplayerRuntime';
import { MultiplayerRuntimeProvider } from './multiplayer/runtime/runtimeProvider';
import type { MultiplayerRuntime, MultiplayerRuntimeBootstrap } from './multiplayer/runtime/runtimeTypes';
import { useAppRouteState } from './routing/useAppRouteState';
import { resolveAppRoute } from './routing/appRoutePath';
import { useFullscreen } from './utils/useFullscreen';
import { useNetworkStatus } from './hooks/useNetworkStatus';
import { OfflineBanner } from './components/OfflineBanner';
import { deleteAccount } from './auth/deleteAccount';

function normalizeRoomCode(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

// ─── Main App ────────────────────────────────────────────────

export default function App() {
  useRenderProfiler('App');
  const appRootRef = useRef<HTMLDivElement>(null);
  const trayCenterRef = useRef<HTMLDivElement>(null);
  const autoConnectAttemptedRef = useRef(false);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCreateOnConnectRef = useRef(false);
  const pendingCreateResolversRef = useRef<Array<(code: string | null) => void>>([]);
  const [appMode, setAppMode] = useState<AppMode>(() => resolveAppRoute(window.location.pathname).mode);
  const [mpSubView, setMpSubView] = useState<'quick' | 'private'>(
    () => resolveAppRoute(window.location.pathname).multiplayerView ?? 'quick',
  );
  const appModeRef = useRef<AppMode>(appMode);
  const mpSubViewRef = useRef<'quick' | 'private'>(mpSubView);
  const isMutedRef = useRef(false);

  // useAuthSession must be called before useSocketConnectionState (which uses authUser)
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
    updateEmail,
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

  const [overlayPayload, setOverlayPayload] = useState<MatchFoundPayload | null>(null);
  const [roomCode, setRoomCode] = useState('');
  const [, setTournamentActiveRoom] = useState<string | null>(null);
  const roomSocialRuntime = useMultiplayerRoomSocialRuntimeBridge();

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

  const {
    serverUrl,
    socket,
    setSocket,
    isConnected,
    setIsConnected,
    isConnecting,
    setIsConnecting,
    isRecoveringConnection,
    setIsRecoveringConnection,
    roomRecoveryState,
    setRoomRecoveryState,
    roomRecoveryMessage,
    setRoomRecoveryMessage,
    serverWaking,
    setServerWaking,
    socketRef,
    connectRef,
    connectionActions,
    reconnectAttemptTimerRef,
    reconnectAttemptCountRef,
    clearReconnectAttemptTimer,
  } = useSocketConnectionState({ appMode, hasAuthUser: Boolean(authUser), showToast });

  const [abandonedMatchNotice, setAbandonedMatchNotice] = useState<{
    context: 'tournament' | 'multiplayer';
    title: string;
    detail: string;
    tournamentId?: string | null;
  } | null>(null);

  const {
    ghostProfile,
    setGhostProfile,
    ghostOpponentName,
    ghostOpponentUserId,
    setGhostOpponentName,
    setGhostOpponentUserId,
    needsUsernameOnboarding,
    onboardingDismissed,
    setOnboardingDismissed,
    authModalOpen,
    setAuthModalOpen,
    usernameModalOpen,
    setUsernameModalOpen,
    signingOut,
    setSigningOut,
    weeklyStatsOpen,
    setWeeklyStatsOpen,
    welcomeOpen,
    setWelcomeOpen,
  } = useAppSessionUi({ authUser: authUser ? { id: authUser.id, email: authUser.email ?? '' } : null, authProfile, authLoading, justVerified, showToast });

  // Single tournament hook instance, shared by Hub/Bracket/Result screens.
  // Hoisted from the screens so that registration changes / bracket updates /
  // pending match-ready events are observed in App.tsx and can trigger top-level
  // navigation (auto-route to result on tournament:completed).
  const tournament = useTournament({
    userId: authUser?.id ?? null,
  });

  const {
    friendInvite,
    setFriendInvite,
    outboundChallenge,
    setOutboundChallenge,
    clearOutboundChallenge,
  } = useSocialInviteState({ playerCount: players.length, showToast });

  const roomPlayersRef = useRef<RoomPlayer[]>([]);
  const joinedRoomResponseRef = useRef<RoomAckResponse | null>(null);
  const roomIdentityRef = useRef<{
    username: string;
    userId: string | null;
    authToken: string | null;
  } | null>(null);

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
  const maxSequenceRef = useRef<number>(-1);
  const roomMatchIdRef = useRef<string | null>(null);
  const maxEventSequenceRef = useRef<number>(-1);

  useEffect(() => {
    maxSequenceRef.current = -1;
    maxEventSequenceRef.current = -1;
    roomMatchIdRef.current = null;
  }, [joinedRoom]);

  const applyRoomEventMetaRef = useRef<(meta?: RoomEventMeta | null) => void>(() => {});
  const schedulePlayerReadyRef = useRef<() => Promise<void>>(async () => {});
  const applyJoinedRoomResponseRef = useRef<(resp: RoomAckResponse) => void>(() => {});
  const trySchedulePlayerReadyRef = useRef<() => void>(() => {});
  const resyncInFlightRef = useRef(false);
  const roomOperationEpochRef = useRef(0);
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
    roomOperationEpochRef,
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
    roomOperationEpochRef,
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

  const {
    learnHowToPlayOpen,
    setLearnHowToPlayOpen,
    selectedLearnLessonId,
    setSelectedLearnLessonId,
    profileTarget,
    setProfileTarget,
    profileOriginMode,
    setProfileOriginMode,
  } = useAppRouteState({
    appMode,
    setAppMode,
    activeTournamentId,
    tournamentSubView,
    setActiveTournamentId,
    setTournamentSubView,
    appModeRef,
    mpSubView,
    setMpSubView,
    mpSubViewRef,
  });

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

  const {
    isMuted,
    setIsMuted,
    botDealSize,
    setBotDealSize,
    botFritzTier,
    setBotFritzTier,
    isGuidedMode,
    setIsGuidedMode,
    isAuthoringMode,
    setIsAuthoringMode,
    isAuthoringV2Mode,
    setIsAuthoringV2Mode,
    isGuidedV2Mode,
    setIsGuidedV2Mode,
  } = useBotGamePreferences({ appMode, isMutedRef });

  const canOpenHowToPlayPreview = true;

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
    };
  }, []);

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

  // Open auth modal when API layer signals session expiry after failed token refresh
  useEffect(() => {
    const handler = () => setAuthModalOpen(true);
    window.addEventListener('rh:session-expired', handler);
    return () => window.removeEventListener('rh:session-expired', handler);
  }, []);

  const {
    getInviteLink,
    resolvePendingCreate,
    resetClientGameSession,
    resetMultiplayerRoomState,
    clearRecoverableRoomState,
    applyRoomEventMeta,
    emitCreateRoom,
    applyJoinedRoomResponse,
    handleMatchmakingAutoJoin,
  } = useMultiplayerRoomCallbacks({
    pendingCreateResolversRef,
    maxSequenceRef,
    maxEventSequenceRef,
    roomMatchIdRef,
    roomOperationEpochRef,
    resyncBufferedUpdateRef,
    shellDelegatesRef,
    autoJoinAttemptedRef,
    appModeRef,
    joinedRoomResponseRef,
    roomPlayersRef,
    roomIdentityRef,
    youRef,
    socketRef,
    sessionRef,
    applyRoomEventMetaRef,
    schedulePlayerReadyRef,
    applyJoinedRoomResponseRef,
    trySchedulePlayerReadyRef,
    dispatchSession,
    dispatchRecovery,
    setJoinedRoom,
    setRoomCode,
    setYou,
    setPlayers,
    setTournamentMatch,
    setError,
    setOverlayPayload,
    setAppMode,
    showToast,
    shellSetState,
    shellSetLegalMoves,
    shellSetCanDraw,
    shellSetSelectedTile,
    shellSetHandReveal,
    shellSetRematchRequested,
    shellSetRematchReadyIds,
    shellSetActionError,
    authProfile,
    authUser,
    multiplayerIdentityUserId,
    multiplayerAuthToken,
    normalizeRoomCode,
    clearTournamentAttachRefs,
    applyTournamentMetadataFromJoin,
    tournament,
  });

  resetMultiplayerRoomStateRef.current = resetMultiplayerRoomState;
  clearRecoverableRoomStateRef.current = clearRecoverableRoomState;

  const resetRoomRecoveryState = useCallback(() => {
    dispatchRecovery({ type: 'SET_POLICY', policy: 'disabled' });
    dispatchRecovery({ type: 'SET_TARGET_ROOM', roomCode: null });
  }, [dispatchRecovery]);

  const { isFullscreen, toggleFullscreen } = useFullscreen(appRootRef, setError);
  const isOnline = useNetworkStatus();

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
    roomOperationEpochRef,
    setRecoveredTerminalMatchNotice: setAbandonedMatchNotice,
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
    setMpSubView,
  });

  const { connect, disconnect, retryRoomRecovery } = connectionActions;



  const { handlePostGame, abandonCurrentMatch } = useMatchExitHandlers({
    socketRef,
    sessionRef,
    normalizeRoomCode,
    currentTournamentContext,
    tournament,
    resetMultiplayerRoomState,
    resetRoomRecoveryState,
    clearRecoverableRoomState,
    navigateAfterTournamentMatch,
    disconnect,
    showToast,
    shellSetActionError,
    setAppMode,
    setActiveTournamentId,
    setTournamentSubView,
  });

  const { tournamentOpponentLabel, tournamentMyLabel } = useTournamentDisplayLabels({
    tournamentMatch,
    players,
    you,
    authProfile,
  });
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

  const privateLobbyHostWinStreak = usePrivateLobbyWinStreak({
    appMode,
    authUserId: authUser?.id ?? null,
    isConnected,
    isRecoveringConnection,
    joinedRoom,
    hasLiveGameState,
  });

  // ─── Render ───────────────────────────────────────────────
  /**
   * Sign-out, owned here because it is more than the Supabase call: room
   * recovery and multiplayer room state have to be torn down in the same
   * breath, or a reconnect can resurrect the signed-out user's match. The nav
   * menu and the profile modal both route through this.
   */
  const handleSignOut = useCallback(() => {
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
  }, [
    resetRoomRecoveryState,
    setSigningOut,
    setAppMode,
    resetMultiplayerRoomState,
    setError,
    shellSetActionError,
    signOut,
    setUsernameModalOpen,
    setOnboardingDismissed,
    setAuthModalOpen,
  ]);

  /**
   * Saving a handle also retires the onboarding prompt, wherever the save came
   * from — the Settings page or the first-run modal.
   */
  const handleSaveUsername = useCallback(
    async (username: string) => {
      const result = await updateUsername(username);
      if (!result.error) {
        window.localStorage.removeItem('username_onboarding_dismissed');
        setOnboardingDismissed(false);
        setUsernameModalOpen(false);
      }
      return result;
    },
    [updateUsername, setOnboardingDismissed, setUsernameModalOpen],
  );

  /**
   * Deletes the account, then signs out and lands on home.
   *
   * Only a confirmed deletion tears the session down: signing out on a failed
   * call would leave the user unable to retry from a page that requires them
   * to be signed in.
   */
  const handleDeleteAccount = useCallback(
    async (confirmation: string) => {
      const result = await deleteAccount(confirmation);
      if (result.error) return result;
      handleSignOut();
      setAppMode('home');
      return result;
    },
    [handleSignOut, setAppMode],
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
      onUsernameSave={handleSaveUsername}
      onUsernameClose={() => {
        window.localStorage.setItem('username_onboarding_dismissed', Date.now().toString());
        setOnboardingDismissed(true);
        setUsernameModalOpen(false);
      }}
      onUsernameSignOut={handleSignOut}
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
    roomOperationEpochRef,
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
        handleSignOut,
        handleSaveUsername,
        handleDeleteAccount,
        updatePassword,
        updateEmail,
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
        profileOriginMode,
        setProfileOriginMode,
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
      <OfflineBanner online={isOnline} />
      {joinedRoom ? (
        <ErrorBoundary
          context="multiplayer-shell"
          fallback={<MultiplayerShellErrorFallback />}
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
