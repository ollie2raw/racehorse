import type { Socket } from 'socket.io-client';
import { Button } from '../components/primitives';
import { ClaudePrimaryAction, ClaudeSectionLabel } from '../ui/claudeMode';
import type { FriendWithPresence } from '../social/socialApi';
import { usePrivateMatchLobbyFriends } from './usePrivateMatchLobbyFriends';
import { usePrivateMatchLobbyUiState } from './usePrivateMatchLobbyUiState';
import type { PrivateRoomCreateSettings } from './roomTransport';
import type { RoomPlayer, RoomRecoveryState } from './protocol';
import {
  challengeButtonLabel,
  isChallengeButtonDisabled,
  type FriendChallengeTarget,
  type SendFriendChallengeResult,
} from './friendChallenge';
import {
  buildPrivateLobbyFooterHint,
  getFriendChallengeUiState,
} from './privateMatchLobbyViewModel';
import type { PendingChallenge, PrivateMatchLobbyPhase } from './privateMatchLobbyScreenTypes';
import {
  IconBolt,
  IconController,
  IconCopy,
  IconDominoSm,
  IconShield,
  IconTarget,
  LockIcon,
} from './PrivateMatchLobbyIcons';

const MP_BLUE = '#3B82F6';

export interface PrivateMatchLobbyControlPanelProps {
  phase: PrivateMatchLobbyPhase;

  isConnecting: boolean;
  serverWaking: boolean;
  onConnect: () => void;

  roomCode: string;
  onRoomCodeChange: (code: string) => void;
  onCreateRoom: (settings: PrivateRoomCreateSettings) => void;
  onJoinRoom: () => void;
  pendingLobbyAction: null | 'create' | 'join';

  joinedRoom: string;
  players: RoomPlayer[];
  isRoomHost: boolean;
  onLeaveRoom: () => void;
  onStartGame: () => void;
  pendingStart: boolean;
  onCopyInviteLink: () => void;
  onCopyRoomCode?: () => void;

  roomRecoveryState: RoomRecoveryState;
  roomRecoveryMessage: string;
  onRetryRoomRecovery: () => void;

  winTarget?: number;
  isRatedEligible?: boolean;

  pendingChallenge?: PendingChallenge | null;
  pendingInviteActive: boolean;
  pendingInviteName: string | null;
  lobbyError?: string;

  socket?: Socket | null;
  sendFriendChallenge?: (target: FriendChallengeTarget) => Promise<SendFriendChallengeResult>;
}

