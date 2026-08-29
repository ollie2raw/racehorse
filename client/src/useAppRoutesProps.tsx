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
import type { AppRoutesHostRouteBundles, AppRoutesProps } from './appRouteTypes';
import type {
  MultiplayerConnectionConfig,
  MultiplayerConnectionState,
  MultiplayerControllerConnectionBundle,
} from './multiplayer/runtime/connectionRuntime';
import type { MultiplayerControllerLobbySnapshot } from './multiplayer/runtime/roomRuntime';

type AppRoutesHostSource = {
  multiplayerConnectionHostParams: UseMultiplayerConnectionParams;
  connectionActions: MultiplayerConnectionActionsBridge;
  multiplayerLobbyHostProps: MultiplayerLobbyActionsHostProps;
  authModalsLayer: React.ReactNode;
};

type MultiplayerAssemblySource = MultiplayerMatchmakingView &
  Omit<MultiplayerControllerLobbySnapshot, 'joinedRoom' | 'outboundChallenge' | 'lobbyError'> &
  MultiplayerLiveMatchView &
  MultiplayerPostGameView &
  MultiplayerAbandonedMatchView &
  Omit<MultiplayerTournamentPassthroughView, 'setActiveTournamentId' | 'setTournamentSubView'>;

export type UseAppRoutesPropsSource = {
  host: AppRoutesHostSource;
  routeBundles: AppRoutesHostRouteBundles;
  friendInvitePopup: React.ReactNode;
  multiplayerConnectionState: MultiplayerConnectionState;
  multiplayerConnectionConfig: MultiplayerConnectionConfig;
  connect: () => void;
  retryRoomRecovery: () => void;
  isRecoveringConnection: boolean;
  serverWaking: boolean;
  roomRecoveryMessage: string;
  actionError: string;
  state: import('./types').GameState | null;
  startGame: () => void;
  setActionError: import('react').Dispatch<import('react').SetStateAction<string>>;
} & MultiplayerAssemblySource;

