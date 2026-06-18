import React, { useCallback, useMemo } from 'react';
import { MultiplayerConnectionHost } from './multiplayer/MultiplayerConnectionHost';
import { MultiplayerLobbyActionsHost } from './multiplayer/useMultiplayerLobbyController';
import type { UseMultiplayerConnectionParams } from './multiplayer/useMultiplayerConnection';
import type { MultiplayerConnectionActionsBridge } from './multiplayer/useMultiplayerConnectionContext';
import type { MultiplayerLobbyActionsHostProps } from './multiplayer/useMultiplayerLobbyController';
import type {
  MultiplayerAbandonedMatchView,
  MultiplayerLiveMatchView,
  MultiplayerMatchmakingView,
  MultiplayerModeViewProps,
  MultiplayerPostGameView,
  MultiplayerTournamentPassthroughView,
} from './multiplayer/MultiplayerModeController';
import type { AppRoutesProps } from './appRouteTypes';
import type {
  MultiplayerConnectionConfig,
  MultiplayerConnectionState,
  MultiplayerControllerConnectionBundle,
  MultiplayerControllerLobbySnapshot,
} from './multiplayer/multiplayerRuntime';

type AppRoutesHostSource = {
  multiplayerConnectionHostParams: UseMultiplayerConnectionParams;
  connectionActions: MultiplayerConnectionActionsBridge;
  multiplayerLobbyHostProps: MultiplayerLobbyActionsHostProps;
  authModalsLayer: React.ReactNode;
};

type MultiplayerAssemblySource = MultiplayerMatchmakingView &
  MultiplayerControllerLobbySnapshot &
  MultiplayerLiveMatchView &
  MultiplayerPostGameView &
  MultiplayerAbandonedMatchView &
  MultiplayerTournamentPassthroughView;

export type UseAppRoutesPropsSource = Omit<
  AppRoutesProps,
  | 'withAuthModals'
  | 'fallbackConnectionHost'
  | 'appRootClassName'
  | 'handleOpenAuthModal'
  | 'handleOpenAccountModal'
  | 'showLearnAdminView'
  | 'multiplayerConnectionBundle'
  | 'multiplayerModeViewProps'
> & {
  host: AppRoutesHostSource;
  multiplayerConnectionState: MultiplayerConnectionState;
  multiplayerConnectionConfig: MultiplayerConnectionConfig;
  retryRoomRecovery: () => void;
  isRecoveringConnection: boolean;
  serverWaking: boolean;
  roomRecoveryMessage: string;
} & MultiplayerAssemblySource;

