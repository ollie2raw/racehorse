import { useEffect, useState } from 'react';
import type { AppMode } from '../types';
import type { Socket } from 'socket.io-client';
import { GlobalNav } from '../components';
import { MultiplayerTopBar } from '../matchmaking/MultiplayerTopBar';
import { Button } from '../components/primitives';
import type { RoomChatEvent, RoomEmoteEvent } from '../components/RoomReactions';
import '../screens/RacehorseHomeArt.css';
import './privateMatchLobby.css';
import '../ui/claudeMode.css';
import { ClaudePrimaryAction, ClaudeSectionLabel } from '../ui/claudeMode';
import { fetchRankingProfile } from '../stats/statsApi';
import { supabase } from '../lib/supabase';
import { ArenaRings } from './ArenaRings';
import { IconFlame, IconPlus, IconUserBust } from './MultiplayerDuelIcons';
import { MultiplayerHubFeatureStrip } from './MultiplayerHubFeatureStrip';
import { MultiplayerTwoColumnPvLayout } from './MultiplayerTwoColumnPvLayout';

/** Matches `App.tsx` `RoomPlayer` shape. */
export type PrivateMatchLobbyPlayer = {
  id: string;
  username: string;
  userId: string | null;
};

type RoomRecoveryState = 'idle' | 'reconnecting' | 'resyncing' | 'failed';

const MP_BLUE = '#3B82F6';

type PrivateMatchLobbyPhase = 'disconnected' | 'lobby' | 'room';

export interface PrivateMatchLobbyScreenProps {
  phase: PrivateMatchLobbyPhase;
  onNavigate?: (mode: AppMode) => void;
  onOpenAuth?: () => void;
  onOpenAccount?: () => void;
  onBackHome: () => void;

  isConnecting: boolean;
  serverWaking: boolean;
  serverUrl: string;
  onConnect: () => void;

  roomCode: string;
  onRoomCodeChange: (code: string) => void;
  onCreateRoom: () => void;
  onJoinRoom: () => void;
  pendingLobbyAction: null | 'create' | 'join';

  joinedRoom: string;
  players: PrivateMatchLobbyPlayer[];
  you: string | null;
  isRoomHost: boolean;
  onLeaveRoom: () => void;
  onStartGame: () => void;
  pendingStart: boolean;
  onCopyInviteLink: () => void;
  onCopyRoomCode?: () => void;
  roomRecoveryState: RoomRecoveryState;
  roomRecoveryMessage: string;
  onRetryRoomRecovery: () => void;

  myRating?: number | null;
  /** Display name for lobby preview (no @ prefix in value). */
  myUsername?: string | null;
  /** Optional; only shown when set. */
  hostWinStreak?: number | null;
  roomChatFeed?: Array<RoomChatEvent | RoomEmoteEvent>;
  onSendRoomChat?: (text: string) => void;
  winTarget?: number;
  /** When set, the Quick Match sub-tab in the unified toolbar becomes clickable. */
  onOpenQuickMatch?: () => void;
  /** When connected, used for multiplayer top bar live counts. */
  socket?: Socket | null;
  /** Outbound friend challenge waiting for opponent to join the lobby. */
  pendingChallenge?: {
    friendUsername: string;
    matchSummary: string;
    expiresAt: number;
  } | null;
}

function LockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function IconCopy() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function IconChevronDown() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function IconTarget() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconClock() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconShield() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6l8-3z" strokeLinejoin="round" />
    </svg>
  );
}

function IconEye() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}


function IconDominoSm({ format }: { format: 7 | 14 }) {
  if (format === 7) {
    return (
      <svg width="18" height="20" viewBox="0 0 24 32" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <rect x="4" y="2" width="16" height="28" rx="2" />
        <line x1="4" y1="16" x2="20" y2="16" />
        <circle cx="9" cy="9" r="1.4" fill="currentColor" stroke="none" />
        <circle cx="15" cy="9" r="1.4" fill="currentColor" stroke="none" />
        <circle cx="12" cy="22" r="1.4" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  return (
    <svg width="22" height="20" viewBox="0 0 30 32" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <rect x="1" y="1" width="12" height="30" rx="2" />
      <line x1="1" y1="16" x2="13" y2="16" />
      <circle cx="7" cy="9" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="7" cy="23" r="1.4" fill="currentColor" stroke="none" />
      <rect x="17" y="1" width="12" height="30" rx="2" />
      <line x1="17" y1="16" x2="29" y2="16" />
      <circle cx="20" cy="7" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="26" cy="11" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="20" cy="21" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="26" cy="25" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconSliders() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="17" x2="20" y2="17" />
      <circle cx="9" cy="7" r="2.2" fill="var(--bg-obsidian)" />
      <circle cx="15" cy="17" r="2.2" fill="var(--bg-obsidian)" />
    </svg>
  );
}

function IconUsers() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="9" cy="9" r="3" />
      <circle cx="17" cy="10" r="2.4" />
      <path d="M3 19c0-3 3-5 6-5s6 2 6 5" />
      <path d="M15 19c0-2 2-3.5 4-3.5s2 0 2 0" />
    </svg>
  );
}

