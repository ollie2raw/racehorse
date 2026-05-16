import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { User } from '@supabase/supabase-js';
import type { Socket } from 'socket.io-client';
import { GlobalNav } from '../components';
import type { OutboundChallenge, SendFriendChallengeResult } from '../multiplayer/friendChallenge';
import { useFriendChallenge } from '../multiplayer/useFriendChallenge';
import { useFriendSocketReachability } from '../multiplayer/useFriendSocketReachability';
import type { AppMode } from '../types';
import {
  fetchFriendsWithPresence,
  fetchPublicProfile,
  type FeedItem,
  type FriendWithPresence,
  type PresenceStatus,
} from './socialApi';
import ActivityFeedPanel, {
  ActivityFeedFilterTabs,
  type ActivityFeedFilterTab,
} from './ActivityFeedPanel';
import './activityFeedScreen.css';

interface ActivityFeedScreenProps {
  user: User | null;
  socket?: Socket | null;
  connect?: () => void;
  sendFriendChallenge?: (target: {
    userId: string;
    username: string;
    presenceStatus: PresenceStatus;
  }) => Promise<SendFriendChallengeResult>;
  showToast?: (message: string, duration?: number) => void;
  outboundChallenge?: OutboundChallenge | null;
  clearOutboundChallenge?: () => void;
  onViewProfile: (username: string) => void;
  onClose: () => void;
  onNavigateToFriends?: () => void;
  onNavigate?: (mode: AppMode) => void;
}

