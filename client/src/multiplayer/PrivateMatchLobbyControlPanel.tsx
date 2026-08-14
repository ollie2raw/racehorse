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
  IconChevronDown,
  IconClock,
  IconController,
  IconCopy,
  IconDominoSm,
  IconEye,
  IconKey,
  IconShield,
  IconSliders,
  IconTarget,
  IconUsers,
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

function renderChoiceBadge(active: boolean, locked: boolean) {
  if (!active) return null;
  if (locked) {
    return (
      <span className="pml-choice-locked" aria-hidden>
        ✓ Locked
      </span>
    );
  }
  return (
    <span className="pml-choice-check" aria-hidden>
      ✓
    </span>
  );
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
    privacy,
    setPrivacy,
    timedTurnsUi,
    setTimedTurnsUi,
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

  const matchSettingsStrip = (
    <div className="pml-settings-strip" role="group" aria-label="Match settings">
      <button type="button" className="pml-mini-tile" disabled>
        <span className="pml-mini-tile-icon" aria-hidden>
          <IconTarget />
        </span>
        <span className="pml-mini-tile-body">
          <span className="pml-mini-tile-label">Win target</span>
          <span className="pml-mini-tile-value">First to {winTarget}</span>
        </span>
        <span className="pml-mini-tile-chev" aria-hidden>
          <IconChevronDown />
        </span>
      </button>
      <button
        type="button"
        className="pml-mini-tile"
        onClick={() => setTimedTurnsUi((v) => (v === 'untimed' ? '30s' : 'untimed'))}
        title="Coming soon"
        aria-label="Timed turns — coming soon"
      >
        <span className="pml-mini-tile-icon" aria-hidden>
          <IconClock />
        </span>
        <span className="pml-mini-tile-body">
          <span className="pml-mini-tile-label">Timed turns</span>
          <span className="pml-mini-tile-value">{timedTurnsUi === 'untimed' ? 'Untimed' : '30s / turn'}</span>
        </span>
        <span className="pml-mini-tile-chev" aria-hidden>
          <IconChevronDown />
        </span>
      </button>
      <div className="pml-mini-tile pml-mini-tile--static">
        <span className="pml-mini-tile-icon" aria-hidden>
          <IconShield />
        </span>
        <span className="pml-mini-tile-body">
          <span className="pml-mini-tile-label">Rated match</span>
          <span className="pml-mini-tile-value">{isRatedEligible ? 'Rated' : 'Unrated'}</span>
        </span>
        <span
          className={`pml-rated-badge${isRatedEligible ? ' is-rated' : ' is-unrated'}`}
          aria-hidden
        >
          {isRatedEligible ? 'Rated' : 'Unrated'}
        </span>
      </div>
      <div className="pml-mini-tile pml-mini-tile--static">
        <span className="pml-mini-tile-icon" aria-hidden>
          <IconEye />
        </span>
        <span className="pml-mini-tile-body">
          <span className="pml-mini-tile-label">Spectators</span>
          <span className="pml-mini-tile-value pml-mini-tile-value--muted">Coming soon</span>
        </span>
      </div>
    </div>
  );

  const renderFormatChoices = (locked: boolean) => (
    <div className={`pml-tile-row${locked ? ' pml-tile-row--locked' : ''}`}>
      <button
        type="button"
        className={`pml-choice${dealFormat === 7 ? ' is-active' : ''}${locked && dealFormat === 7 ? ' is-locked' : ''}`}
        onClick={() => !locked && setDealFormat(7)}
        disabled={locked}
      >
        {renderChoiceBadge(dealFormat === 7, locked)}
        <div className="pml-choice-icon" aria-hidden>
          <IconDominoSm format={7} />
        </div>
        <div className="pml-choice-title">7 Tiles</div>
        <div className="pml-choice-sub">Classic 7-tile format</div>
      </button>
      <button
        type="button"
        className={`pml-choice${dealFormat === 14 ? ' is-active' : ''}${locked && dealFormat === 14 ? ' is-locked' : ''}`}
        onClick={() => !locked && setDealFormat(14)}
        disabled={locked}
      >
        {renderChoiceBadge(dealFormat === 14, locked)}
        <div className="pml-choice-icon" aria-hidden>
          <IconDominoSm format={14} />
        </div>
        <div className="pml-choice-title">14 Tiles</div>
        <div className="pml-choice-sub">Extended 14-tile format</div>
      </button>
      <button type="button" className="pml-choice is-disabled" disabled>
        <div className="pml-choice-icon" aria-hidden>
          <IconSliders />
        </div>
        <div className="pml-choice-title">Custom Rules</div>
        <div className="pml-choice-sub">Coming soon</div>
      </button>
    </div>
  );

  const renderPrivacyChoices = (locked: boolean) => (
    <div className={`pml-tile-row${locked ? ' pml-tile-row--locked' : ''}`}>
      <button
        type="button"
        className={`pml-choice${privacy === 'code' ? ' is-active' : ''}${locked && privacy === 'code' ? ' is-locked' : ''}`}
        onClick={() => !locked && setPrivacy('code')}
        disabled={locked}
      >
        {renderChoiceBadge(privacy === 'code', locked)}
        <div className="pml-choice-icon" aria-hidden>
          <IconKey />
        </div>
        <div className="pml-choice-title">Room Code</div>
        <div className="pml-choice-sub">Join via six-character code</div>
      </button>
      <button
        type="button"
        className={`pml-choice${privacy === 'invite' ? ' is-active' : ''}${locked && privacy === 'invite' ? ' is-locked' : ''}`}
        onClick={() => !locked && setPrivacy('invite')}
        disabled={locked}
      >
        {renderChoiceBadge(privacy === 'invite', locked)}
        <div className="pml-choice-icon" aria-hidden>
          <LockIcon />
        </div>
        <div className="pml-choice-title">Invite Link</div>
        <div className="pml-choice-sub">Share a private invite link</div>
      </button>
      <button type="button" className="pml-choice is-disabled" disabled>
        <div className="pml-choice-icon" aria-hidden>
          <IconUsers />
        </div>
        <div className="pml-choice-title">Friends Only</div>
        <div className="pml-choice-sub">Coming soon</div>
      </button>
    </div>
  );

  const invitePlayerBlock = isRoomHost || phase === 'room' ? (
    <div className="pml-section-invite-block">
      {isRoomHost && (
        <>
          <div className="pml-section-label">4. Invite player</div>
          <div className="pml-invite-actions-strip">
            <div className="pml-invite-cell pml-invite-cell--copy">
              <Button
                variant="outline"
                type="button"
                className="pml-invite-copy-full"
                onClick={() => handleCopyInviteLink(onCopyInviteLink)}
              >
                {copiedInvite ? 'Copied!' : 'Copy invite link'}
              </Button>
            </div>
            {isRatedEligible && (
              <Button
                variant="outline"
                type="button"
                className="pml-invite-copy-full"
                onClick={() => setShowFriendPicker((prev) => !prev)}
              >
                {showFriendPicker ? 'Close Friend List' : 'Invite a Friend'}
              </Button>
            )}
          </div>

          {isRatedEligible && showFriendPicker && (
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
          )}
        </>
      )}
      {phase === 'room' ? (
        <div className="pml-invite-leave-row">
          <button type="button" className="pml-invite-leave-room" onClick={onLeaveRoom}>
            ← Leave Room
          </button>
        </div>
      ) : null}
    </div>
  ) : null;

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
      {phase === 'room' && joinedRoom ? (
        <div className="pml-roomcode-bar" aria-label="Your room code">
          <div className="pml-roomcode-bar-inner">
            <span className="pml-roomcode-bar-label">Your room code</span>
            <div className="pml-roomcode-bar-row">
              <span className="pml-roomcode-bar-code" aria-live="polite">
                {joinedRoom}
              </span>
              {onCopyRoomCode ? (
                <button
                  type="button"
                  className="pml-roomcode-bar-button"
                  onClick={onCopyRoomCode}
                  aria-label="Copy room code"
                >
                  <IconCopy />
                </button>
              ) : null}
            </div>
          </div>
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
            <div>
              <div className="pml-section-label">1. Match format</div>
              {renderFormatChoices(false)}
            </div>

            <div>
              <div className="pml-section-label">2. Lobby privacy</div>
              {renderPrivacyChoices(false)}
            </div>

            <div>
              <div className="pml-section-label">3. Match settings</div>
              {matchSettingsStrip}
            </div>

            {invitePlayerBlock}
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
            <div>
              <div className="pml-section-label">1. Match format</div>
              {renderFormatChoices(true)}
            </div>

            <div>
              <div className="pml-section-label">2. Lobby privacy</div>
              {renderPrivacyChoices(true)}
            </div>

            <div>
              <div className="pml-section-label">3. Match settings</div>
              {matchSettingsStrip}
            </div>

            {invitePlayerBlock}

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