export function PrivateMatchLobbyControlPanel({
  phase,
  isConnecting,
  serverWaking,
  onConnect,
  roomCode,
  onRoomCodeChange,
  onCreateRoom,
  onJoinRoom,
  pendingLobbyAction,
  joinedRoom,
  players,
  isRoomHost,
  onLeaveRoom,
  onStartGame,
  pendingStart,
  onCopyInviteLink,
  onCopyRoomCode,
  roomRecoveryState,
  roomRecoveryMessage,
  onRetryRoomRecovery,
  winTarget = 60,
  isRatedEligible = false,
  pendingChallenge = null,
  pendingInviteActive,
  pendingInviteName,
  lobbyError = '',
  socket = null,
  sendFriendChallenge,
}: PrivateMatchLobbyControlPanelProps) {
  const {
    lobbyTab,
    setLobbyTab,
    dealFormat,
    setDealFormat,
    copiedInvite,
    showFriendPicker,
    setShowFriendPicker,
    creatingUserId,
    setCreatingUserId,
    handleCopyInviteLink,
  } = usePrivateMatchLobbyUiState();

  const { friends, friendsLoading, friendsError } = usePrivateMatchLobbyFriends({
    showFriendPicker,
    isRatedEligible,
    socket: socket ?? null,
  });

  const handleSendChallenge = async (friend: FriendWithPresence) => {
    if (!sendFriendChallenge) return;
    setCreatingUserId(friend.userId);
    try {
      const res = await sendFriendChallenge({
        userId: friend.userId,
        username: friend.username,
        presenceStatus: friend.presence_status,
      });
      if (!res.ok) {
        const errMsg = res.error === 'unreachable' ? 'Friend is unreachable.' : 'Failed to send challenge.';
        alert(errMsg);
      }
    } catch {
      alert('An error occurred while sending the challenge.');
    } finally {
      setCreatingUserId(null);
    }
  };

  const footerHint = buildPrivateLobbyFooterHint({
    phase,
    lobbyError,
    isRoomHost,
    playersCount: players.length,
    pendingInviteActive,
    pendingInviteName,
  });

  const formatLabel = dealFormat === 14 ? '14-Tile' : '7-Tile';
  const hasRoom = phase === 'room' && Boolean(joinedRoom);

  // Section 1 — Match format. Mirrors Quick Match's eyebrow + heading + body,
  // then a single segmented control for the one real choice (7 vs 14 tiles).
  const formatSection = (
    <div className="pml-section">
      <div className="fritz-section-label">Format</div>
      <h2 className="pml-section-heading">Private 1v1</h2>
      {hasRoom ? (
        <span className="pml-format-lock">{formatLabel} · locked in</span>
      ) : (
        <>
          <p className="pml-section-body">
            A direct duel against a friend. No rating gate — anyone with the code can join.
          </p>
          <div className="pml-format-seg" role="group" aria-label="Tile count">
            <button
              type="button"
              className={`pml-format-seg__opt${dealFormat === 7 ? ' is-on' : ''}`}
              aria-pressed={dealFormat === 7}
              onClick={() => setDealFormat(7)}
            >
              7 Tiles
            </button>
            <button
              type="button"
              className={`pml-format-seg__opt${dealFormat === 14 ? ' is-on' : ''}`}
              aria-pressed={dealFormat === 14}
              onClick={() => setDealFormat(14)}
            >
              14 Tiles
            </button>
          </div>
        </>
      )}
    </div>
  );

  // Section 2 — Invite. Present from first render; before the room exists it is a
  // placeholder, after create the room code + invite actions fill in place (no
  // sliding top bar, no appended "4. Invite player" block).
  const inviteSection = (
    <div className="pml-section pml-section--invite">
      <div className="fritz-section-label">Invite</div>
      {!hasRoom ? (
        <>
          <h2 className="pml-section-heading">Create a room</h2>
          <p className="pml-section-body">
            Generate a code your friend enters on their device to join the lobby.
          </p>
          <div className="pml-invite-placeholder" aria-hidden>
            <LockIcon />
            <span>Your room code and invite links appear here once the lobby is live.</span>
          </div>
        </>
      ) : (
        <>
          <div className="pml-roomcode-cell">
            <div className="pml-roomcode-cell__text">
              <span className="pml-roomcode-cell__label">Room code</span>
              <span className="pml-roomcode-bar-code" aria-live="polite">
                {joinedRoom}
              </span>
            </div>
            {onCopyRoomCode ? (
              <button
                type="button"
                className="pml-roomcode-cell__copy"
                onClick={onCopyRoomCode}
                aria-label="Copy room code"
              >
                <IconCopy />
                Copy
              </button>
            ) : null}
          </div>

          {isRoomHost ? (
            <>
              <div className="pml-invite-actions">
                <Button
                  variant="outline"
                  type="button"
                  className="pml-invite-action"
                  onClick={() => handleCopyInviteLink(onCopyInviteLink)}
                >
                  {copiedInvite ? 'Copied!' : 'Copy invite link'}
                </Button>
                {isRatedEligible ? (
                  <Button
                    variant="outline"
                    type="button"
                    className="pml-invite-action"
                    onClick={() => setShowFriendPicker((prev) => !prev)}
                  >
                    {showFriendPicker ? 'Close friend list' : 'Invite a friend'}
                  </Button>
                ) : null}
              </div>

              {isRatedEligible && showFriendPicker ? (
                <div className="pml-friend-picker-dropdown">
                  {friendsLoading && (
                    <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)', padding: '6px' }}>
                      Loading online friends…
                    </div>
                  )}
                  {friendsError && (
                    <div style={{ fontSize: '12px', color: 'var(--accent-red)', padding: '6px' }}>
                      {friendsError}
                    </div>
                  )}
                  {!friendsLoading && !friendsError && friends.length === 0 && (
                    <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', padding: '6px' }}>
                      No friends online right now.
                    </div>
                  )}
                  {!friendsLoading &&
                    !friendsError &&
                    friends.map((friend) => {
                      const cState = getFriendChallengeUiState(
                        friend.username,
                        friend.userId,
                        creatingUserId,
                        pendingChallenge,
                      );
                      return (
                        <div key={friend.userId} className="pml-friend-row">
                          <span className="pml-friend-row__name">@{friend.username}</span>
                          <Button
                            variant="primary"
                            size="sm"
                            style={{ height: '28px', fontSize: '11px', padding: '0 10px' }}
                            disabled={isChallengeButtonDisabled(cState, friend.presence_status)}
                            onClick={() => handleSendChallenge(friend)}
                          >
                            {challengeButtonLabel(cState)}
                          </Button>
                        </div>
                      );
                    })}
                </div>
              ) : null}
            </>
          ) : null}

          <div className="pml-invite-leave-row">
            <button type="button" className="pml-invite-leave-room" onClick={onLeaveRoom}>
              ← Leave Room
            </button>
          </div>
        </>
      )}
    </div>
  );

  // Section 3 — Match summary. Same treatment as Quick Match's summary strip.
  const summarySection = (
    <div className="pml-section">
      <div className="fritz-section-label">Match Summary</div>
      <div className="fritz-summary-strip">
        <div className="fritz-summary-item">
          <div className="fritz-summary-icon" style={{ color: 'var(--tier-standard)' }}>
            <IconTarget />
          </div>
          <div>
            <div className="fritz-summary-value">First to {winTarget}</div>
            <div className="fritz-summary-key">Target</div>
          </div>
        </div>
        <div className="fritz-summary-divider" aria-hidden />
        <div className="fritz-summary-item">
          <div className="fritz-summary-icon" style={{ color: 'var(--tier-standard)' }}>
            <IconDominoSm format={dealFormat} />
          </div>
          <div>
            <div className="fritz-summary-value">{formatLabel}</div>
            <div className="fritz-summary-key">Format</div>
          </div>
        </div>
        <div className="fritz-summary-divider" aria-hidden />
        <div className="fritz-summary-item">
          <div
            className="fritz-summary-icon"
            style={{ color: isRatedEligible ? 'var(--tier-elite)' : 'var(--tier-standard)' }}
          >
            <IconShield />
          </div>
          <div>
            <div className="fritz-summary-value">{isRatedEligible ? 'Rated' : 'Unranked'}</div>
            <div className="fritz-summary-key">Rating</div>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="pvf-control-panel pml-mp-panel">
      {phase === 'lobby' ? (
        <div className="pml-tab-bar" role="tablist" aria-label="Lobby mode">
          <button
            type="button"
            role="tab"
            aria-selected={lobbyTab === 'create'}
            className={`pml-tab-seg${lobbyTab === 'create' ? ' is-active' : ''}`}
            onClick={() => setLobbyTab('create')}
          >
            Create lobby
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={lobbyTab === 'join'}
            className={`pml-tab-seg${lobbyTab === 'join' ? ' is-active' : ''}`}
            onClick={() => setLobbyTab('join')}
          >
            Join lobby
          </button>
        </div>
      ) : null}

      <div className="pml-panel-body">
        {phase === 'disconnected' ? (
          <div className="pml-preconnect-panel">
            <Button
              variant="tier-elite"
              size="lg"
              type="button"
              className="pml-start-btn"
              onClick={onConnect}
              disabled={isConnecting}
            >
              {isConnecting ? 'Connecting…' : 'Connect to Server ›'}
            </Button>
            <p className="pml-preconnect-hint">
              Connect to enable hosting and room joins. First load can take up to a minute.
            </p>
            <div>
              <div className="pml-section-label pml-section-label--eyebrow">Join with code</div>
              <div className="pml-join-inline">
                <div className="claude-mode-join-box">
                  <input
                    type="text"
                    placeholder="ROOM CODE"
                    value={roomCode}
                    onChange={(e) => onRoomCodeChange(e.target.value.toUpperCase())}
                    maxLength={6}
                    disabled
                  />
                  <button type="button" disabled>
                    Join
                  </button>
                </div>
              </div>
            </div>
            {serverWaking ? (
              <p className="pml-server-waking" role="status">
                <span className="pml-server-waking-dot" aria-hidden />
                Waking game server…
              </p>
            ) : null}
            <div className="pml-join-info-grid" role="list">
              <div className="pml-join-info-tile" role="listitem">
                <div className="pml-join-info-icon" aria-hidden>
                  <LockIcon />
                </div>
                <div className="pml-join-info-title">Private Room</div>
                <div className="pml-join-info-sub">Only players with the code can join</div>
              </div>
              <div className="pml-join-info-tile" role="listitem">
                <div className="pml-join-info-icon" aria-hidden>
                  <IconBolt />
                </div>
                <div className="pml-join-info-title">Instant Start</div>
                <div className="pml-join-info-sub">Game begins as soon as host starts</div>
              </div>
              <div className="pml-join-info-tile" role="listitem">
                <div className="pml-join-info-icon" aria-hidden>
                  <IconController />
                </div>
                <div className="pml-join-info-title">No Rating Impact</div>
                <div className="pml-join-info-sub">Private matches don&apos;t affect your rating</div>
              </div>
            </div>
          </div>
        ) : null}

        {phase === 'lobby' && lobbyTab === 'create' ? (
          <>
            {formatSection}
            {inviteSection}
            {summarySection}
          </>
        ) : null}

        {phase === 'lobby' && lobbyTab === 'join' ? (
          <div className="pml-join-panel">
            <div className="pml-join-inline">
              <ClaudeSectionLabel color="rgba(255,255,255,0.45)">Enter room code</ClaudeSectionLabel>
              <div className="claude-mode-join-box">
                <input
                  type="text"
                  placeholder="ROOM CODE"
                  value={roomCode}
                  onChange={(e) => onRoomCodeChange(e.target.value.toUpperCase())}
                  maxLength={6}
                  disabled={pendingLobbyAction === 'create' || pendingLobbyAction === 'join'}
                />
                <button
                  type="button"
                  onClick={onJoinRoom}
                  disabled={pendingLobbyAction === 'create' || pendingLobbyAction === 'join'}
                >
                  {pendingLobbyAction === 'join' ? 'Joining…' : 'Join'}
                </button>
              </div>
            </div>

            <div className="pml-join-info-grid" role="list">
              <div className="pml-join-info-tile" role="listitem">
                <div className="pml-join-info-icon" aria-hidden>
                  <LockIcon />
                </div>
                <div className="pml-join-info-title">Private Room</div>
                <div className="pml-join-info-sub">Only players with the code can join</div>
              </div>
              <div className="pml-join-info-tile" role="listitem">
                <div className="pml-join-info-icon" aria-hidden>
                  <IconBolt />
                </div>
                <div className="pml-join-info-title">Instant Start</div>
                <div className="pml-join-info-sub">Game begins as soon as host starts</div>
              </div>
              <div className="pml-join-info-tile" role="listitem">
                <div className="pml-join-info-icon" aria-hidden>
                  <IconController />
                </div>
                <div className="pml-join-info-title">No Rating Impact</div>
                <div className="pml-join-info-sub">Private matches don&apos;t affect your rating</div>
              </div>
            </div>

            <div className="pml-join-recent">
              <div className="pml-section-label">Recent rooms</div>
              <div className="pml-join-recent-empty">
                <div className="pml-join-recent-icon" aria-hidden>
                  <LockIcon />
                </div>
                <div className="pml-join-recent-title">No recent rooms</div>
                <div className="pml-join-recent-sub">Codes you&apos;ve joined will appear here.</div>
              </div>
            </div>
          </div>
        ) : null}

        {phase === 'room' ? (
          <>
            {formatSection}
            {inviteSection}
            {summarySection}

            {roomRecoveryState !== 'idle' ? (
              <div className="pml-muted-card">
                <div className="pml-player-card__title">
                  {roomRecoveryState === 'reconnecting'
                    ? 'Reconnecting…'
                    : roomRecoveryState === 'resyncing'
                      ? 'Syncing room…'
                      : 'Reconnect failed'}
                </div>
                <div className="pml-player-card__meta" style={{ marginTop: 6 }}>
                  {roomRecoveryMessage || 'Restoring your room session.'}
                </div>
              </div>
            ) : null}
            {roomRecoveryState === 'failed' ? (
              <ClaudePrimaryAction
                accent={MP_BLUE}
                title="Retry reconnect"
                meta="Restore this room session"
                onClick={onRetryRoomRecovery}
              />
            ) : null}
          </>
        ) : null}
      </div>

      <div className="pml-panel-footer">
        {phase === 'lobby' && lobbyTab === 'join' ? (
          <p className="pml-footer-hint" style={{ marginTop: 0 }}>
            Enter your friend&apos;s six-character code, then tap Join.
          </p>
        ) : null}

        {phase === 'lobby' && lobbyTab === 'create' ? (
          <>
            <Button
              variant="tier-elite"
              size="lg"
              type="button"
              className="pml-start-btn"
              onClick={() => onCreateRoom({ dealFormat, winTarget })}
              disabled={pendingLobbyAction === 'create' || pendingLobbyAction === 'join'}
            >
              {pendingLobbyAction === 'create' ? 'Creating lobby…' : 'Create lobby'}
            </Button>
            <p className="pml-footer-hint pml-footer-hint--create">
              Waiting for opponent to join…
            </p>
          </>
        ) : null}

        {phase === 'room' ? (
          <>
            {players.length === 2 && isRoomHost ? (
              <Button
                variant="tier-elite"
                size="lg"
                type="button"
                className="pml-start-btn"
                onClick={onStartGame}
                disabled={pendingStart}
              >
                {pendingStart ? 'Starting…' : 'Start Match ›'}
              </Button>
            ) : null}
            {players.length === 2 && !isRoomHost ? (
              <Button variant="outline" size="lg" type="button" className="pml-start-btn" disabled>
                Waiting for host…
              </Button>
            ) : null}
            {players.length < 2 && isRoomHost ? (
              <Button
                variant="tier-elite"
                size="lg"
                type="button"
                className="pml-start-btn pml-start-btn--waiting"
                disabled
              >
                Waiting for opponent…
              </Button>
            ) : null}
            {footerHint ? <p className="pml-footer-hint">{footerHint}</p> : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
