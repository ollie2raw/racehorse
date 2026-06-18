import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { AppMode } from '../types';
import { isGameServerSameOriginAsPage } from '../lib/gameServerUrl';
import { GlobalNav } from '../components';
import { useSyncNow } from '../ui/useSyncNow';
import { useMatchmaking } from './useMatchmaking';
import type { MatchFoundPayload } from './types';
import { MultiplayerTopBar } from './MultiplayerTopBar';
import { ArenaRings } from '../multiplayer/ArenaRings';
import { IconFlame, IconPlus, IconUserBust } from '../multiplayer/MultiplayerDuelIcons';
import { DuelOpponentFriendButton } from '../multiplayer/DuelOpponentFriendButton';
import { MultiplayerHubFeatureStrip } from '../multiplayer/MultiplayerHubFeatureStrip';
import { MultiplayerTwoColumnPvLayout } from '../multiplayer/MultiplayerTwoColumnPvLayout';
import '../multiplayer/privateMatchLobby.css';
import './matchmakingScreen.css';

type Identity = { userId: string; username: string } | null;

export interface MatchmakingScreenProps {
  socket: Socket | null;
  identity: Identity;
  isConnected: boolean;
  /** True while the Socket.io handshake is in progress */
  isConnecting?: boolean;
  /** Resolved base URL used for Socket.io (from VITE_SERVER_URL or page origin) */
  serverUrl?: string;
  /** Retry opening the socket (e.g. after fixing env / backend) */
  onRetryConnect?: () => void;
  myRating?: number | null;
  /** Current ranked win streak for the signed-in user (same source as private lobby). */
  myWinStreak?: number | null;
  onNavigate?: (mode: AppMode) => void;
  onOpenAuth?: () => void;
  onOpenAccount?: () => void;
  onBackHome: () => void;
  onOpenPrivateMatch: () => void;
  onAutoJoinRoom: (payload: MatchFoundPayload) => void;
}

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function ratingSegmentIndex(state: 'idle' | 'searching' | 'timeout', elapsedMs: number): number {
  if (state === 'idle') return 0;
  if (state === 'timeout') return 3;
  return Math.min(3, Math.floor(elapsedMs / 30_000));
}

const MatchmakingRatingTrack = memo(function MatchmakingRatingTrack({
  queueState,
  searchStartedAtMs,
}: {
  queueState: 'idle' | 'searching' | 'timeout';
  searchStartedAtMs: number | null;
}) {
  const ticking = queueState === 'searching' && searchStartedAtMs != null;
  const now = useSyncNow(1000, ticking);
  const elapsedMs = ticking ? Math.max(0, now - searchStartedAtMs) : 0;
  const ratingSegActive = ratingSegmentIndex(queueState, elapsedMs);

  return (
    <div className="mm-rating-track" role="list" aria-label="Rating search window over time">
      {RATING_SEGMENTS.map((seg, i) => (
        <div
          key={seg.when}
          role="listitem"
          className={`mm-rating-seg${i === ratingSegActive ? ' is-active' : ''}`}
        >
          <span className="mm-rating-seg__range">{seg.range}</span>
          <span className="mm-rating-seg__when">{seg.when}</span>
        </div>
      ))}
    </div>
  );
});

const SearchElapsedClock = memo(function SearchElapsedClock({
  searchStartedAtMs,
}: {
  searchStartedAtMs: number | null;
}) {
  const ticking = searchStartedAtMs != null;
  const now = useSyncNow(1000, ticking);
  const elapsedMs = ticking ? Math.max(0, now - searchStartedAtMs) : 0;

  return <>{formatElapsed(elapsedMs)}</>;
});

function IconBolt({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M13 3L5 14H12L11 21L19 10H12L13 3Z" fill="currentColor" />
    </svg>
  );
}

