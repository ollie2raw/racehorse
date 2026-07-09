import { useMemo } from 'react';
import { GlobalNav } from '../components';
import { MultiplayerTopBar } from '../matchmaking/MultiplayerTopBar';
import { useSyncNow } from '../ui/useSyncNow';
import '../screens/RacehorseHomeArt.css';
import './privateMatchLobby.css';
import '../ui/claudeMode.css';
import { MultiplayerHubFeatureStrip } from './MultiplayerHubFeatureStrip';
import { MultiplayerTwoColumnPvLayout } from './MultiplayerTwoColumnPvLayout';
import type { PrivateMatchLobbyScreenProps } from './privateMatchLobbyScreenTypes';
import {
  buildPendingInviteState,
  buildPrivateLobbyDuelViewModel,
} from './privateMatchLobbyViewModel';
import { usePrivateMatchLobbyGuestProfile } from './usePrivateMatchLobbyGuestProfile';
import { PrivateMatchLobbyMatchupView } from './PrivateMatchLobbyMatchupView';
import { PrivateMatchLobbyControlPanel } from './PrivateMatchLobbyControlPanel';

export type { PrivateMatchLobbyScreenProps } from './privateMatchLobbyScreenTypes';

export default function PrivateMatchLobbyScreen({
  phase,
  onNavigate,
  onOpenAuth,
  onOpenAccount,
  onBackHome,
  isConnecting,
  serverWaking,
  serverUrl: _serverUrl,
  onConnect,
  roomCode,
  onRoomCodeChange,
  onCreateRoom,
  onJoinRoom,
  pendingLobbyAction,
  joinedRoom,
  players,
  you,
  isRoomHost,
  onLeaveRoom,
  onStartGame,
  pendingStart,
  onCopyInviteLink,
  onCopyRoomCode,
  roomRecoveryState,
  roomRecoveryMessage,
  onRetryRoomRecovery,
  myRating,
  myUsername = null,
  hostWinStreak,
  roomChatFeed: _roomChatFeed,
  onSendRoomChat: _onSendRoomChat,
  winTarget = 60,
  isRatedEligible = false,
  onOpenQuickMatch,
  socket = null,
  pendingChallenge = null,
  lobbyError = '',
  sendFriendChallenge,
}: PrivateMatchLobbyScreenProps) {
  const duelViewModel = useMemo(
    () =>
      buildPrivateLobbyDuelViewModel({
        phase,
        players,
        you,
        myUsername,
        myRating,
      }),
    [phase, players, you, myUsername, myRating],
  );

  const roomGuest = players[1];
  const guestProfile = usePrivateMatchLobbyGuestProfile({
    guestPresent: duelViewModel.guestPresent,
    roomGuestUserId: roomGuest?.userId,
    roomGuestUsername: roomGuest?.username,
  });

  const inviteExpiryTick = Boolean(pendingChallenge && !duelViewModel.guestPresent);
  const now = useSyncNow(1000, inviteExpiryTick);
  const { pendingInviteActive, pendingInviteName } = buildPendingInviteState(
    pendingChallenge,
    duelViewModel.guestPresent,
    now,
  );

  const onBackClick = onBackHome;

  return (
    <div className="pml-root pml-mp-bridge multiplayer-hub">
      <div className="home-bg" aria-hidden>
        <div className="home-bg__halo" />
        <div className="home-bg__domino home-bg__domino--tl" />
        <div className="home-bg__domino home-bg__domino--tr" />
        <div className="home-bg__line home-bg__line--1" />
        <div className="home-bg__line home-bg__line--2" />
        <div className="home-bg__line home-bg__line--3" />
        <div className="home-bg__texture" />
      </div>

      <GlobalNav
        currentMode="multiplayer"
        onNavigate={onNavigate}
        onOpenAuth={onOpenAuth}
        onOpenAccount={onOpenAccount}
        activeColor="var(--tier-standard)"
      />

      <div className="mp-hub-shell mp-hub-shell--pvf">
        <MultiplayerTopBar
          activeTab="private"
          onSelectQuick={() => onOpenQuickMatch?.()}
          onSelectPrivate={() => {}}
          privateTabLocksQuick={phase === 'room'}
          onBackMultiplayer={onBackClick}
          backAriaLabel="Back to home"
          fetchCounts={phase !== 'disconnected'}
          socket={socket}
        />

        <MultiplayerTwoColumnPvLayout
          leftColClassName={`pml-left--stack${phase === 'room' ? ' pml-left--room' : ''}`}
          left={
            <>
              <div className="pvf-header">
                <div className="pvf-label">MULTIPLAYER</div>
                <h1 className="pvf-title">Private Match</h1>
                <p className="pvf-subtitle mp-hub-subtitle">
                  <span className="mp-hub-subtitle-line">
                    Invite-only 1v1 dominos. Host a room, share code or link, and your guest may join
                  </span>
                  <span className="mp-hub-subtitle-line">anytime. Start when ready.</span>
                </p>
              </div>

              <PrivateMatchLobbyMatchupView
                phase={phase}
                duelViewModel={duelViewModel}
                hostWinStreak={hostWinStreak}
                guestProfile={guestProfile}
                pendingInviteActive={pendingInviteActive}
                pendingInviteName={pendingInviteName}
                pendingChallenge={pendingChallenge}
              />

              <MultiplayerHubFeatureStrip variant="private" />
            </>
          }
          right={
            <PrivateMatchLobbyControlPanel
              phase={phase}
              isConnecting={isConnecting}
              serverWaking={serverWaking}
              onConnect={onConnect}
              roomCode={roomCode}
              onRoomCodeChange={onRoomCodeChange}
              onCreateRoom={onCreateRoom}
              onJoinRoom={onJoinRoom}
              pendingLobbyAction={pendingLobbyAction}
              joinedRoom={joinedRoom}
              players={players}
              isRoomHost={isRoomHost}
              onLeaveRoom={onLeaveRoom}
              onStartGame={onStartGame}
              pendingStart={pendingStart}
              onCopyInviteLink={onCopyInviteLink}
              onCopyRoomCode={onCopyRoomCode}
              roomRecoveryState={roomRecoveryState}
              roomRecoveryMessage={roomRecoveryMessage}
              onRetryRoomRecovery={onRetryRoomRecovery}
              winTarget={winTarget}
              isRatedEligible={isRatedEligible}
              pendingChallenge={pendingChallenge}
              pendingInviteActive={pendingInviteActive}
              pendingInviteName={pendingInviteName}
              lobbyError={lobbyError}
              socket={socket}
              sendFriendChallenge={sendFriendChallenge}
            />
          }
        />
      </div>
    </div>
  );
}
