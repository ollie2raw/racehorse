import React, { Suspense } from 'react';
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';
import type { User } from '@supabase/supabase-js';
import { ScreenLoader } from '../ui/ScreenLoader';
import type { BoardHandle } from '../components';
import type { GameState, Move, PlacementPosition, Tile } from '../types';
import type { MatchFoundPayload } from '../matchmaking/types';
import type { TournamentMatchContext } from '../match/session/useTournamentMatchSession';
import type {
  MultiplayerControllerConnectionBundle,
  MultiplayerControllerLobbySnapshot,
} from './multiplayerRuntime';
import { useMultiplayerLobbyActionsContext } from './useMultiplayerLobbyController';

const MatchmakingScreen = React.lazy(() => import('../matchmaking/MatchmakingScreen'));
const PrivateMatchLobbyScreen = React.lazy(() => import('./PrivateMatchLobbyScreen'));
const LiveMatchScreen = React.lazy(() =>
  import('../match/LiveMatchScreen').then((module) => ({ default: module.LiveMatchScreen })),
);
const MatchFoundOverlay = React.lazy(() =>
  import('../matchmaking/MatchFoundOverlay').then((module) => ({ default: module.MatchFoundOverlay })),
);

type HandEndedPayload = {
  handNumber: number;
  opponentRemainingTiles: Tile[];
  yourRemainingTiles: Tile[];
  pointsAwarded: {
    you: number;
    opponent: number;
  };
  whoWentOut?: string | null;
  winnerId?: string | null;
  handWinnerId?: string | null;
};

type AbandonedMatchNotice = {
  context: 'tournament' | 'multiplayer';
  title: string;
  detail: string;
  tournamentId?: string | null;
};

export type MultiplayerAuthView = {
  authUser: User | null;
  authProfile: {
    username?: string | null;
    glicko_rating?: number | null;
  } | null;
  onOpenAuth: () => void;
  onOpenAccount: () => void;
  onOpenAuthModal: () => void;
  onOpenAccountModal: () => void;
};

export type MultiplayerMatchmakingView = {
  overlayPayload: MatchFoundPayload | null;
  setOverlayPayload: Dispatch<SetStateAction<MatchFoundPayload | null>>;
  handleMatchmakingAutoJoin: (payload: MatchFoundPayload) => void;
};

export type MultiplayerLiveMatchView = {
  state: GameState | null;
  opponentId: string | null;
  opponentName: string;
  myName: string;
  myScore: number;
  opponentScore: number;
  opponentTileCount: number;
  isMyTurn: boolean;
  isHandActive: boolean;
  hudScorePulse: Record<string, boolean>;
  hudRightLabel: string;
  hudRightScore: number;
  hudRightScorePulse: boolean;
  opponentPillRef: RefObject<HTMLButtonElement | null>;
  boneyardRef: RefObject<HTMLDivElement | null>;
  boneyardCount: number;
  openEndsSum: number;
  boardRef: RefObject<BoardHandle | null>;
  handAreaRef: RefObject<HTMLDivElement | null>;
  trayCenterRef: RefObject<HTMLDivElement | null>;
  confettiCanvasRef: RefObject<HTMLCanvasElement | null>;
  boardForDisplay: GameState['board'] | null;
  boardLegalMoves: Move[];
  boardSelectedTile: Tile | null;
  lastPlayedTile: Tile | null;
  boardShowOpenEndGlow: boolean;
  play: (position: PlacementPosition) => void;
  myHand: Tile[];
  handSelectedTile: Tile | null;
  handleTileTap: (tile: Tile) => void;
  legalMoves: Move[];
  handTileSize: number;
  handCompactStacked: boolean;
  drawPulseIndex: number | null;
  scoreToast: { message: string; tone: 'you' | 'opp'; visible: boolean } | null;
  scoreTrackOpen: boolean;
  setScoreTrackOpen: Dispatch<SetStateAction<boolean>>;
  isMuted: boolean;
  setIsMuted: Dispatch<SetStateAction<boolean>>;
  isFullscreen: boolean;
  toggleFullscreen: () => void;
  opponentDisconnected: boolean;
  opponentDisconnectMessage: string;
  handReveal: HandEndedPayload | null;
  handRevealAutoProgress: number;
  flyingTiles: { x: number; y: number; toX: number; toY: number; id: number }[];
};