export function useAppRoutesProps(source: UseAppRoutesPropsSource): AppRoutesProps {
  const { host, routeBundles } = source;
  const { navigation, auth, learn, botMatch, ghost, social, homeOverlays, tournament, multiplayerRoute } =
    routeBundles;

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

  const handleOpenAuthModal = useCallback(() => auth.setAuthModalOpen(true), [auth.setAuthModalOpen]);
  // App.tsx owns sign-out: it tears down room recovery and multiplayer state
  // alongside the Supabase call.
  const handleSignOut = auth.handleSignOut;

  const multiplayerConnectionBundle = useMemo(
    (): MultiplayerControllerConnectionBundle => ({
      connectionState: source.multiplayerConnectionState,
      config: source.multiplayerConnectionConfig,
      connect: source.connect,
      retryRoomRecovery: source.retryRoomRecovery,
      isRecoveringConnection: source.isRecoveringConnection,
      serverWaking: source.serverWaking,
      roomRecoveryMessage: source.roomRecoveryMessage,
      setAppMode: navigation.setAppMode,
    }),
    [
      source.multiplayerConnectionState,
      source.multiplayerConnectionConfig,
      source.connect,
      source.retryRoomRecovery,
      source.isRecoveringConnection,
      source.serverWaking,
      source.roomRecoveryMessage,
      navigation.setAppMode,
    ],
  );

  const multiplayerModeViewProps = useMemo(
    (): MultiplayerModeViewProps => ({
      authView: {
        authUser: auth.authUser,
        authProfile: auth.authProfile,
        onOpenAuth: handleOpenAuthModal,
        onOpenAuthModal: handleOpenAuthModal,
        onSignOut: handleSignOut,
      },
      matchmakingView: {
        overlayPayload: source.overlayPayload,
        setOverlayPayload: source.setOverlayPayload,
        handleMatchmakingAutoJoin: source.handleMatchmakingAutoJoin,
      },
      lobbyView: {
        joinedRoom: social.joinedRoom,
        you: source.you,
        players: source.players,
        isRoomHost: source.isRoomHost,
        pendingUiAction: source.pendingUiAction,
        privateLobbyHostWinStreak: source.privateLobbyHostWinStreak,
        outboundChallenge: social.outboundChallenge,
        lobbyError: multiplayerRoute.error,
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
        preGameDraw: source.preGameDraw,
        onPregameTileTap: source.onPregameTileTap,
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
        setActiveTournamentId: tournament.setActiveTournamentId,
        setTournamentSubView: tournament.setTournamentSubView,
      },
    }),
    [
      auth.authUser,
      auth.authProfile,
      source.overlayPayload,
      source.handleMatchmakingAutoJoin,
      social.joinedRoom,
      source.you,
      source.players,
      source.isRoomHost,
      source.pendingUiAction,
      source.privateLobbyHostWinStreak,
      social.outboundChallenge,
      multiplayerRoute.error,
      source.boardRef,
      source.boneyardRef,
      source.confettiCanvasRef,
      source.consumedTournamentGameOverMatchIds,
      source.handAreaRef,
      source.opponentPillRef,
      source.setAbandonedMatchNotice,
      tournament.setActiveTournamentId,
      source.setIsMuted,
      source.setOverlayPayload,
      source.setScoreTrackOpen,
      source.setShowLeaveConfirm,
      tournament.setTournamentSubView,
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
      handleSignOut,
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
    shell: {
      withAuthModals,
      fallbackConnectionHost,
      appRootClassName,
      appRootRef: navigation.appRootRef,
      friendInvitePopup: source.friendInvitePopup,
    },
    navigation: {
      appMode: navigation.appMode,
      setAppMode: navigation.setAppMode,
    },
    auth: {
      handleOpenAuthModal,
      handleSignOut,
      isAdmin: auth.isAdmin,
      authUser: auth.authUser,
      authProfile: auth.authProfile,
      supabaseEnabled: auth.supabaseEnabled,
      supabaseConfigError: auth.supabaseConfigError,
      refreshAuthProfile: auth.refreshAuthProfile,
      applyProfilePatch: auth.applyProfilePatch,
      setAuthModalOpen: auth.setAuthModalOpen,
      setUsernameModalOpen: auth.setUsernameModalOpen,
      myHandle: auth.myHandle,
      homeRatingLabel: auth.homeRatingLabel,
    },
    learn: {
      showLearnAdminView,
      canOpenHowToPlayPreview: learn.canOpenHowToPlayPreview,
      selectedLearnLessonId: learn.selectedLearnLessonId,
      setSelectedLearnLessonId: learn.setSelectedLearnLessonId,
      learnHowToPlayOpen: learn.learnHowToPlayOpen,
      setLearnHowToPlayOpen: learn.setLearnHowToPlayOpen,
      setIsGuidedMode: learn.setIsGuidedMode,
      setIsAuthoringMode: learn.setIsAuthoringMode,
      setIsAuthoringV2Mode: learn.setIsAuthoringV2Mode,
      setIsGuidedV2Mode: learn.setIsGuidedV2Mode,
    },
    botMatch,
    ghost,
    social: {
      socket: social.socket,
      connect: source.connect,
      joinedRoom: social.joinedRoom,
      showToast: social.showToast,
      outboundChallenge: social.outboundChallenge,
      clearOutboundChallenge: social.clearOutboundChallenge,
      profileTarget: social.profileTarget,
      setProfileTarget: social.setProfileTarget,
      profileOriginMode: social.profileOriginMode,
      setProfileOriginMode: social.setProfileOriginMode,
      toast: social.toast,
    },
    homeOverlays,
    multiplayer: {
      error: multiplayerRoute.error,
      actionError: source.actionError,
      state: source.state,
      setError: multiplayerRoute.setError,
      setActionError: source.setActionError,
      multiplayerConnectionBundle,
      mpSubView: multiplayerRoute.mpSubView,
      startGame: source.startGame,
      multiplayerModeViewProps,
    },
    tournament,
  };
}