export function useAppRoutesProps(source: UseAppRoutesPropsSource): AppRoutesProps {
  const { host } = source;

  const appRootClassName = 'app large-mode';

  const showLearnAdminView = useMemo(() => {
    if (typeof window === 'undefined') return false;
    try {
      const params = new URLSearchParams(window.location.search);
      const raw = params.get('learnAdmin')?.trim().toLowerCase();
      return raw === '1' || raw === 'true' || raw === 'yes';
    } catch {
      return false;
    }
  }, []);

  const handleOpenAuthModal = useCallback(() => source.setAuthModalOpen(true), [source.setAuthModalOpen]);
  const handleOpenAccountModal = useCallback(() => source.setUsernameModalOpen(true), [source.setUsernameModalOpen]);

  const multiplayerConnectionBundle = useMemo(
    (): MultiplayerControllerConnectionBundle => ({
      connectionState: source.multiplayerConnectionState,
      config: source.multiplayerConnectionConfig,
      connect: source.connect,
      retryRoomRecovery: source.retryRoomRecovery,
      isRecoveringConnection: source.isRecoveringConnection,
      serverWaking: source.serverWaking,
      roomRecoveryMessage: source.roomRecoveryMessage,
      setAppMode: source.setAppMode,
    }),
    [
      source.multiplayerConnectionState,
      source.multiplayerConnectionConfig,
      source.connect,
      source.retryRoomRecovery,
      source.isRecoveringConnection,
      source.serverWaking,
      source.roomRecoveryMessage,
      source.setAppMode,
    ],
  );

  const multiplayerModeViewProps = useMemo(
    (): MultiplayerModeViewProps => ({
      authView: {
        authUser: source.authUser,
        authProfile: source.authProfile,
        onOpenAuth: handleOpenAuthModal,
        onOpenAccount: handleOpenAccountModal,
        onOpenAuthModal: handleOpenAuthModal,
        onOpenAccountModal: handleOpenAccountModal,
      },
      matchmakingView: {
        overlayPayload: source.overlayPayload,
        setOverlayPayload: source.setOverlayPayload,
        handleMatchmakingAutoJoin: source.handleMatchmakingAutoJoin,
      },
      lobbyView: {
        joinedRoom: source.joinedRoom,
        you: source.you,
        players: source.players,
        isRoomHost: source.isRoomHost,
        pendingUiAction: source.pendingUiAction,
        privateLobbyHostWinStreak: source.privateLobbyHostWinStreak,
        outboundChallenge: source.outboundChallenge,
        lobbyError: source.error,
      },
      liveMatchView: {
        state: source.state,
        opponentId: source.opponentId,
        opponentName: source.opponentName,
        myName: source.myName,
        myScore: source.myScore,
        opponentScore: source.opponentScore,
        opponentTileCount: source.opponentTileCount,
        isMyTurn: source.isMyTurn,
        isHandActive: source.isHandActive,
        hudScorePulse: source.hudScorePulse,
        hudRightLabel: source.hudRightLabel,
        hudRightScore: source.hudRightScore,
        hudRightScorePulse: source.hudRightScorePulse,
        opponentPillRef: source.opponentPillRef,
        boneyardRef: source.boneyardRef,
        boneyardCount: source.boneyardCount,
        openEndsSum: source.openEndsSum,
        boardRef: source.boardRef,
        handAreaRef: source.handAreaRef,
        trayCenterRef: source.trayCenterRef,
        confettiCanvasRef: source.confettiCanvasRef,
        boardForDisplay: source.boardForDisplay,
        boardLegalMoves: source.boardLegalMoves,
        boardSelectedTile: source.boardSelectedTile,
        lastPlayedTile: source.lastPlayedTile,
        boardShowOpenEndGlow: source.boardShowOpenEndGlow,
        play: source.play,
        myHand: source.myHand,
        handSelectedTile: source.handSelectedTile,
        handleTileTap: source.handleTileTap,
        legalMoves: source.legalMoves,
        handTileSize: source.handTileSize,
        handCompactStacked: source.handCompactStacked,
        drawPulseIndex: source.drawPulseIndex,
        scoreToast: source.scoreToast,
        scoreTrackOpen: source.scoreTrackOpen,
        setScoreTrackOpen: source.setScoreTrackOpen,
        isMuted: source.isMuted,
        setIsMuted: source.setIsMuted,
        isFullscreen: source.isFullscreen,
        toggleFullscreen: source.toggleFullscreen,
        opponentDisconnected: source.opponentDisconnected,
        opponentDisconnectMessage: source.opponentDisconnectMessage,
        handReveal: source.handReveal,
        handRevealAutoProgress: source.handRevealAutoProgress,
        flyingTiles: source.flyingTiles,
      },
      postGameView: {
        canUseRematch: source.canUseRematch,
        rematchRequested: source.rematchRequested,
        rematchWaitingText: source.rematchWaitingText,
        requestRematch: source.requestRematch,
        handlePostGame: source.handlePostGame,
        multiplayerRatingSummary: source.multiplayerRatingSummary,
        openMultiplayerAnalyzer: source.openMultiplayerAnalyzer,
      },
      abandonedMatchView: {
        showLeaveConfirm: source.showLeaveConfirm,
        setShowLeaveConfirm: source.setShowLeaveConfirm,
        abandonCurrentMatch: source.abandonCurrentMatch,
        abandonedMatchNotice: source.abandonedMatchNotice,
        setAbandonedMatchNotice: source.setAbandonedMatchNotice,
      },
      tournamentPassthroughView: {
        tournamentMatch: source.tournamentMatch,
        consumedTournamentGameOverMatchIds: source.consumedTournamentGameOverMatchIds,
        tournamentMyLabel: source.tournamentMyLabel,
        tournamentOpponentLabel: source.tournamentOpponentLabel,
        navigateAfterTournamentMatch: source.navigateAfterTournamentMatch,
        currentTournamentContext: source.currentTournamentContext,
        setActiveTournamentId: source.setActiveTournamentId,
        setTournamentSubView: source.setTournamentSubView,
      },
    }),
    [
      source.authUser,
      source.authProfile,
      source.overlayPayload,
      source.handleMatchmakingAutoJoin,
      source.joinedRoom,
      source.you,
      source.players,
      source.isRoomHost,
      source.pendingUiAction,
      source.privateLobbyHostWinStreak,
      source.outboundChallenge,
      source.error,
      source.boardRef,
      source.boneyardRef,
      source.confettiCanvasRef,
      source.consumedTournamentGameOverMatchIds,
      source.handAreaRef,
      source.opponentPillRef,
      source.setAbandonedMatchNotice,
      source.setActiveTournamentId,
      source.setIsMuted,
      source.setOverlayPayload,
      source.setScoreTrackOpen,
      source.setShowLeaveConfirm,
      source.setTournamentSubView,
      source.trayCenterRef,
      source.state,
      source.opponentId,
      source.opponentName,
      source.myName,
      source.myScore,
      source.opponentScore,
      source.opponentTileCount,
      source.isMyTurn,
      source.isHandActive,
      source.hudScorePulse,
      source.hudRightLabel,
      source.hudRightScore,
      source.hudRightScorePulse,
      source.boneyardCount,
      source.openEndsSum,
      source.boardForDisplay,
      source.boardLegalMoves,
      source.boardSelectedTile,
      source.lastPlayedTile,
      source.boardShowOpenEndGlow,
      source.play,
      source.myHand,
      source.handSelectedTile,
      source.handleTileTap,
      source.legalMoves,
      source.handTileSize,
      source.handCompactStacked,
      source.drawPulseIndex,
      source.scoreToast,
      source.scoreTrackOpen,
      source.isMuted,
      source.isFullscreen,
      source.toggleFullscreen,
      source.opponentDisconnected,
      source.opponentDisconnectMessage,
      source.handReveal,
      source.handRevealAutoProgress,
      source.flyingTiles,
      source.canUseRematch,
      source.rematchRequested,
      source.rematchWaitingText,
      source.requestRematch,
      source.handlePostGame,
      source.multiplayerRatingSummary,
      source.openMultiplayerAnalyzer,
      source.showLeaveConfirm,
      source.abandonCurrentMatch,
      source.abandonedMatchNotice,
      source.tournamentMatch,
      source.tournamentMyLabel,
      source.tournamentOpponentLabel,
      source.navigateAfterTournamentMatch,
      source.currentTournamentContext,
      handleOpenAuthModal,
      handleOpenAccountModal,
    ],
  );

  const withAuthModals = useCallback(
    (node: React.ReactNode) => (
      <MultiplayerConnectionHost {...host.multiplayerConnectionHostParams} actionsBridge={host.connectionActions}>
        <MultiplayerLobbyActionsHost {...host.multiplayerLobbyHostProps}>
          <>
            {node}
            {host.authModalsLayer}
          </>
        </MultiplayerLobbyActionsHost>
      </MultiplayerConnectionHost>
    ),
    [host.authModalsLayer, host.connectionActions, host.multiplayerConnectionHostParams, host.multiplayerLobbyHostProps],
  );

  const fallbackConnectionHost = useMemo(
    () => (
      <MultiplayerConnectionHost {...host.multiplayerConnectionHostParams} actionsBridge={host.connectionActions} />
    ),
    [host.connectionActions, host.multiplayerConnectionHostParams],
  );

  return {
    withAuthModals,
    fallbackConnectionHost,
    appRootClassName,
    handleOpenAuthModal,
    handleOpenAccountModal,
    showLearnAdminView,
    multiplayerConnectionBundle,
    multiplayerModeViewProps,
    appMode: source.appMode,
    appRootRef: source.appRootRef,
    setAppMode: source.setAppMode,
    canOpenHowToPlayPreview: source.canOpenHowToPlayPreview,
    isAdmin: source.isAdmin,
    authUser: source.authUser,
    authProfile: source.authProfile,
    supabaseEnabled: source.supabaseEnabled,
    supabaseConfigError: source.supabaseConfigError,
    selectedLearnLessonId: source.selectedLearnLessonId,
    setSelectedLearnLessonId: source.setSelectedLearnLessonId,
    learnHowToPlayOpen: source.learnHowToPlayOpen,
    setLearnHowToPlayOpen: source.setLearnHowToPlayOpen,
    setIsGuidedMode: source.setIsGuidedMode,
    setIsAuthoringMode: source.setIsAuthoringMode,
    setIsAuthoringV2Mode: source.setIsAuthoringV2Mode,
    setIsGuidedV2Mode: source.setIsGuidedV2Mode,
    setBotFritzTier: source.setBotFritzTier,
    setBotDealSize: source.setBotDealSize,
    botDealSize: source.botDealSize,
    botFritzTier: source.botFritzTier,
    isGuidedMode: source.isGuidedMode,
    isAuthoringMode: source.isAuthoringMode,
    isAuthoringV2Mode: source.isAuthoringV2Mode,
    isGuidedV2Mode: source.isGuidedV2Mode,
    refreshAuthProfile: source.refreshAuthProfile,
    applyProfilePatch: source.applyProfilePatch,
    ghostProfile: source.ghostProfile,
    setGhostProfile: source.setGhostProfile,
    ghostOpponentName: source.ghostOpponentName,
    ghostOpponentUserId: source.ghostOpponentUserId,
    setGhostOpponentName: source.setGhostOpponentName,
    setGhostOpponentUserId: source.setGhostOpponentUserId,
    setAuthModalOpen: source.setAuthModalOpen,
    setUsernameModalOpen: source.setUsernameModalOpen,
    socket: source.socket,
    connect: source.connect,
    joinedRoom: source.joinedRoom,
    showToast: source.showToast,
    outboundChallenge: source.outboundChallenge,
    clearOutboundChallenge: source.clearOutboundChallenge,
    profileTarget: source.profileTarget,
    setProfileTarget: source.setProfileTarget,
    friendInvitePopup: source.friendInvitePopup,
    toast: source.toast,
    error: source.error,
    actionError: source.actionError,
    state: source.state,
    setError: source.setError,
    setActionError: source.setActionError,
    mpSubView: source.mpSubView,
    startGame: source.startGame,
    myHandle: source.myHandle,
    homeRatingLabel: source.homeRatingLabel,
    activeHomeMode: source.activeHomeMode,
    setActiveHomeMode: source.setActiveHomeMode,
    welcomeOpen: source.welcomeOpen,
    setWelcomeOpen: source.setWelcomeOpen,
    weeklyStatsOpen: source.weeklyStatsOpen,
    setWeeklyStatsOpen: source.setWeeklyStatsOpen,
    tournament: source.tournament,
    tournamentSubView: source.tournamentSubView,
    activeTournamentId: source.activeTournamentId,
    tournamentAttachPhase: source.tournamentAttachPhase,
    tournamentAttachError: source.tournamentAttachError,
    tournamentResult: source.tournamentResult,
    tournamentResultLoading: source.tournamentResultLoading,
    tournamentResultError: source.tournamentResultError,
    setTournamentSubView: source.setTournamentSubView,
    setActiveTournamentId: source.setActiveTournamentId,
    setTournamentResult: source.setTournamentResult,
    setTournamentResultLoading: source.setTournamentResultLoading,
    setTournamentResultError: source.setTournamentResultError,
    exitToTournamentHub: source.exitToTournamentHub,
    enterTournamentLobby: source.enterTournamentLobby,
    attachAssignedTournamentMatch: source.attachAssignedTournamentMatch,
  };
}
