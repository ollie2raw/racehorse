import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { User } from '@supabase/supabase-js';
import { fetchActivityFeed, type FeedItem } from './socialApi';
import {
  buildFeedRowViewModel,
  type FeedBadgeTone,
  type FeedIconKind,
} from './activityFeedRowModel';
import './activityFeed.css';

export type ActivityFeedFilterTab = 'all' | 'friends' | 'wins' | 'streaks' | 'tournaments' | 'mentions';

const FILTER_TABS: { id: ActivityFeedFilterTab; label: string; icon: FeedIconKind | 'friends' | 'mention' }[] = [
  { id: 'all', label: 'All Activity', icon: 'medal' },
  { id: 'friends', label: 'Friends', icon: 'friends' },
  { id: 'wins', label: 'Wins', icon: 'trophy' },
  { id: 'streaks', label: 'Streaks', icon: 'flame' },
  { id: 'tournaments', label: 'Tournaments', icon: 'crown' },
  { id: 'mentions', label: 'Mentions', icon: 'mention' },
];

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

function FilterTabIcon({ kind }: { kind: (typeof FILTER_TABS)[number]['icon'] }) {
  const common = { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true as const };
  switch (kind) {
    case 'friends':
      return (
        <svg {...common}>
          <path d="M16 11c1.66 0 3-1.34 3-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3ZM8 11c1.66 0 3-1.34 3-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3Zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5C15 14.17 10.33 13 8 13Zm8 0c-.29 0-.62.02-.97.06 1.16.84 1.97 1.97 1.97 3.44V19h6v-2.5c0-2.33-4.67-3.5-7-3.5Z" fill="currentColor" />
        </svg>
      );
    case 'trophy':
      return (
        <svg {...common}>
          <path d="M8 4h8v2a4 4 0 0 0 4 4h1v2a5 5 0 0 1-5 5h-1v3H9v-3H8a5 5 0 0 1-5-5V10h1a4 4 0 0 0 4-4V4Z" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      );
    case 'flame':
      return (
        <svg {...common}>
          <path d="M12 3s-4 4.5-4 8a4 4 0 0 0 8 0c0-2-1.5-3.5-2-4.5.5 1 1.5 2.5 1.5 4a2.5 2.5 0 0 1-5 0c0-2.5 2-5.5 2-5.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
      );
    case 'crown':
      return (
        <svg {...common}>
          <path d="M5 18h14l-1.2-9-3.3 3.5L12 6 9.5 12.5 6.2 9 5 18Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
      );
    case 'mention':
      return (
        <svg {...common}>
          <path d="M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12Zm0-8v4m0 4h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case 'medal':
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.6" />
          <path d="M8 12h8M12 8v8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
  }
}

function FeedCategoryIcon({ kind }: { kind: FeedIconKind }) {
  const cls = `rh-af-rich-cat rh-af-rich-cat--${kind}`;
  const common = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true as const };
  switch (kind) {
    case 'trophy':
      return (
        <span className={cls}>
          <svg {...common}><path d="M8 4h8v2a4 4 0 0 0 4 4h1v2a5 5 0 0 1-5 5h-1v3H9v-3H8a5 5 0 0 1-5-5V10h1a4 4 0 0 0 4-4V4Z" stroke="currentColor" strokeWidth="1.6" /></svg>
        </span>
      );
    case 'puzzle':
      return (
        <span className={cls}>
          <svg {...common}><path d="M8 8h3V5H8v3Zm5 0h3V5h-3v3ZM8 16h3v3H8v-3Zm5 0h3v3h-3v-3Z" fill="currentColor" /></svg>
        </span>
      );
    case 'flame':
      return (
        <span className={cls}>
          <svg {...common}><path d="M12 3s-4 4.5-4 8a4 4 0 0 0 8 0c0-2-1.5-3.5-2-4.5.5 1 1.5 2.5 1.5 4a2.5 2.5 0 0 1-5 0c0-2.5 2-5.5 2-5.5Z" stroke="currentColor" strokeWidth="1.6" /></svg>
        </span>
      );
    case 'medal':
    case 'crown':
      return (
        <span className={cls}>
          <svg {...common}><path d="M5 18h14l-1.2-9-3.3 3.5L12 6 9.5 12.5 6.2 9 5 18Z" stroke="currentColor" strokeWidth="1.6" /></svg>
        </span>
      );
    case 'swords':
      return (
        <span className={cls}>
          <svg {...common}><path d="m4 20 8-8m4-4 4-4m0 8 4 4M14 6l4-4m-6 14-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        </span>
      );
    case 'robot':
      return (
        <span className={cls}>
          <svg {...common}><rect x="6" y="8" width="12" height="10" rx="2" stroke="currentColor" strokeWidth="1.6" /><circle cx="10" cy="13" r="1" fill="currentColor" /><circle cx="14" cy="13" r="1" fill="currentColor" /><path d="M12 4v4" stroke="currentColor" strokeWidth="1.6" /></svg>
        </span>
      );
    case 'mention':
    default:
      return (
        <span className={cls}>
          <svg {...common}><path d="M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Zm-4 4v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        </span>
      );
  }
}