export type MultiplayerPostGameView = {
  canUseRematch: boolean;
  rematchRequested: boolean;
  rematchWaitingText: string | undefined;
  requestRematch: () => void;
  handlePostGame: () => void;
  multiplayerRatingSummary: {
    pending: boolean;
    delta: number | null;
    newRating: number | null;
  } | null;
  openMultiplayerAnalyzer: () => void;
};

export type MultiplayerAbandonedMatchView = {
  showLeaveConfirm: boolean;
  setShowLeaveConfirm: Dispatch<SetStateAction<boolean>>;
  abandonCurrentMatch: () => Promise<void>;
  abandonedMatchNotice: AbandonedMatchNotice | null;
  setAbandonedMatchNotice: Dispatch<SetStateAction<AbandonedMatchNotice | null>>;
};

export type MultiplayerTournamentPassthroughView = {
  tournamentMatch: TournamentMatchContext | null;
  consumedTournamentGameOverMatchIdsRef: MutableRefObject<Set<string>>;
  tournamentMyLabel: string;
  tournamentOpponentLabel: string | null;
  navigateAfterTournamentMatch: (nextView: 'hub' | 'bracket' | 'result') => void;
  currentTournamentContext: TournamentMatchContext | null;
  setActiveTournamentId: Dispatch<SetStateAction<string | null>>;
  setTournamentSubView: Dispatch<SetStateAction<'hub' | 'bracket' | 'result'>>;
};

export type MultiplayerModeViewProps = {
  authView: MultiplayerAuthView;
  matchmakingView: MultiplayerMatchmakingView;
  lobbyView: MultiplayerControllerLobbySnapshot;
  liveMatchView: MultiplayerLiveMatchView;
  postGameView: MultiplayerPostGameView;
  abandonedMatchView: MultiplayerAbandonedMatchView;
  tournamentPassthroughView: MultiplayerTournamentPassthroughView;
};

export type MultiplayerModeControllerProps = {
  connection: MultiplayerControllerConnectionBundle;
  mpSubView: 'quick' | 'private';
  startGame: () => void;
  view: MultiplayerModeViewProps;
};

