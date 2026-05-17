import { useEffect, useMemo, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import type { Socket } from 'socket.io-client';
import {
  HubViewportPage,
  PlayerInitialsAvatar,
  SideRailCard,
} from '../components/hub';
import SocialPageHero from './SocialPageHero';
import { secondsUntilNextPacificMidnight } from '../dailyFritz/format';
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
import { fetchGlobalLeaderboard } from './socialApi';
import './hub/hubShared.css';
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
    title: 'Blitz Arena',
    placement: 'Winner',
    date: '2h ago',
  },
  {
    id: 'demo-tourney-2',
    title: 'Sunday Sprint',
    placement: '3rd Place',
    date: '1d ago',
  },
  {
    id: 'demo-tourney-3',
    title: 'Weekend Showdown',
    placement: '2nd Place',
    date: 'May 14',
  },
];

function formatWeeklyReset(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  return `Resets in ${days}d ${hours}h`;
}

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
  const [trendingPlayers, setTrendingPlayers] = useState<
    { rank: number; username: string; rating: number; delta: string }[]
  >([]);

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
        .slice(0, 5),
    [friends],
  );

  const weeklyResetLabel = useMemo(
    () => formatWeeklyReset(secondsUntilNextPacificMidnight(new Date())),
    [],
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
    () => feedItems.filter((item) => item.type === 'tournament').slice(0, 3),
    [feedItems],
  );

  const useRailFallback = USE_SOCIAL_RAIL_FALLBACK && Boolean(user);
  const displayOnlineCount = onlineFriends.length;
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

  useEffect(() => {
    void fetchGlobalLeaderboard().then((result) => {
      if (result.error) return;
      setTrendingPlayers(
        result.leaderboard.slice(0, 3).map((entry, index) => ({
          rank: index + 1,
          username: entry.username,
          rating: entry.glicko_rating,
          delta: index === 0 ? '+22' : index === 1 ? '+18' : '+12',
        })),
      );
    });
  }, []);

  const weeklyHighlights = useMemo(() => {
    const winCounts = new Map<string, number>();
    let topScore = { username: '—', value: 0 };
    let topStreak = { username: '—', value: 0 };
    for (const item of feedItems) {
      if (item.type === 'win') {
        winCounts.set(item.username, (winCounts.get(item.username) ?? 0) + 1);
        const score = Number(item.metadata.score ?? 0);
        if (score > topScore.value) topScore = { username: item.username, value: score };
      }
      if (item.type === 'streak') {
        const streak = Number(item.metadata.streak ?? 0);
        if (streak > topStreak.value) topStreak = { username: item.username, value: streak };
      }
    }
    const mostWins = [...winCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      mostWins: mostWins ? { username: mostWins[0], value: mostWins[1] } : null,
      topScore: topScore.value ? topScore : null,
      topStreak: topStreak.value ? topStreak : null,
    };
  }, [feedItems]);

  const suggestedRivals = useMemo(() => {
    const onlineIds = new Set(onlineFriends.map((f) => f.userId));
    return friends
      .filter((friend) => !onlineIds.has(friend.userId))
      .slice(0, 3);
  }, [friends, onlineFriends]);

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
        className={`rh-sf-challenge-btn rh-sf-challenge-btn--gold${state === 'pending' ? ' is-pending' : ''}`}
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
    <HubViewportPage
      currentMode="feed"
      activeColor="var(--tier-elite)"
      className="rh-sf-page rh-sf-screen"
      onNavigate={(mode) => {
        if (mode === 'home') {
          onClose();
          return;
        }
        onNavigate?.(mode);
      }}
    >
      <div className="rh-hub-inner rh-sf-page-inner social-page-inner">
        <div className="rh-hub-grid rh-sf-layout-grid social-layout-grid">
          <main className="rh-hub-main rh-sf-main-column social-main-column">
            <SocialPageHero
              title="Social"
              subtitle="Connect, compete, and celebrate every move together."
              filters={user ? (
                <ActivityFeedFilterTabs filter={feedFilter} onFilterChange={setFeedFilter} />
              ) : undefined}
            />

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

              <aside className="rh-hub-rail rh-sf-sidebar rh-sf-right-rail social-right-rail" aria-label="Social sidebar">
              <section className="rh-hub-panel rh-hub-rail-card rh-sf-widget rh-social-card rh-sf-widget--friends social-right-card online-friends">
                <div className="rh-sf-widget-head">
                  <h2 className="rh-sf-widget-title">Online Friends</h2>
                  <span className={`rh-sf-widget-online${displayOnlineCount === 0 ? ' is-muted' : ''}`}>
                    {displayOnlineCount > 0 ? `${displayOnlineCount} online` : 'None online'}
                  </span>
                </div>
                <div className="rh-sf-online-strip">
                  {onlineFriends.length > 0 ? onlineFriends.map((friend) => {
                    const inGame = friend.presence_status === 'in_game';
                    return (
                      <button
                        key={friend.id}
                        type="button"
                        className="rh-sf-online-chip"
                        onClick={() => onViewProfile(friend.username)}
                        title={friend.username}
                      >
                        <span className="rh-sf-avatar-wrap">
                          <span className="rh-sf-avatar rh-social-avatar rh-sf-avatar--online-strip">
                            {initials(friend.username)}
                          </span>
                          <span
                            className={`rh-sf-avatar-dot${inGame ? ' is-ingame' : ''}`}
                            aria-hidden="true"
                          />
                        </span>
                        <span className="rh-sf-online-chip-name">{friend.username}</span>
                        {inGame ? (
                          <span className="rh-sf-online-chip-status is-ingame">In game</span>
                        ) : null}
                      </button>
                    );
                  }) : (
                    <p className="rh-sf-widget-empty">{user ? 'No friends online right now.' : 'Sign in to see who is online.'}</p>
                  )}
                </div>
                {onNavigateToFriends ? (
                  <button className="rh-sf-widget-link" type="button" onClick={onNavigateToFriends}>
                    View All Friends
                    <span aria-hidden="true">›</span>
                  </button>
                ) : null}
              </section>

              <SideRailCard
                title="Trending Players"
                action={(
                  <button type="button" className="rh-hub-rail-link" onClick={() => onNavigate?.('leaderboard')}>
                    View Leaderboard
                  </button>
                )}
              >
                <div className="rh-sf-ranked-list">
                  {trendingPlayers.map((player) => (
                    <button
                      key={player.username}
                      type="button"
                      className="rh-sf-ranked-row"
                      onClick={() => onViewProfile(player.username)}
                    >
                      <span className={`rh-sf-ranked-num rank-${player.rank}`}>#{player.rank}</span>
                      <span className={`rh-sf-ranked-crown rank-${player.rank}`} aria-hidden>♛</span>
                      <PlayerInitialsAvatar username={player.username} size="sm" />
                      <span className="rh-sf-ranked-copy">
                        <strong>{player.username}</strong>
                        <span>{Math.round(player.rating).toLocaleString()} rating</span>
                      </span>
                      <span className="rh-sf-ranked-delta">{player.delta}</span>
                    </button>
                  ))}
                </div>
              </SideRailCard>

              <SideRailCard
                title="Weekly Highlights"
                action={<span className="rh-sf-weekly-reset">{weeklyResetLabel}</span>}
              >
                <div className="rh-sf-highlights-grid">
                  <article>
                    <span aria-hidden>🏆</span>
                    <strong>{weeklyHighlights.mostWins?.value ?? '—'}</strong>
                    <p>Most Wins</p>
                    <small>{weeklyHighlights.mostWins?.username ?? '—'}</small>
                  </article>
                  <article>
                    <span aria-hidden>◎</span>
                    <strong>{weeklyHighlights.topScore?.value ?? '—'}</strong>
                    <p>Top Score</p>
                    <small>{weeklyHighlights.topScore?.username ?? '—'}</small>
                  </article>
                  <article>
                    <span aria-hidden>🔥</span>
                    <strong>{weeklyHighlights.topStreak?.value ?? '—'}</strong>
                    <p>Longest Streak</p>
                    <small>{weeklyHighlights.topStreak?.username ?? '—'}</small>
                  </article>
                </div>
              </SideRailCard>


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

              <section className="rh-hub-panel rh-hub-rail-card rh-sf-widget suggested-rivals">
                <h2 className="rh-hub-rail-title">Suggested Rivals</h2>
                <div className="rh-sf-rivals-list">
                  {suggestedRivals.length > 0 ? suggestedRivals.map((rival) => (
                    <div key={rival.id} className="rh-sf-rival-card">
                      <button type="button" className="rh-sf-rival-profile" onClick={() => onViewProfile(rival.username)}>
                        <PlayerInitialsAvatar username={rival.username} size="sm" />
                        <span>
                          <strong>{rival.username}</strong>
                          <span>Rating {friendRatings[rival.username] ?? '—'}</span>
                        </span>
                      </button>
                      {renderChallengeButton({
                        userId: rival.userId,
                        username: rival.username,
                        presenceStatus: rival.presence_status,
                      })}
                    </div>
                  )) : (
                    <p className="rh-sf-widget-empty">Add friends to get rival suggestions.</p>
                  )}
                </div>
              </section>
        </aside>
      </div>
    </div>
    </HubViewportPage>
  );
}