function IconBolt() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
      <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" />
    </svg>
  );
}

function IconController() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M7 8h10a4 4 0 0 1 4 4v3a3 3 0 0 1-5.2 2L14 15h-4l-1.8 2A3 3 0 0 1 3 15v-3a4 4 0 0 1 4-4z" />
      <line x1="8" y1="11" x2="8" y2="13" />
      <line x1="7" y1="12" x2="9" y2="12" />
      <circle cx="16" cy="12" r="0.8" fill="currentColor" />
    </svg>
  );
}

function IconKey() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="8" cy="14" r="4" />
      <path d="M11 11l9-9M16 6l3 3" strokeLinecap="round" />
    </svg>
  );
}

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
  onOpenQuickMatch,
  socket = null,
  pendingChallenge = null,
}: PrivateMatchLobbyScreenProps) {
  const [lobbyTab, setLobbyTab] = useState<'create' | 'join'>('create');
  const [dealFormat, setDealFormat] = useState<7 | 14>(7);
  const [privacy, setPrivacy] = useState<'invite' | 'code'>('code');
  const [timedTurnsUi, setTimedTurnsUi] = useState<'untimed' | '30s'>('untimed');
  const ratedPreview = true;
  const spectatorsPreview = false;

  const [guestRankedLoading, setGuestRankedLoading] = useState(false);
  const [guestRating, setGuestRating] = useState<number | null>(null);
  const [guestWinStreak, setGuestWinStreak] = useState<number | null>(null);

  const onBackClick = phase === 'room' ? onLeaveRoom : onBackHome;

  const inRoom = phase === 'room';
  const roomHost = players[0];
  const roomGuest = players[1];

  const leftDisplayName =
    inRoom && roomHost?.username
      ? `@${roomHost.username}`
      : myUsername
        ? `@${myUsername}`
        : 'You';

  const leftPlainName = (() => {
    const u = inRoom ? roomHost?.username : myUsername;
    return (u ?? 'You').replace(/^@+/, '').trim();
  })();

  const leftCardIsCurrentUser =
    !inRoom || Boolean(roomHost && you && roomHost.id === you);

  const leftRatingStr =
    inRoom && roomHost && you && roomHost.id === you && myRating != null
      ? myRating.toLocaleString()
      : !inRoom && myRating != null
        ? myRating.toLocaleString()
        : '—';

  const guestPresent = inRoom && !!roomGuest?.username;
  const guestDisplayName =
    guestPresent && roomGuest ? roomGuest.username.replace(/^@+/, '') : null;
  const pendingInviteActive = Boolean(
    pendingChallenge && pendingChallenge.expiresAt > Date.now() && !guestPresent,
  );
  const pendingInviteName = pendingInviteActive
    ? pendingChallenge!.friendUsername.replace(/^@+/, '')
    : null;

  useEffect(() => {
    if (!guestPresent || !roomGuest) {
      setGuestRankedLoading(false);
      setGuestRating(null);
      setGuestWinStreak(null);
      return;
    }

    const uname = roomGuest.username.replace(/^@+/, '').trim();
    const isPlaceholderGuest = !uname || uname.toLowerCase() === 'guest';

    let cancelled = false;
    setGuestRankedLoading(true);
    setGuestRating(null);
    setGuestWinStreak(null);

    void (async () => {
      let userId: string | null = roomGuest.userId;

      if (!userId && supabase && !isPlaceholderGuest) {
        const { data, error } = await supabase.from('profiles').select('id').eq('username', uname).maybeSingle();
        if (!cancelled && !error && data?.id && typeof data.id === 'string') {
          userId = data.id;
        }
      }

      if (!userId) {
        if (!cancelled) {
          setGuestRankedLoading(false);
          setGuestRating(null);
          setGuestWinStreak(null);
        }
        return;
      }

      const { data, error } = await fetchRankingProfile(userId);
      if (cancelled) return;
      setGuestRankedLoading(false);
      if (error || !data) {
        setGuestRating(null);
        setGuestWinStreak(null);
        return;
      }
      setGuestRating(Math.round(Number(data.glicko_rating)));
      setGuestWinStreak(data.currentWinStreak);
    })();

    return () => {
      cancelled = true;
    };
  }, [guestPresent, roomGuest?.userId, roomGuest?.username]);

  const footerHint =
    phase === 'room' && players.length < 2 && pendingInviteActive && pendingInviteName
      ? `Waiting for @${pendingInviteName} to accept your challenge…`
      : phase === 'room' && players.length < 2
        ? 'Waiting for opponent to join…'
        : phase === 'room' && players.length === 2 && !isRoomHost
          ? 'Waiting for host to start the match…'
          : null;

  const formatLabel = dealFormat === 7 ? '7 Tiles' : '14 Tiles';

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
          <span className="pml-mini-tile-value">{ratedPreview ? 'On' : 'Off'}</span>
        </span>
        <div className={`pml-toggle pml-toggle--sm${ratedPreview ? ' is-on' : ''}`} aria-hidden />
      </div>
      <div className="pml-mini-tile pml-mini-tile--static">
        <span className="pml-mini-tile-icon" aria-hidden>
          <IconEye />
        </span>
        <span className="pml-mini-tile-body">
          <span className="pml-mini-tile-label">Spectators</span>
          <span className="pml-mini-tile-value">{spectatorsPreview ? 'Allowed' : 'Off'}</span>
        </span>
        <div className={`pml-toggle pml-toggle--sm${spectatorsPreview ? ' is-on' : ''}`} aria-hidden />
      </div>
    </div>
  );

  const renderChoiceBadge = (active: boolean, locked: boolean) => {
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
  };

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

  const invitePlayerBlock = (
    <div className="pml-section-invite-block">
      <div className="pml-section-label">4. Invite player</div>
      <div className="pml-invite-actions-strip">
        <div className="pml-invite-cell pml-invite-cell--compound">
          <div className="pml-invite-row">
            <input
              className="pml-invite-input"
              placeholder="Enter username or email…"
              disabled
              aria-disabled="true"
            />
            <Button variant="secondary" size="sm" type="button" disabled className="pml-invite-inline-btn">
              Invite
            </Button>
          </div>
        </div>
        <div className="pml-invite-cell pml-invite-cell--copy">
          <Button variant="outline" type="button" className="pml-invite-copy-full" onClick={onCopyInviteLink}>
            Copy invite link
          </Button>
        </div>
      </div>
      {phase === 'room' ? (
        <div className="pml-invite-leave-row">
          <button type="button" className="pml-invite-leave-room" onClick={onLeaveRoom}>
            ← Leave Room
          </button>
        </div>
      ) : null}
    </div>
  );

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
          backAriaLabel={phase === 'room' ? 'Leave room' : 'Back to home'}
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

          <div
            className={`pml-room-stage${phase === 'room' ? ' pml-room-stage--shrink' : ''}`}
          >
            <div className="pml-room-stage__scroll">
              <div className="pml-matchup">
              <ArenaRings />
              <div className="pml-duel-card pml-duel-card--host">
                <div className="pml-duel-avatar-frame">
                  <div className="pml-duel-avatar" aria-hidden>
                    <IconUserBust gradientId="pml-bust-host" />
                  </div>
                </div>
                <div className="pml-duel-name">
                  <span className="pml-duel-name-text">{leftPlainName}</span>
                </div>
                <div
                  className="pml-duel-rating"
                  aria-label={leftRatingStr !== '—' ? `Rating ${leftRatingStr}` : undefined}
                >
                  {leftRatingStr !== '—' ? (
                    <>
                      <span className="pml-duel-star" aria-hidden>
                        ★
                      </span>
                      <span className="pml-duel-rating-num">{leftRatingStr}</span>
                    </>
                  ) : (
                    <span className="pml-duel-rating-num">—</span>
                  )}
                </div>
                <div
                  className={`pml-duel-streak-wrap${
                    leftCardIsCurrentUser && hostWinStreak != null && hostWinStreak > 0 ? '' : ' pml-duel-spacer'
                  }`}
                  aria-hidden={!(leftCardIsCurrentUser && hostWinStreak != null && hostWinStreak > 0)}
                >
                  {leftCardIsCurrentUser && hostWinStreak != null && hostWinStreak > 0 ? (
                    <div className="pml-duel-streak">
                      <span className="pml-duel-streak-flame" aria-hidden>
                        <IconFlame />
                      </span>
                      <span>Win Streak: {hostWinStreak}</span>
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="pml-vs-column">
                <span className="pml-vs-text">VS</span>
              </div>
              <div
                className={`pml-duel-card pml-duel-card--guest${guestPresent ? '' : ' pml-duel-card--awaiting'}`}
              >
                {guestPresent ? (
                  <>
                    <div className="pml-duel-avatar-frame">
                      <div className="pml-duel-avatar" aria-hidden>
                        <IconUserBust gradientId="pml-bust-guest" />
                      </div>
                    </div>
                    <div className="pml-duel-name">
                      <span className="pml-duel-name-text">{guestDisplayName}</span>
                    </div>
                    <div
                      className="pml-duel-rating"
                      aria-label={
                        !guestRankedLoading && guestRating != null
                          ? `Rating ${guestRating.toLocaleString()}`
                          : undefined
                      }
                    >
                      {guestRankedLoading ? (
                        <span className="pml-duel-rating-num">—</span>
                      ) : guestRating != null ? (
                        <>
                          <span className="pml-duel-star" aria-hidden>
                            ★
                          </span>
                          <span className="pml-duel-rating-num">{guestRating.toLocaleString()}</span>
                        </>
                      ) : (
                        <span className="pml-duel-rating-num">—</span>
                      )}
                    </div>
                    <div
                      className={`pml-duel-streak-wrap${
                        !guestRankedLoading && guestWinStreak != null && guestWinStreak > 0 ? '' : ' pml-duel-spacer'
                      }`}
                      aria-hidden={!(!guestRankedLoading && guestWinStreak != null && guestWinStreak > 0)}
                    >
                      {!guestRankedLoading && guestWinStreak != null && guestWinStreak > 0 ? (
                        <div className="pml-duel-streak">
                          <span className="pml-duel-streak-flame" aria-hidden>
                            <IconFlame />
                          </span>
                          <span>Win Streak: {guestWinStreak}</span>
                        </div>
                      ) : null}
                    </div>
                  </>
                ) : pendingInviteActive && pendingInviteName ? (
                  <>
                    <div className="pml-duel-avatar-frame">
                      <div className="pml-duel-avatar pml-duel-avatar--pending" aria-hidden>
                        {pendingInviteName.slice(0, 2).toUpperCase()}
                      </div>
                    </div>
                    <div className="pml-duel-name pml-duel-name--awaiting">
                      <span className="pml-duel-name-text">@{pendingInviteName}</span>
                      <span className="pml-duel-awaiting-hint pml-duel-awaiting-hint--challenge">
                        Invite sent · waiting to join
                      </span>
                    </div>
                    <div className="pml-duel-rating pml-duel-spacer" aria-hidden />
                    <div className="pml-duel-streak-wrap">
                      <span className="pml-duel-challenge-pill">{pendingChallenge?.matchSummary}</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="pml-duel-avatar-frame">
                      <div className="pml-duel-avatar pml-duel-avatar--invite" aria-hidden>
                        <IconUserBust gradientId="pml-bust-invite" />
                        <span className="pml-duel-avatar-plus" aria-hidden>
                          <IconPlus />
                        </span>
                      </div>
                    </div>
                    <div className="pml-duel-name pml-duel-name--awaiting">
                      <span className="pml-duel-name-text">Invite Opponent</span>
                      <span className="pml-duel-awaiting-hint">Waiting for player…</span>
                    </div>
                    <div className="pml-duel-rating pml-duel-spacer" aria-hidden />
                    <div className="pml-duel-streak-wrap pml-duel-spacer" aria-hidden />
                  </>
                )}
              </div>
              </div>
            </div>

          </div>

          <MultiplayerHubFeatureStrip variant="private" />
        </>
          }
          right={
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
                      <div className="pml-join-recent-sub">
                        Codes you&apos;ve joined will appear here.
                      </div>
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
                    onClick={onCreateRoom}
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
          }
        />
      </div>
    </div>
  );
}
