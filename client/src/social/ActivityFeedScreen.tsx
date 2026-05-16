import { useMemo, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { GlobalNav } from '../components';
import type { AppMode } from '../types';
import type { FeedItem } from './socialApi';
import ActivityFeedPanel from './ActivityFeedPanel';
import '../screens/RacehorseHomeArt.css';
import './activityFeedScreen.css';

interface ActivityFeedScreenProps {
  user: User | null;
  onViewProfile: (username: string) => void;
  onClose: () => void;
  onNavigateToFriends?: () => void;
  onNavigate?: (mode: AppMode) => void;
}

function statCount(feed: FeedItem[], type: FeedItem['type']): number {
  return feed.filter((item) => item.type === type).length;
}

export default function ActivityFeedScreen({
  user,
  onViewProfile,
  onClose,
  onNavigateToFriends,
  onNavigate,
}: ActivityFeedScreenProps) {
  const [feedItems, setFeedItems] = useState<FeedItem[]>([]);

  const summary = useMemo(() => {
    const wins = statCount(feedItems, 'win');
    const streaks = statCount(feedItems, 'streak');
    const tournaments = statCount(feedItems, 'tournament');
    const featuredMoment = feedItems[0] ? new Date(feedItems[0].created_at).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    }) : 'Waiting';
    return {
      total: feedItems.length,
      wins,
      streaks,
      tournaments,
      featuredMoment,
    };
  }, [feedItems]);

  return (
    <div className="rh-afs-screen home-page-root">
      <div className="home-bg" aria-hidden="true">
        <div className="home-bg__halo" />
        <div className="home-bg__domino home-bg__domino--tl" />
        <div className="home-bg__domino home-bg__domino--tr" />
        <div className="home-bg__line home-bg__line--1" />
        <div className="home-bg__line home-bg__line--2" />
        <div className="home-bg__line home-bg__line--3" />
        <div className="home-bg__texture" />
      </div>

      <div className="rh-afs-shell home-shell">
        <GlobalNav
          currentMode="feed"
          activeColor="#52B6FF"
          onNavigate={(mode) => {
            if (mode === 'home') {
              onClose();
              return;
            }
            onNavigate?.(mode);
          }}
        />

        <main className="rh-afs-main home-main">
          <section className="rh-afs-hero">
            <div className="rh-afs-hero-copy">
              <button className="rh-afs-back rh-back-button" onClick={onClose} aria-label="Back to home">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d="M19 12H5M5 12L12 19M5 12L12 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Back to Home
              </button>
              <p className="rh-afs-kicker">SOCIAL</p>
              <h1 className="rh-afs-title">Activity Feed</h1>
              <p className="rh-afs-subtitle">
                Track the pulse of your Racehorse circle: ranked wins, Daily Fritz results,
                streaks, and tournament moments in one premium social rail.
              </p>
              <div className="rh-afs-hero-actions">
                {onNavigateToFriends ? (
                  <button className="rh-afs-cta rh-afs-cta--primary" onClick={onNavigateToFriends}>
                    Open Friends
                  </button>
                ) : null}
                <button
                  className="rh-afs-cta"
                  onClick={() => onNavigate?.('stats')}
                  type="button"
                >
                  View Stats
                </button>
              </div>
            </div>

            <div className="rh-afs-hero-stats">
              <article className="rh-afs-statcard rh-afs-statcard--feature">
                <span className="rh-afs-statcard__label">Recent Volume</span>
                <strong className="rh-afs-statcard__value">{summary.total}</strong>
                <span className="rh-afs-statcard__meta">Tracked social moments</span>
              </article>
              <article className="rh-afs-statcard">
                <span className="rh-afs-statcard__label">Ranked Wins</span>
                <strong className="rh-afs-statcard__value">{summary.wins}</strong>
                <span className="rh-afs-statcard__meta">Victory posts in feed</span>
              </article>
              <article className="rh-afs-statcard">
                <span className="rh-afs-statcard__label">Streak Alerts</span>
                <strong className="rh-afs-statcard__value">{summary.streaks}</strong>
                <span className="rh-afs-statcard__meta">Momentum moments</span>
              </article>
              <article className="rh-afs-statcard">
                <span className="rh-afs-statcard__label">Featured Window</span>
                <strong className="rh-afs-statcard__value">{summary.featuredMoment}</strong>
                <span className="rh-afs-statcard__meta">Most recent post date</span>
              </article>
            </div>
          </section>

          <section className="rh-afs-content">
            <div className="rh-afs-rail">
              <div className="rh-afs-panel-head">
                <div>
                  <p className="rh-afs-panel-eyebrow">Live Feed</p>
                  <h2 className="rh-afs-panel-title">Friends and rivals</h2>
                </div>
                <div className="rh-afs-panel-pills" aria-hidden="true">
                  <span className="rh-afs-panel-pill">Ranked</span>
                  <span className="rh-afs-panel-pill">Daily</span>
                  <span className="rh-afs-panel-pill">Streaks</span>
                </div>
              </div>

              {!user ? (
                <div className="rh-afs-empty-card">
                  <span className="rh-afs-empty-card__kicker">Account required</span>
                  <h3>Sign in to unlock your social rail.</h3>
                  <p>Follow friends, compare daily results, and see the latest movement across your Racehorse network.</p>
                </div>
              ) : (
                <ActivityFeedPanel
                  user={user}
                  onViewProfile={onViewProfile}
                  onFeedChange={setFeedItems}
                  emptyAction={
                    onNavigateToFriends ? (
                      <button className="rh-afs-cta rh-afs-cta--primary" onClick={onNavigateToFriends}>
                        Add Friends
                      </button>
                    ) : undefined
                  }
                />
              )}
            </div>

            <aside className="rh-afs-sidecard">
              <p className="rh-afs-sidecard__eyebrow">Social Radar</p>
              <h2 className="rh-afs-sidecard__title">What this rail tracks</h2>
              <div className="rh-afs-sidecard__list">
                <div className="rh-afs-sidecard__item">
                  <strong>Head-to-head results</strong>
                  <span>Wins and losses from ranked matches surface immediately.</span>
                </div>
                <div className="rh-afs-sidecard__item">
                  <strong>Daily competition</strong>
                  <span>Daily Fritz and puzzle progress keep the social loop active between matches.</span>
                </div>
                <div className="rh-afs-sidecard__item">
                  <strong>Momentum signals</strong>
                  <span>Streaks and tournament placements highlight who is rising in your circle.</span>
                </div>
              </div>
              <div className="rh-afs-sidecard__footer">
                <div className="rh-afs-sidecard__metric">
                  <span className="rh-afs-sidecard__metric-label">Tournament moments</span>
                  <strong>{summary.tournaments}</strong>
                </div>
                <div className="rh-afs-sidecard__metric">
                  <span className="rh-afs-sidecard__metric-label">Feed status</span>
                  <strong>{user ? 'Live' : 'Guest'}</strong>
                </div>
              </div>
            </aside>
          </section>
        </main>
      </div>
    </div>
  );
}
