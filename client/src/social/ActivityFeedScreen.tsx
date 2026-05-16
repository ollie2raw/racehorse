import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { User } from '@supabase/supabase-js';
import { GlobalNav } from '../components';
import type { AppMode } from '../types';
import {
  fetchFriendsWithPresence,
  fetchPublicProfile,
  type FeedItem,
  type FriendWithPresence,
} from './socialApi';
import ActivityFeedPanel from './ActivityFeedPanel';
import './activityFeedScreen.css';

interface ActivityFeedScreenProps {
  user: User | null;
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
  return '';
}

function trendLabel(item: FeedItem): string {
  if (item.type === 'streak') {
    return `${String(item.metadata.streak ?? '—')} Win Streak`;
  }
  if (item.type === 'daily_fritz') {
    return `Daily Fritz · ${String(item.metadata.score ?? '—')} pts`;
  }
  return 'Recent ranked result';
}

function tournamentTitle(item: FeedItem): string {
  return String(item.metadata.tournament_name ?? 'Tournament result');
}

function tournamentPlacement(item: FeedItem): string {
  return String(item.metadata.placement ?? 'Placement posted');
}

export default function ActivityFeedScreen({
  user,
  onViewProfile,
  onClose,
  onNavigateToFriends,
  onNavigate,
}: ActivityFeedScreenProps) {
  const [feedItems, setFeedItems] = useState<FeedItem[]>([]);
  const [friends, setFriends] = useState<FriendWithPresence[]>([]);
  const [friendRatings, setFriendRatings] = useState<Record<string, string>>({});

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
          <div className="rh-sf-layout">
            <main className="rh-sf-main">
              <header className="rh-sf-page-head">
                <div className="rh-sf-page-copy">
                  <h1 className="rh-sf-page-title">Activity Feed</h1>
                  <p className="rh-sf-page-sub">
                    See what your friends and the community are up to.
                  </p>
                </div>
                <button
                  className="rh-sf-post-btn"
                  type="button"
                  title="Post updates are coming soon"
                  onClick={() => {
                    /* visual-only until post API exists */
                  }}
                >
                  <span>Post Update</span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </header>

              {!user ? (
                <div className="rh-sf-signin">
                  <p>Sign in to see activity from your friends and rivals.</p>
                </div>
              ) : (
                <ActivityFeedPanel
                  user={user}
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

            <aside className="rh-sf-sidebar" aria-label="Social sidebar">
              <section className="rh-sf-widget">
                <div className="rh-sf-widget-head">
                  <h2 className="rh-sf-widget-title">Online Friends</h2>
                  <span className="rh-sf-widget-online">{onlineFriends.length} online</span>
                </div>
                <div className="rh-sf-widget-list">
                  {onlineFriends.length > 0 ? onlineFriends.map((friend) => (
                    <div key={friend.id} className="rh-sf-friend">
                      <button
                        className="rh-sf-friend-profile"
                        type="button"
                        onClick={() => onViewProfile(friend.username)}
                      >
                        <span className="rh-sf-avatar-wrap">
                          <span className="rh-sf-avatar" style={friendAvatarStyle(friend.username)}>
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
                        <button className="rh-sf-challenge-btn" type="button">Challenge</button>
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
                    <p className="rh-sf-widget-empty">
                      {user ? 'No friends online right now.' : 'Sign in to see who is online.'}
                    </p>
                  )}
                </div>
                {onNavigateToFriends ? (
                  <button className="rh-sf-widget-link" type="button" onClick={onNavigateToFriends}>
                    View All Friends
                    <span aria-hidden="true">›</span>
                  </button>
                ) : null}
              </section>

              <section className="rh-sf-widget">
                <h2 className="rh-sf-widget-title rh-sf-widget-title--solo">Trending Now</h2>
                <div className="rh-sf-widget-list">
                  {trendingMoments.length > 0 ? trendingMoments.map((item) => (
                    <div key={item.id} className="rh-sf-trend">
                      <span className="rh-sf-trend-icon" aria-hidden="true">
                        {trendingIcon(item)}
                      </span>
                      <span className="rh-sf-trend-copy">
                        <strong>{item.username}</strong>
                        <span>{trendLabel(item)}</span>
                      </span>
                      <span className="rh-sf-trend-link">
                        {item.type === 'daily_fritz' ? 'Daily Fritz' : 'Play vs Fritz'} ›
                      </span>
                    </div>
                  )) : (
                    <p className="rh-sf-widget-empty">Trends appear as friends post wins and streaks.</p>
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

              <section className="rh-sf-widget">
                <h2 className="rh-sf-widget-title rh-sf-widget-title--solo">Recent Tournaments</h2>
                <div className="rh-sf-widget-list">
                  {recentTournaments.length > 0 ? recentTournaments.map((item) => (
                    <div className="rh-sf-tournament" key={item.id}>
                      <span className="rh-sf-trend-icon rh-sf-trend-icon--trophy" aria-hidden="true">🏆</span>
                      <span className="rh-sf-trend-copy">
                        <strong>{tournamentTitle(item)}</strong>
                        <span>{tournamentPlacement(item)}</span>
                      </span>
                      <span className="rh-sf-tournament-date">{formatMonthDay(item.created_at)} ›</span>
                    </div>
                  )) : (
                    <p className="rh-sf-widget-empty">Tournament placements show up here when posted.</p>
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
  );
}