export default function MultiplayerModeController({
  connection,
  mpSubView,
  startGame,
  view,
}: MultiplayerModeControllerProps) {
  const {
    createRoom,
    joinRoom,
    leavePrivateLobbyRoom,
    copyInviteLink,
    copyRoomCodeToClipboard,
    roomActionsUi,
    roomReactions,
    sendRoomChat,
    sendRoomEmote,
  } = useMultiplayerLobbyActionsContext();
  const { setMpSubView, setRoomCode } = roomActionsUi;

  const { authView, matchmakingView, lobbyView, liveMatchView, postGameView, abandonedMatchView, tournamentPassthroughView } =
    view;

  const {
    connectionState,
    config,
    connect,
    retryRoomRecovery,
    isRecoveringConnection,
    serverWaking,
    roomRecoveryMessage,
    setAppMode,
  } = connection;
  const { socket, isConnected, isConnecting, roomRecoveryState, roomCode } = connectionState;
  const { serverUrl } = config;

  const { authUser, authProfile, onOpenAuth, onOpenAccount, onOpenAuthModal, onOpenAccountModal } = authView;

  const { overlayPayload, setOverlayPayload, handleMatchmakingAutoJoin } = matchmakingView;

  const {
    joinedRoom,
    you,
    players,
    isRoomHost,
    pendingUiAction,
    privateLobbyHostWinStreak,
    outboundChallenge,
    lobbyError,
  } = lobbyView;

  const {
    state,
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
  } = liveMatchView;

  const {
    canUseRematch,
    rematchRequested,
    rematchWaitingText,
    requestRematch,
    handlePostGame,
    multiplayerRatingSummary,
    openMultiplayerAnalyzer,
  } = postGameView;

  const {
    showLeaveConfirm,
    setShowLeaveConfirm,
    abandonCurrentMatch,
    abandonedMatchNotice,
    setAbandonedMatchNotice,
  } = abandonedMatchView;

  const {
    tournamentMatch,
    consumedTournamentGameOverMatchIdsRef,
    tournamentMyLabel,
    tournamentOpponentLabel,
    navigateAfterTournamentMatch,
    currentTournamentContext,
    setActiveTournamentId,
    setTournamentSubView,
  } = tournamentPassthroughView;

  return (
    <>
      {(!isConnected && !isRecoveringConnection) ||
      (isConnected && !joinedRoom) ||
      (isConnected && joinedRoom && !state) ? (
        mpSubView === 'quick' && !joinedRoom ? (
          <Suspense fallback={<ScreenLoader label="Loading Quick Match…" />}>
            <MatchmakingScreen
              socket={socket}
              isConnected={isConnected}
              isConnecting={isConnecting}
              serverUrl={serverUrl}
              onRetryConnect={connect}
              identity={
                authUser?.id
                  ? {
                      userId: authUser.id,
                      username: authProfile?.username ?? authUser.email?.split('@')[0] ?? 'player',
                    }
                  : null
              }
              myRating={
                authProfile?.glicko_rating != null
                  ? Math.round(Number(authProfile.glicko_rating))
                  : null
              }
              myWinStreak={privateLobbyHostWinStreak}
              onNavigate={setAppMode}
              onOpenAuth={onOpenAuth}
              onOpenAccount={onOpenAccount}
              onBackHome={() => setAppMode('home')}
              onOpenPrivateMatch={() => setMpSubView('private')}
              onAutoJoinRoom={handleMatchmakingAutoJoin}
            />
          </Suspense>
        ) : mpSubView === 'quick' && joinedRoom && !state ? (
          <div
            className="mp-quick-starting"
            style={{
              flex: '1 1 0',
              minHeight: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-secondary, rgba(255,255,255,0.72))',
              fontSize: '1.05rem',
              letterSpacing: '0.04em',
            }}
          >
            Starting match…
          </div>
        ) : (
          <Suspense fallback={<ScreenLoader label="Loading Private Match…" />}>
            <PrivateMatchLobbyScreen
              phase={
                !isConnected && !isRecoveringConnection
                  ? 'disconnected'
                  : isConnected && !joinedRoom
                    ? 'lobby'
                    : 'room'
              }
              onNavigate={setAppMode}
              onOpenAuth={onOpenAuthModal}
              onOpenAccount={onOpenAccountModal}
              onBackHome={() => {
                setMpSubView('quick');
                setAppMode('home');
              }}
              isConnecting={isConnecting}
              serverWaking={serverWaking}
              serverUrl={serverUrl}
              onConnect={connect}
              roomCode={roomCode}
              onRoomCodeChange={setRoomCode}
              onCreateRoom={createRoom}
              onJoinRoom={joinRoom}
              pendingLobbyAction={
                pendingUiAction === 'create' || pendingUiAction === 'join' ? pendingUiAction : null
              }
              joinedRoom={joinedRoom ?? ''}
              players={players}
              you={you}
              isRoomHost={isRoomHost}
              onLeaveRoom={leavePrivateLobbyRoom}
              onStartGame={startGame}
              pendingStart={pendingUiAction === 'start'}
              onCopyInviteLink={copyInviteLink}
              onCopyRoomCode={copyRoomCodeToClipboard}
              myRating={
                authProfile?.glicko_rating != null ? Math.round(Number(authProfile.glicko_rating)) : null
              }
              myUsername={authProfile?.username ?? null}
              roomChatFeed={roomReactions}
              onSendRoomChat={sendRoomChat}
              winTarget={60}
              isRatedEligible={Boolean(authUser?.id)}
              roomRecoveryState={roomRecoveryState}
              roomRecoveryMessage={roomRecoveryMessage}
              onRetryRoomRecovery={retryRoomRecovery}
              hostWinStreak={privateLobbyHostWinStreak}
              onOpenQuickMatch={() => setMpSubView('quick')}
              socket={socket}
              pendingChallenge={
                outboundChallenge && players.length < 2
                  ? {
                      friendUsername: outboundChallenge.friendUsername,
                      matchSummary: outboundChallenge.matchSummary,
                      expiresAt: outboundChallenge.expiresAt,
                    }
                  : null
              }
              lobbyError={lobbyError}
            />
          </Suspense>
        )
      ) : null}

      {(isConnected || isRecoveringConnection) && joinedRoom && state ? (
        <Suspense fallback={<ScreenLoader label="Loading Match…" />}>
          <LiveMatchScreen
            visible={Boolean((isConnected || isRecoveringConnection) && joinedRoom && state)}
            state={state}
            you={you}
            opponentId={opponentId}
            opponentName={opponentName}
            myName={myName}
            myScore={myScore}
            opponentScore={opponentScore}
            opponentTileCount={opponentTileCount}
            isMyTurn={isMyTurn}
            isHandActive={isHandActive}
            hudScorePulse={hudScorePulse}
            hudRightLabel={hudRightLabel}
            hudRightScore={hudRightScore}
            hudRightScorePulse={hudRightScorePulse}
            opponentPillRef={opponentPillRef}
            boneyardRef={boneyardRef}
            boneyardCount={boneyardCount}
            openEndsSum={openEndsSum}
            boardRef={boardRef}
            handAreaRef={handAreaRef}
            trayCenterRef={trayCenterRef}
            confettiCanvasRef={confettiCanvasRef}
            boardForDisplay={boardForDisplay}
            boardLegalMoves={boardLegalMoves}
            boardSelectedTile={boardSelectedTile}
            lastPlayedTile={lastPlayedTile}
            boardShowOpenEndGlow={boardShowOpenEndGlow}
            onPositionClick={play}
            myHand={myHand}
            handSelectedTile={handSelectedTile}
            onHandTileSelect={handleTileTap}
            legalMoves={legalMoves}
            handTileSize={handTileSize}
            handCompactStacked={handCompactStacked}
            drawPulseIndex={drawPulseIndex}
            scoreToast={scoreToast}
            scoreTrackOpen={scoreTrackOpen}
            onScoreTrackOpenChange={setScoreTrackOpen}
            roomReactions={roomReactions}
            onSendRoomChat={sendRoomChat}
            onSendRoomEmote={sendRoomEmote}
            isMuted={isMuted}
            onToggleMute={() => setIsMuted((prev) => !prev)}
            isFullscreen={isFullscreen}
            onToggleFullscreen={toggleFullscreen}
            opponentDisconnected={opponentDisconnected}
            opponentDisconnectMessage={opponentDisconnectMessage}
            roomRecoveryState={roomRecoveryState}
            roomRecoveryMessage={roomRecoveryMessage}
            onRetryRoomRecovery={retryRoomRecovery}
            winTarget={state?.config?.winningScore ?? 60}
            tournamentMatch={tournamentMatch}
            consumedTournamentGameOverMatchIdsRef={consumedTournamentGameOverMatchIdsRef}
            tournamentMyLabel={tournamentMyLabel}
            tournamentOpponentLabel={tournamentOpponentLabel}
            onTournamentViewBracket={() => navigateAfterTournamentMatch('bracket')}
            onTournamentViewFinalResult={() => navigateAfterTournamentMatch('result')}
            onTournamentReturnToHub={() => navigateAfterTournamentMatch('hub')}
            canUseRematch={canUseRematch}
            rematchRequested={rematchRequested}
            rematchWaitingText={rematchWaitingText}
            onRematch={requestRematch}
            onPostGame={handlePostGame}
            players={players}
            multiplayerRatingSummary={multiplayerRatingSummary}
            onOpenMultiplayerAnalyzer={openMultiplayerAnalyzer}
            handReveal={handReveal}
            handRevealAutoProgress={handRevealAutoProgress}
            flyingTiles={flyingTiles}
            showLeaveConfirm={showLeaveConfirm}
            onRequestLeaveConfirm={() => setShowLeaveConfirm(true)}
            onLeaveConfirmDismiss={() => setShowLeaveConfirm(false)}
            leaveModalIsTournament={Boolean(currentTournamentContext)}
            onConfirmLeaveMatch={() => {
              setShowLeaveConfirm(false);
              void abandonCurrentMatch();
            }}
            abandonedMatchNotice={abandonedMatchNotice}
            onAbandonedPrimary={() => {
              if (abandonedMatchNotice?.context === 'tournament' && abandonedMatchNotice.tournamentId) {
                setActiveTournamentId(abandonedMatchNotice.tournamentId);
                setTournamentSubView('bracket');
                setAppMode('tournament');
              } else {
                setAppMode('multiplayer');
              }
              setAbandonedMatchNotice(null);
            }}
            onAbandonedSecondary={() => {
              if (abandonedMatchNotice?.context === 'tournament') {
                setTournamentSubView('hub');
                setAppMode('tournament');
              } else {
                setAppMode('home');
              }
              setAbandonedMatchNotice(null);
            }}
            onAbandonedDismiss={() => setAbandonedMatchNotice(null)}
          />
        </Suspense>
      ) : null}

      {overlayPayload ? (
        <Suspense fallback={null}>
          <MatchFoundOverlay
            payload={overlayPayload}
            yourUsername={authProfile?.username ?? 'Guest'}
            onComplete={() => {
              setOverlayPayload(null);
            }}
          />
        </Suspense>
      ) : null}
    </>
  );
}