function badgeClass(tone: FeedBadgeTone): string {
  return `rh-af-rich-badge rh-af-rich-badge--${tone}`;
}

interface ActivityFeedFilterTabsProps {
  filter: ActivityFeedFilterTab;
  onFilterChange: (filter: ActivityFeedFilterTab) => void;
}

export function ActivityFeedFilterTabs({ filter, onFilterChange }: ActivityFeedFilterTabsProps) {
  return (
    <nav className="rh-af-filters social-tabs-row" role="tablist" aria-label="Activity filters">
      {FILTER_TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={filter === tab.id}
          className={`rh-af-filter social-filter-tab${filter === tab.id ? ' rh-af-filter--active active' : ''}`}
          onClick={() => onFilterChange(tab.id)}
        >
          <span className="rh-af-filter-icon">
            <FilterTabIcon kind={tab.icon} />
          </span>
          {tab.label}
        </button>
      ))}
    </nav>
  );
}

interface ActivityFeedPanelProps {
  user: User | null;
  filter: ActivityFeedFilterTab;
  friendUsernames?: Set<string>;
  onViewProfile: (username: string) => void;
  emptyAction?: React.ReactNode;
  onFeedChange?: (feed: FeedItem[]) => void;
}

function timeAgo(isoDate: string): string {
  const ms = Date.now() - new Date(isoDate).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function filterItems(
  items: FeedItem[],
  filter: ActivityFeedFilterTab,
  friendUsernames: Set<string>,
): FeedItem[] {
  switch (filter) {
    case 'wins':
      return items.filter((item) => item.type === 'win');
    case 'streaks':
      return items.filter((item) => item.type === 'streak');
    case 'tournaments':
      return items.filter((item) => item.type === 'tournament');
    case 'friends':
      return items.filter((item) => friendUsernames.has(item.username.toLowerCase()));
    case 'mentions':
      return [];
    default:
      return items;
  }
}

export default function ActivityFeedPanel({
  user,
  filter,
  friendUsernames = new Set(),
  onViewProfile,
  emptyAction,
  onFeedChange,
}: ActivityFeedPanelProps) {
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(10);

  const load = useCallback(async () => {
    if (!user) {
      onFeedChange?.([]);
      return;
    }
    setLoading(true);
    const result = await fetchActivityFeed();
    setLoading(false);
    if (result.error) {
      setError(result.error);
      onFeedChange?.([]);
      return;
    }
    setFeed(result.feed);
    setVisibleCount(10);
    onFeedChange?.(result.feed);
  }, [onFeedChange, user]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(
    () => filterItems(feed, filter, friendUsernames),
    [feed, filter, friendUsernames],
  );
  const visibleItems = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);
  const canLoadMore = visibleCount < filtered.length;

  return (
    <div className="rh-af-panel social-feed-panel">
      <div className="rh-af-feed-card rh-social-card">
        <div className="rh-af-feed social-feed-scroll">
          {loading && (
            <div className="rh-af-status rh-af-status--loading" aria-live="polite">
              <span className="rh-af-status-kicker">Loading</span>
              <strong>Building your social feed…</strong>
              <p>Recent wins, rival updates, and tournament results will appear here.</p>
            </div>
          )}
          {!loading && error && (
            <div className="rh-af-status rh-af-status--error" role="alert">
              <span className="rh-af-status-kicker">Feed unavailable</span>
              <strong>{error}</strong>
              <button type="button" className="rh-af-status-btn" onClick={() => void load()}>
                Retry
              </button>
            </div>
          )}
          {!loading && !error && filtered.length === 0 && (
            <div className="rh-af-empty">
              <span className="rh-af-status-kicker">No activity yet</span>
              <strong>
                {filter === 'mentions'
                  ? 'Mentions will show up here when rivals tag you.'
                  : 'Play a match or follow rivals to start your feed.'}
              </strong>
              <p>
                {filter === 'mentions'
                  ? 'Follow active players to turn this into a real conversation.'
                  : 'Wins, streaks, Daily Fritz runs, and tournament results will land here first.'}
              </p>
              {emptyAction}
            </div>
          )}
          {!loading && !error && visibleItems.map((item) => {
            const vm = buildFeedRowViewModel(item);
            const hue = avatarHue(item.username);
            return (
              <article key={item.id} className="rh-af-rich-row" data-feed-type={item.type}>
                <button
                  type="button"
                  className="rh-af-rich-avatar"
                  style={{ ['--rh-af-avatar-hue' as string]: String(hue) } as CSSProperties}
                  onClick={() => onViewProfile(item.username)}
                  aria-label={`View ${item.username}'s profile`}
                >
                  {initials(item.username)}
                </button>
                <FeedCategoryIcon kind={vm.icon} />
                <div className="rh-af-rich-main">
                  <p className="rh-af-rich-line">
                    <button type="button" className="rh-af-rich-user" onClick={() => onViewProfile(item.username)}>
                      {item.username}
                    </button>
                    <span className="rh-af-rich-action">{vm.action}</span>
                  </p>
                  <div className="rh-af-rich-meta">
                    {vm.modeBadge ? (
                      <span className={badgeClass(vm.modeBadge.tone)}>{vm.modeBadge.label}</span>
                    ) : null}
                    <p className="rh-af-rich-secondary">{vm.secondary}</p>
                  </div>
                </div>
                <div className="rh-af-rich-stats">
                  {vm.scoreLine ? <span className="rh-af-rich-score">{vm.scoreLine}</span> : null}
                  {vm.pointsLine ? <span className="rh-af-rich-points">{vm.pointsLine}</span> : null}
                  {vm.ratingDelta ? <span className="rh-af-rich-delta">{vm.ratingDelta}</span> : null}
                  {vm.streakCount ? (
                    <span className="rh-af-rich-streaks" aria-label={`${vm.streakCount} win streak`}>
                      {Array.from({ length: vm.streakCount }, (_, i) => (
                        <span key={i} className="rh-af-rich-streak-dot" aria-hidden="true">✓</span>
                      ))}
                    </span>
                  ) : null}
                  {vm.badge ? (
                    <span className={badgeClass(vm.badge.tone)}>{vm.badge.label}</span>
                  ) : null}
                  {vm.showViewButton ? (
                    <button type="button" className="rh-af-rich-view-btn">View</button>
                  ) : null}
                </div>
                <div className="rh-af-rich-end">
                  <time dateTime={item.created_at}>{timeAgo(item.created_at)}</time>
                  <span className="rh-af-rich-chevron" aria-hidden="true">›</span>
                </div>
              </article>
            );
          })}
          {!loading && !error && canLoadMore ? (
            <div className="rh-af-load-more-wrap">
              <button
                type="button"
                className="rh-af-load-more"
                onClick={() => setVisibleCount((count) => count + 10)}
              >
                Load Older Activity
                <span className="rh-af-load-more-chevron" aria-hidden="true">⌄</span>
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