function formatMonthDay(value: string): string {
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

function initials(username: string): string {
  const parts = username.replace(/[^a-zA-Z0-9]/g, ' ').split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return username.slice(0, 2).toUpperCase();
}

function avatarHue(username: string): number {
  let hash = 0;
  for (let i = 0; i < username.length; i += 1) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % 360;
}

function friendAvatarStyle(username: string): CSSProperties {
  const hue = avatarHue(username);
  return {
    background: `linear-gradient(145deg, hsl(${hue} 42% 38%), hsl(${(hue + 48) % 360} 48% 24%))`,
  };
}

function trendingIcon(item: FeedItem): string {
  if (item.type === 'streak') return '🔥';
  if (item.type === 'daily_fritz') return '🤖';
  if (item.type === 'win') return '🏆';
  return '';
}

function trendLabel(item: FeedItem): string {
  if (item.type === 'streak') {
    return `${String(item.metadata.streak ?? '—')} Win Streak`;
  }
  if (item.type === 'daily_fritz') {
    const playerScore = item.metadata.player_score;
    const fritzScore = item.metadata.fritz_score;
    if (playerScore != null && fritzScore != null) {
      return `Daily Fritz · ${String(playerScore)}-${String(fritzScore)}`;
    }
    return `Daily Fritz · ${String(item.metadata.score ?? '—')} pts`;
  }
  return 'Recent ranked result';
}

function trendMode(item: FeedItem): string {
  if (item.type === 'daily_fritz') return 'Daily Fritz';
  if (item.type === 'streak') return 'Play vs Fritz';
  return 'Racehorse';
}

function trendDetailClass(item: FeedItem): string {
  if (item.type === 'streak') return 'rh-sf-trend-detail rh-sf-trend-detail--streak';
  if (item.type === 'daily_fritz') return 'rh-sf-trend-detail rh-sf-trend-detail--fritz';
  return 'rh-sf-trend-detail';
}

function tournamentTitle(item: FeedItem): string {
  return String(item.metadata.tournament_name ?? 'Tournament result');
}

function tournamentPlacement(item: FeedItem): string {
  return String(item.metadata.placement ?? 'Placement posted');
}

const USE_SOCIAL_RAIL_FALLBACK = import.meta.env.DEV;

type DemoOnlineFriend = {
  id: string;
  username: string;
  rating: string;
};

type DemoTrendRow = {
  id: string;
  username: string;
  detail: string;
  detailClass: string;
  mode: string;
  icon: string;
};

type DemoTournamentRow = {
  id: string;
  title: string;
  placement: string;
  date: string;
};

const DEMO_ONLINE_FRIENDS: DemoOnlineFriend[] = [
  { id: 'demo-oliver', username: 'oliver', rating: '1,842' },
  { id: 'demo-hafnerjan', username: 'hafnerjan', rating: '1,651' },
];

const DEMO_TRENDING: DemoTrendRow[] = [
  {
    id: 'demo-trend-oliver',
    username: 'oliver',
    detail: '7 Win Streak',
    detailClass: 'rh-sf-trend-detail--streak',
    mode: 'Play vs Fritz',
    icon: '🔥',
  },
  {
    id: 'demo-trend-lloyd',
    username: 'lloyd',
    detail: '5 Win Streak',
    detailClass: 'rh-sf-trend-detail--streak',
    mode: 'Play vs Fritz',
    icon: '🔥',
  },
  {
    id: 'demo-trend-hafnerjan',
    username: 'hafnerjan',
    detail: 'Daily Fritz · 23 pts',
    detailClass: 'rh-sf-trend-detail--fritz',
    mode: 'Daily Fritz',
    icon: '🤖',
  },
];

const DEMO_TOURNAMENTS: DemoTournamentRow[] = [
  {
    id: 'demo-tourney-1',
    title: 'Weekend Showdown',
    placement: '1st Place',
    date: 'May 14',
  },
  {
    id: 'demo-tourney-2',
    title: 'Daily Blitz',
    placement: '3rd Place',
    date: 'May 13',
  },
];

export default function ActivityFeedScreen({
  user,
  socket = null,
  connect,
  sendFriendChallenge,
  showToast,
  outboundChallenge = null,
  clearOutboundChallenge,
  onViewProfile,
  onClose,
  onNavigateToFriends,
  onNavigate,
}: ActivityFeedScreenProps) {
  const [feedItems, setFeedItems] = useState<FeedItem[]>([]);
  const [friends, setFriends] = useState<FriendWithPresence[]>([]);
  const [friendRatings, setFriendRatings] = useState<Record<string, string>>({});
  const [feedFilter, setFeedFilter] = useState<ActivityFeedFilterTab>('all');

  useEffect(() => {
    let cancelled = false;

    if (!user) {
      setFriends([]);
      return () => {
        cancelled = true;
      };
    }

    void fetchFriendsWithPresence().then((result) => {
      if (cancelled || result.error) return;
      setFriends(result.friends);
    });

    return () => {
      cancelled = true;
    };
  }, [user]);

  const friendUsernames = useMemo(
    () => new Set(friends.map((friend) => friend.username.toLowerCase())),
    [friends],
  );

  const onlineFriends = useMemo(
    () =>
      friends
        .filter((friend) => friend.presence_status === 'online' || friend.presence_status === 'in_game')
        .slice(0, 3),
    [friends],
  );

  useEffect(() => {
    let cancelled = false;

    if (onlineFriends.length === 0) {
      setFriendRatings({});
      return () => {
        cancelled = true;
      };
    }

    void Promise.all(
      onlineFriends.map(async (friend) => {
        const result = await fetchPublicProfile(friend.username);
        return [
          friend.username,
          result.profile?.glicko_rating != null
            ? Math.round(result.profile.glicko_rating).toLocaleString()
            : '—',
        ] as const;
      }),
    ).then((entries) => {
      if (cancelled) return;
      setFriendRatings(Object.fromEntries(entries));
    });

    return () => {
      cancelled = true;
    };
  }, [onlineFriends]);

  const trendingMoments = useMemo(
    () =>
      feedItems
        .filter((item) => item.type === 'streak' || item.type === 'daily_fritz')
        .slice(0, 3),
    [feedItems],
  );

  const recentTournaments = useMemo(
    () => feedItems.filter((item) => item.type === 'tournament').slice(0, 2),
    [feedItems],
  );

  const useRailFallback = USE_SOCIAL_RAIL_FALLBACK && Boolean(user);
  const displayOnlineCount = onlineFriends.length > 0
    ? onlineFriends.length
    : useRailFallback
      ? DEMO_ONLINE_FRIENDS.length
      : 0;
  const showDemoTrending = trendingMoments.length === 0 && useRailFallback;
  const showDemoTournaments = recentTournaments.length === 0 && useRailFallback;

  const reachabilityUserIds = useMemo(
    () => onlineFriends.map((friend) => friend.userId),
    [onlineFriends],
  );

  const { isSocketReachable, hasReachabilitySnapshot } = useFriendSocketReachability({
    socket,
    userIds: reachabilityUserIds,
    enabled: Boolean(user && socket),
  });

  useEffect(() => {
    if (!user || socket?.connected) return;
    connect?.();
  }, [connect, socket?.connected, user]);

  const noopToast = useMemo(() => (_message: string) => undefined, []);
  const {
    challengeFriend,
    getChallengeButtonLabel,
    isChallengeDisabled,
    getChallengeState,
  } = useFriendChallenge({
    socket,
    connect,
    sendFriendChallenge:
      sendFriendChallenge
      ?? (async () => ({ ok: false, error: 'not_connected' as const })),
    showToast: showToast ?? noopToast,
    outboundChallenge,
    clearOutboundChallenge: clearOutboundChallenge ?? (() => undefined),
    isSocketReachable,
    hasReachabilitySnapshot,
  });

  const renderChallengeButton = (
    friend: { userId: string; username: string; presenceStatus: PresenceStatus },
  ) => {
    const state = getChallengeState(friend.userId);
    const disabled = !sendFriendChallenge || isChallengeDisabled(friend.userId, friend.presenceStatus);
    const label = getChallengeButtonLabel(friend.userId, friend.presenceStatus);
    const unreachable = label === 'Unavailable';
    return (
      <button
        className={`rh-sf-challenge-btn${state === 'pending' ? ' is-pending' : ''}`}
        type="button"
        disabled={disabled}
        title={
          unreachable
            ? 'Friend is not reachable for a realtime challenge right now.'
            : undefined
        }
        onClick={() => {
          void challengeFriend(friend);
        }}
      >
        {label}
      </button>
    );
  };

  return (
    <div className="rh-sf-screen">
      <div className="rh-sf-shell">
        <GlobalNav
          currentMode="feed"
          activeColor="var(--tier-elite)"
          solidDarkChrome
          onNavigate={(mode) => {
            if (mode === 'home') {
              onClose();
              return;
            }
            onNavigate?.(mode);
          }}
        />

        <div className="rh-sf-body">
          <div className="rh-sf-page-inner social-page-inner">
            <div className="rh-sf-layout-grid social-layout-grid">
              <main className="rh-sf-main-column social-main-column">
                <header className="rh-sf-header-stack social-header-stack">
                  <div className="rh-sf-page-copy social-title-group">
                    <h1 className="rh-sf-page-title">Activity Feed</h1>
                    <p className="rh-sf-page-sub">
                      See what your friends and the community are up to.
                    </p>
                  </div>
                  {user ? (
                    <ActivityFeedFilterTabs filter={feedFilter} onFilterChange={setFeedFilter} />
                  ) : null}
                </header>

                {!user ? (
                  <section className="rh-sf-signin social-feed-panel">
                    <p>Sign in to see activity from your friends and rivals.</p>
                  </section>
                ) : (
                <ActivityFeedPanel
                  user={user}
                  filter={feedFilter}
                  friendUsernames={friendUsernames}
                  onViewProfile={onViewProfile}
                  onFeedChange={setFeedItems}
                  emptyAction={
                    onNavigateToFriends ? (
                      <button className="rh-sf-widget-link" type="button" onClick={onNavigateToFriends}>
                        Add Friends
                      </button>
                    ) : undefined
                  }
                  />
                )}
              </main>

              <aside className="rh-sf-sidebar rh-sf-right-rail social-right-rail" aria-label="Social sidebar">
              <section className="rh-sf-widget rh-social-card rh-sf-widget--friends social-right-card online-friends">
                <div className="rh-sf-widget-head">
                  <h2 className="rh-sf-widget-title">Online Friends</h2>
                  <span className="rh-sf-widget-online">{displayOnlineCount} online</span>
                </div>
                <div className="rh-sf-widget-list">
                  {onlineFriends.length > 0 ? onlineFriends.map((friend) => (
                    <div key={friend.id} className="rh-sf-friend">
                      <button
                        className="rh-sf-friend-profile"
                        type="button"
                        onClick={() => onViewProfile(friend.username)}
                      >
                        <span className="rh-sf-avatar-wrap rh-sf-avatar-wrap--ring">
                          <span className="rh-sf-avatar rh-social-avatar" style={friendAvatarStyle(friend.username)}>
                            {initials(friend.username)}
                          </span>
                          <span className="rh-sf-avatar-dot" aria-hidden="true" />
                        </span>
                        <span className="rh-sf-friend-copy">
                          <strong>{friend.username}</strong>
                          <span>Rating {friendRatings[friend.username] ?? '—'}</span>
                        </span>
                      </button>
                      <div className="rh-sf-friend-actions">
                        {renderChallengeButton({
                          userId: friend.userId,
                          username: friend.username,
                          presenceStatus: friend.presence_status,
                        })}
                        <button
                          className="rh-sf-chat-btn"
                          type="button"
                          aria-label={`Message ${friend.username}`}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <path
                              d="M7 10h10M7 14h6M6 19l-2 2V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6Z"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </button>
                      </div>
                    </div>
                  )) : useRailFallback ? DEMO_ONLINE_FRIENDS.map((friend) => (
                    <div key={friend.id} className="rh-sf-friend">
                      <button
                        className="rh-sf-friend-profile"
                        type="button"
                        onClick={() => onViewProfile(friend.username)}
                      >
                        <span className="rh-sf-avatar-wrap rh-sf-avatar-wrap--ring">
                          <span className="rh-sf-avatar rh-social-avatar" style={friendAvatarStyle(friend.username)}>
                            {initials(friend.username)}
                          </span>
                          <span className="rh-sf-avatar-dot" aria-hidden="true" />
                        </span>
                        <span className="rh-sf-friend-copy">
                          <strong>{friend.username}</strong>
                          <span>Rating {friend.rating}</span>
                        </span>
                      </button>
                      <div className="rh-sf-friend-actions">
                        {renderChallengeButton({
                          userId: friend.id,
                          username: friend.username,
                          presenceStatus: 'online',
                        })}
                        <button
                          className="rh-sf-chat-btn"
                          type="button"
                          aria-label={`Message ${friend.username}`}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <path
                              d="M7 10h10M7 14h6M6 19l-2 2V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6Z"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </button>
                      </div>
                    </div>
                  )) : (
                    <div className="rh-sf-widget-empty rh-sf-widget-empty--rich">
                      <span className="rh-sf-widget-empty-icon" aria-hidden="true">◎</span>
                      <p>{user ? 'No friends online right now.' : 'Sign in to see who is online.'}</p>
                    </div>
                  )}
                </div>
                {onNavigateToFriends ? (
                  <button className="rh-sf-widget-link" type="button" onClick={onNavigateToFriends}>
                    View All Friends
                    <span aria-hidden="true">›</span>
                  </button>
                ) : null}
              </section>

              <section className="rh-sf-widget rh-social-card rh-sf-widget--trending social-right-card trending-now">
                <h2 className="rh-sf-widget-title rh-sf-widget-title--solo">Trending Now</h2>
                <div className="rh-sf-widget-list">
                  {trendingMoments.length > 0 ? trendingMoments.map((item) => (
                    <div key={item.id} className="rh-sf-trend">
                      <span
                        className={`rh-sf-trend-icon rh-sf-trend-icon--${item.type}`}
                        aria-hidden="true"
                      >
                        {trendingIcon(item)}
                      </span>
                      <span className="rh-sf-trend-copy">
                        <strong>{item.username}</strong>
                        <span className={trendDetailClass(item)}>{trendLabel(item)}</span>
                      </span>
                      <span className="rh-sf-trend-link">{trendMode(item)}</span>
                      <span className="rh-sf-row-chevron" aria-hidden="true">›</span>
                    </div>
                  )) : showDemoTrending ? DEMO_TRENDING.map((item) => (
                    <div key={item.id} className="rh-sf-trend">
                      <span className="rh-sf-trend-icon rh-sf-trend-icon--streak" aria-hidden="true">
                        {item.icon}
                      </span>
                      <span className="rh-sf-trend-copy">
                        <strong>{item.username}</strong>
                        <span className={`rh-sf-trend-detail ${item.detailClass}`}>{item.detail}</span>
                      </span>
                      <span className="rh-sf-trend-link">{item.mode}</span>
                      <span className="rh-sf-row-chevron" aria-hidden="true">›</span>
                    </div>
                  )) : (
                    <div className="rh-sf-widget-empty rh-sf-widget-empty--rich">
                      <span className="rh-sf-widget-empty-icon" aria-hidden="true">↗</span>
                      <p>Trends appear as friends post wins, streaks, and Daily Fritz runs.</p>
                    </div>
                  )}
                </div>
                <button
                  className="rh-sf-widget-link"
                  type="button"
                  onClick={() => onNavigate?.('leaderboard')}
                >
                  View Leaderboard
                  <span aria-hidden="true">›</span>
                </button>
              </section>

              <section className="rh-sf-widget rh-social-card rh-sf-widget--tournaments social-right-card recent-tournaments">
                <h2 className="rh-sf-widget-title rh-sf-widget-title--solo">Recent Tournaments</h2>
                <div className="rh-sf-widget-list">
                  {recentTournaments.length > 0 ? recentTournaments.map((item) => (
                    <div className="rh-sf-tournament" key={item.id}>
                      <span className="rh-sf-trend-icon rh-sf-trend-icon--trophy" aria-hidden="true">🏆</span>
                      <span className="rh-sf-trend-copy">
                        <strong>{tournamentTitle(item)}</strong>
                        <span className="rh-sf-trend-detail rh-sf-trend-detail--tournament">{tournamentPlacement(item)}</span>
                      </span>
                      <span className="rh-sf-tournament-date">{formatMonthDay(item.created_at)}</span>
                      <span className="rh-sf-row-chevron" aria-hidden="true">›</span>
                    </div>
                  )) : showDemoTournaments ? DEMO_TOURNAMENTS.map((item) => (
                    <div className="rh-sf-tournament" key={item.id}>
                      <span className="rh-sf-trend-icon rh-sf-trend-icon--trophy" aria-hidden="true">🏆</span>
                      <span className="rh-sf-trend-copy">
                        <strong>{item.title}</strong>
                        <span className="rh-sf-trend-detail rh-sf-trend-detail--tournament">{item.placement}</span>
                      </span>
                      <span className="rh-sf-tournament-date">{item.date}</span>
                      <span className="rh-sf-row-chevron" aria-hidden="true">›</span>
                    </div>
                  )) : (
                    <div className="rh-sf-widget-empty rh-sf-widget-empty--rich">
                      <span className="rh-sf-widget-empty-icon" aria-hidden="true">🏆</span>
                      <p>Tournament placements show up here when your community posts results.</p>
                    </div>
                  )}
                </div>
                <button
                  className="rh-sf-widget-link"
                  type="button"
                  onClick={() => onNavigate?.('tournament')}
                >
                  View Tournaments
                  <span aria-hidden="true">›</span>
                </button>
              </section>
              </aside>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