function IconCrown({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconUsers({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M17 21V19C17 17.9 16.6 16.9 15.8 16.2C15.1 15.4 14.1 15 13 15H5C3.9 15 2.9 15.4 2.2 16.2C1.4 16.9 1 17.9 1 19V21M9 11C11.2 11 13 9.2 13 7C13 4.8 11.2 3 9 3C6.8 3 5 4.8 5 7C5 9.2 6.8 11 9 11ZM23 21V19C23 17 21.7 15.4 20 15M16 3.1C17.7 3.6 19 5.1 19 7S17.7 10.4 16 10.9"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconClock({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path d="M12 7V12L15 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IconTarget({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="6" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
    </svg>
  );
}

function IconDominoes({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="5" y="2" width="14" height="20" rx="2" stroke="currentColor" strokeWidth="2" />
      <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth="2" />
      <circle cx="9" cy="7" r="1.2" fill="currentColor" />
      <circle cx="15" cy="7" r="1.2" fill="currentColor" />
      <circle cx="12" cy="17" r="1.2" fill="currentColor" />
    </svg>
  );
}

const RATING_SEGMENTS = [
  { range: '±100', when: '0–30s' },
  { range: '±200', when: '30–60s' },
  { range: '±300', when: '60–90s' },
  { range: 'Any', when: '90s+' },
] as const;

export default function MatchmakingScreen(props: MatchmakingScreenProps) {
  const {
    isConnected,
    isConnecting: isConnectingProp,
    serverUrl: serverUrlProp,
    onRetryConnect,
    myRating: myRatingProp,
    myWinStreak: myWinStreakProp,
    onAutoJoinRoom,
  } = props;
  const isConnecting = isConnectingProp ?? false;
  const serverUrl = serverUrlProp ?? '';
  const [latchedDisconnectedHint, setLatchedDisconnectedHint] = useState(false);
  const [friendToast, setFriendToast] = useState('');
  const pendingAutoJoinRef = useRef<MatchFoundPayload | null>(null);
  const disconnectedForHint = !isConnected && !isConnecting;
  if (!disconnectedForHint && latchedDisconnectedHint) {
    setLatchedDisconnectedHint(false);
  }
  const showDisconnectedHint = disconnectedForHint && latchedDisconnectedHint;

  useEffect(() => {
    if (!friendToast) return;
    const t = window.setTimeout(() => setFriendToast(''), 3000);
    return () => window.clearTimeout(t);
  }, [friendToast]);

  useEffect(() => {
    if (!disconnectedForHint) return;
    const t = window.setTimeout(() => setLatchedDisconnectedHint(true), 2800);
    return () => window.clearTimeout(t);
  }, [disconnectedForHint]);

  useEffect(() => {
    if (!showDisconnectedHint || import.meta.env.PROD) return;
    console.info('[matchmaking] game server not connected yet', {
      serverUrl: serverUrl || '(page origin)',
      sameOriginAsPage: serverUrl ? isGameServerSameOriginAsPage(serverUrl) : false,
    });
  }, [showDisconnectedHint, serverUrl]);

  const handleMatchReady = useCallback(
    (payload: MatchFoundPayload) => {
      // Join the match room immediately so both players are seated before the
      // countdown ends — server can deal as soon as the room is full.
      if (isConnected) {
        onAutoJoinRoom(payload);
      } else {
        pendingAutoJoinRef.current = payload;
        onRetryConnect?.();
      }
    },
    [isConnected, onAutoJoinRoom, onRetryConnect],
  );

  useEffect(() => {
    if (!isConnected || !pendingAutoJoinRef.current) return;
    const payload = pendingAutoJoinRef.current;
    pendingAutoJoinRef.current = null;
    onAutoJoinRoom(payload);
  }, [isConnected, onAutoJoinRoom]);

  const mm = useMatchmaking({
    socket: props.socket,
    identity: props.identity,
    onMatchReady: handleMatchReady,
  });

  useEffect(() => {
    if (!props.socket || !props.isConnected) return;
    mm.refreshOnlineCounts();
  }, [props.socket, props.isConnected, mm.refreshOnlineCounts]);

  const isIdle = mm.state === 'idle';
  const isSearching = mm.state === 'searching';
  const isTimeout = mm.state === 'timeout';

  const myRating = myRatingProp ?? null;
  const myWinStreak = myWinStreakProp ?? null;
  const myUsername = props.identity?.username ?? null;

  const queueUiState = isSearching ? 'searching' : isTimeout ? 'timeout' : 'idle';

  const matchedOpponent = mm.matched?.opponent ?? null;
  const showMatchedOpponent = mm.state === 'matched' && matchedOpponent != null;
  const opponentAwaitingHint = isSearching
    ? 'Searching the rated queue…'
    : 'Waiting to start matchmaking…';

  return (
    <div className="mm-page mm-mp-bridge multiplayer-hub">
      {friendToast ? (
        <div className="mm-friend-toast" role="status" aria-live="polite">
          {friendToast}
        </div>
      ) : null}
      <GlobalNav
        currentMode={'multiplayer' as AppMode}
        onNavigate={props.onNavigate}
        onOpenAuth={props.onOpenAuth}
        onOpenAccount={props.onOpenAccount}
        activeColor="var(--tier-standard)"
      />

      <div className="mp-hub-shell mp-hub-shell--pvf">
        <MultiplayerTopBar
          activeTab="quick"
          onSelectQuick={() => {}}
          onSelectPrivate={props.onOpenPrivateMatch}
          onBackMultiplayer={props.onBackHome}
          online={mm.online}
          queued={mm.queued}
        />

        <MultiplayerTwoColumnPvLayout
          leftColClassName="pml-left--stack"
          left={
            <>
              <div className="pvf-header">
                <div className="pvf-label">MULTIPLAYER</div>
                <h1 className="pvf-title">Quick Match</h1>
                <p className="pvf-subtitle mp-hub-subtitle">
                  <span className="mp-hub-subtitle-line">
                    Skill-based 1v1 dominos. We pair you with a player near your rating and expand the
                  </span>
                  <span className="mp-hub-subtitle-line">search every 30 seconds.</span>
                </p>
              </div>

              <div className="pml-room-stage">
                <div className="pml-room-stage__scroll">
                  <div className="pml-matchup">
                  <ArenaRings />
                  <div className="pml-duel-card pml-duel-card--host">
                    <div className="pml-duel-avatar-frame">
                      <div className="pml-duel-avatar" aria-hidden>
                        <IconUserBust gradientId="mm-bust-you" />
                      </div>
                    </div>
                    <div className="pml-duel-name">
                      <span className="pml-duel-name-text">{myUsername ?? 'You'}</span>
                    </div>
                    <div
                      className="pml-duel-rating"
                      aria-label={myRating != null ? `Rating ${myRating.toLocaleString()}` : undefined}
                    >
                      {myRating != null ? (
                        <>
                          <span className="pml-duel-star" aria-hidden>
                            ★
                          </span>
                          <span className="pml-duel-rating-num">{myRating.toLocaleString()}</span>
                        </>
                      ) : (
                        <span className="pml-duel-rating-num">—</span>
                      )}
                    </div>
                    <div
                      className={`pml-duel-streak-wrap${
                        props.identity && myWinStreak != null && myWinStreak > 0 ? '' : ' pml-duel-spacer'
                      }`}
                      aria-hidden={!(props.identity && myWinStreak != null && myWinStreak > 0)}
                    >
                      {props.identity && myWinStreak != null && myWinStreak > 0 ? (
                        <div className="pml-duel-streak">
                          <span className="pml-duel-streak-flame" aria-hidden>
                            <IconFlame />
                          </span>
                          <span>Win Streak: {myWinStreak}</span>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="pml-vs-column">
                    <span className="pml-vs-text">VS</span>
                  </div>

                  <div
                    className={`pml-duel-card pml-duel-card--guest${showMatchedOpponent ? '' : ' pml-duel-card--awaiting'}`}
                  >
                    {showMatchedOpponent ? (
                      <>
                        <div className="pml-duel-avatar-frame">
                          <div className="pml-duel-avatar" aria-hidden>
                            <IconUserBust gradientId="mm-bust-opp" />
                          </div>
                          {!matchedOpponent.isSim && props.identity ? (
                            <DuelOpponentFriendButton
                              currentUserId={props.identity.userId}
                              opponentUserId={matchedOpponent.userId}
                              opponentUsername={matchedOpponent.username}
                              hidden={matchedOpponent.userId === props.identity.userId}
                              onToast={setFriendToast}
                            />
                          ) : null}
                        </div>
                        <div className="pml-duel-name">
                          <span className="pml-duel-name-text">{matchedOpponent.username}</span>
                        </div>
                        <div
                          className="pml-duel-rating"
                          aria-label={`Rating ${matchedOpponent.rating.toLocaleString()}`}
                        >
                          <span className="pml-duel-star" aria-hidden>
                            ★
                          </span>
                          <span className="pml-duel-rating-num">
                            {matchedOpponent.rating.toLocaleString()}
                          </span>
                        </div>
                        <div className="pml-duel-streak-wrap pml-duel-spacer" aria-hidden />
                      </>
                    ) : (
                      <>
                        <div className="pml-duel-avatar-frame">
                          <div className="pml-duel-avatar pml-duel-avatar--invite" aria-hidden>
                            <IconUserBust gradientId="mm-bust-opp" />
                            <span className="pml-duel-avatar-plus" aria-hidden>
                              <IconPlus />
                            </span>
                          </div>
                        </div>
                        <div className="pml-duel-name pml-duel-name--awaiting">
                          <span className="pml-duel-name-text">Find Opponent</span>
                          <span className="pml-duel-awaiting-hint">{opponentAwaitingHint}</span>
                        </div>
                        <div className="pml-duel-rating pml-duel-spacer" aria-hidden />
                        <div className="pml-duel-streak-wrap pml-duel-spacer" aria-hidden />
                      </>
                    )}
                  </div>
                  </div>
                </div>
              </div>

              <MultiplayerHubFeatureStrip variant="quick" />
            </>
          }
          right={
            <div className="pvf-control-panel mm-mp-panel">
              <div className="pml-panel-body mm-panel-body">
            {isIdle ? (
              <>
                <div className="mm-section">
                  <div className="fritz-section-label">1. MATCH FORMAT</div>
                  <h2 className="mm-section-heading">Standard 1v1</h2>
                  <p className="mm-section-body">
                    First to 60 points, 7-tile classic. Single game; no best-of.
                  </p>
                  <div className="fritz-summary-strip">
                    <div className="fritz-summary-item">
                      <div className="fritz-summary-icon" style={{ color: 'var(--tier-standard)' }}>
                        <IconDominoes size={18} />
                      </div>
                      <div>
                        <div className="fritz-summary-value">7-Tile</div>
                        <div className="fritz-summary-key">Format</div>
                      </div>
                    </div>
                    <div className="fritz-summary-divider" aria-hidden />
                    <div className="fritz-summary-item">
                      <div className="fritz-summary-icon" style={{ color: 'var(--tier-standard)' }}>
                        <IconTarget size={18} />
                      </div>
                      <div>
                        <div className="fritz-summary-value">First to 60</div>
                        <div className="fritz-summary-key">Win Target</div>
                      </div>
                    </div>
                    <div className="fritz-summary-divider" aria-hidden />
                    <div className="fritz-summary-item">
                      <div className="fritz-summary-icon" style={{ color: 'var(--tier-standard)' }}>
                        <IconClock size={18} />
                      </div>
                      <div>
                        <div className="fritz-summary-value">Untimed</div>
                        <div className="fritz-summary-key">Turns</div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mm-section">
                  <div className="fritz-section-label">2. RATING RANGE</div>
                  <h2 className="mm-section-heading">Expanding skill window</h2>
                  <p className="mm-section-body">
                    We start with players near your rating, then widen the search every 30 seconds.
                  </p>
                  <MatchmakingRatingTrack
                    queueState={queueUiState}
                    searchStartedAtMs={mm.searchStartedAtMs}
                  />
                </div>

                <div className="mm-section">
                  <div className="fritz-section-label">3. MATCH SUMMARY</div>
                  <div className="fritz-summary-strip">
                    <div className="fritz-summary-item">
                      <div className="fritz-summary-icon" style={{ color: 'var(--tier-elite)' }}>
                        <IconCrown size={18} />
                      </div>
                      <div>
                        <div className="fritz-summary-value">
                          {myRating != null ? myRating.toLocaleString() : '—'}
                        </div>
                        <div className="fritz-summary-key">Your Rating</div>
                      </div>
                    </div>
                    <div className="fritz-summary-divider" aria-hidden />
                    <div className="fritz-summary-item">
                      <div className="fritz-summary-icon" style={{ color: 'var(--tier-elite)' }}>
                        <IconUsers size={18} />
                      </div>
                      <div>
                        <div className="fritz-summary-value">{mm.queued.toLocaleString()}</div>
                        <div className="fritz-summary-key">In Queue</div>
                      </div>
                    </div>
                    <div className="fritz-summary-divider" aria-hidden />
                    <div className="fritz-summary-item">
                      <div className="fritz-summary-icon" style={{ color: 'var(--tier-elite)' }}>
                        <IconBolt size={18} />
                      </div>
                      <div>
                        <div className="fritz-summary-value">Ranked</div>
                        <div className="fritz-summary-key">Match Type</div>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            ) : null}

            {isSearching ? (
              <>
                <div className="mm-section">
                  <div className="fritz-section-label">1. MATCH FORMAT</div>
                  <h2 className="mm-section-heading">Standard 1v1</h2>
                  <p className="mm-section-body">First to 60 · 7-tile · Untimed · Ranked</p>
                </div>

                <div className="mm-section">
                  <div className="fritz-section-label">2. RATING RANGE</div>
                  <h2 className="mm-section-heading">Expanding skill window</h2>
                  <p className="mm-section-body">Current search band updates as you wait.</p>
                  <MatchmakingRatingTrack
                    queueState={queueUiState}
                    searchStartedAtMs={mm.searchStartedAtMs}
                  />
                </div>

                <div className="mm-section">
                  <div className="fritz-section-label">SEARCHING</div>
                  <div className="mm-searching">
                    <div className="mm-search-pulse" aria-hidden>
                      <span className="mm-search-core" />
                    </div>
                    <div className="mm-search-elapsed" aria-live="polite">
                      <SearchElapsedClock searchStartedAtMs={mm.searchStartedAtMs} />
                    </div>
                    <div className="mm-search-status">Looking for opponent…</div>
                  </div>
                </div>
              </>
            ) : null}

            {isTimeout ? (
              <div className="mm-section">
                <div className="fritz-section-label">QUEUE TIMEOUT</div>
                <div className="mm-timeout">
                  <div className="mm-timeout__icon" aria-hidden>
                    <IconClock size={22} />
                  </div>
                  <h2 className="mm-timeout__title">No opponent found</h2>
                  <p className="mm-timeout__sub">
                    The queue is quiet right now. You can keep waiting or play a ranked match against Fritz
                    instead.
                  </p>
                </div>
              </div>
            ) : null}
              </div>

              <div className="pml-panel-footer mm-panel-footer">
            {isIdle ? (
              <>
                <button
                  type="button"
                  className="mm-cta"
                  onClick={mm.findMatch}
                  disabled={!props.isConnected || !props.identity}
                >
                  Find Match
                  <span className="mm-cta-chevron" aria-hidden>
                    ›
                  </span>
                </button>
                {!props.identity ? (
                  <p className="mm-help-text">Sign in to find a match.</p>
                ) : props.isConnected ? (
                  <p className="mm-help-text">First to 60 · 7-Tile · Ranked</p>
                ) : isConnecting || !showDisconnectedHint ? (
                  <p className="mm-help-text">Connecting…</p>
                ) : (
                  <div className="mm-connect-hint">
                    <h2 className="mm-connect-hint__title">Waking up game server…</h2>
                    <p className="mm-help-text">
                      The game server is starting up. This can take up to 60 seconds.
                    </p>
                    <p className="mm-help-text mm-help-text--muted">Retrying automatically…</p>
                    {props.onRetryConnect ? (
                      <button type="button" className="mm-cta-secondary mm-connect-retry" onClick={props.onRetryConnect}>
                        Retry now
                      </button>
                    ) : null}
                  </div>
                )}
                {mm.error ? <p className="mm-error">{mm.error}</p> : null}
              </>
            ) : null}

            {isSearching ? (
              <button type="button" className="mm-cta mm-cta--cancel" onClick={mm.cancel}>
                Cancel Search
              </button>
            ) : null}

            {isTimeout ? (
              <>
                <button
                  type="button"
                  className="mm-cta"
                  onClick={() => {
                    mm.acceptTimeoutBotFallback();
                    mm.findMatch();
                  }}
                >
                  Search again
                  <span className="mm-cta-chevron" aria-hidden>
                    ›
                  </span>
                </button>
                <p className="mm-help-text">No opponent joined within the wait window. You can keep searching.</p>
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
