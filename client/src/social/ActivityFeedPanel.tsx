import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { User } from '@supabase/supabase-js';
import { fetchActivityFeed, type FeedItem } from './socialApi';
import './activityFeed.css';

type FilterTab = 'all' | 'friends' | 'wins' | 'streaks' | 'tournaments' | 'mentions';

const FILTER_TABS: { id: FilterTab; label: string }[] = [
  { id: 'all', label: 'All Activity' },
  { id: 'friends', label: 'Friends' },
  { id: 'wins', label: 'Wins' },
  { id: 'streaks', label: 'Streaks' },
  { id: 'tournaments', label: 'Tournaments' },
  { id: 'mentions', label: 'Mentions' },
];

const PAGE_SIZE = 8;

function initials(username: string): string {
  const parts = username.replace(/[^a-zA-Z0-9]/g, ' ').split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return username.slice(0, 2).toUpperCase();
}

interface ActivityFeedPanelProps {
  user: User | null;
  friendUsernames?: Set<string>;
  onViewProfile: (username: string) => void;
  emptyAction?: React.ReactNode;
  onFeedChange?: (feed: FeedItem[]) => void;
}

function formatMode(mode: unknown): string {
  const value = typeof mode === 'string' ? mode.toLowerCase() : '';
  if (value.includes('fritz') || value === 'bot' || value === 'daily_fritz') return 'Play vs Fritz';
  if (value.includes('puzzle')) return 'Daily Puzzle';
  if (value.includes('ranked')) return 'Ranked Match';
  if (value.includes('tournament')) return 'Tournament';
  if (value.includes('multi')) return 'Multiplayer';
  if (!value) return 'Racehorse';
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function itemAccent(type: FeedItem['type']): string {
  switch (type) {
    case 'win':
      return 'var(--tier-elite)';
    case 'loss':
      return 'rgba(231, 182, 74, 0.55)';
    case 'streak':
      return 'var(--tier-rookie)';
    case 'tournament':
      return 'var(--tier-master)';
    case 'puzzle':
      return 'var(--tier-standard)';
    case 'daily_fritz':
      return 'var(--tier-elite)';
    default:
      return 'var(--text-dim)';
  }
}

function itemAction(item: FeedItem): string {
  const meta = item.metadata;
  switch (item.type) {
    case 'win': {
      const opp = meta.opponent_username as string | undefined;
      const score = meta.score != null && meta.opponent_score != null
        ? ` ${meta.score}–${meta.opponent_score}`
        : '';
      return `won vs ${opp ?? 'opponent'}${score}`;
    }
    case 'loss': {
      const opp = meta.opponent_username as string | undefined;
      return `lost vs ${opp ?? 'opponent'}`;
    }
    case 'streak': {
      const n = meta.streak as number | undefined;
      return `hit a ${n ?? '?'} win streak`;
    }
    case 'tournament': {
      const p = meta.placement as string | undefined;
      return `placed ${p ?? 'in a tournament'}`;
    }
    case 'puzzle': {
      const s = meta.score as number | undefined;
      return `solved daily puzzle${s != null ? ` · ${s} pts` : ''}`;
    }
    case 'daily_fritz': {
      const result = meta.result as string | undefined;
      const s = meta.score as number | undefined;
      const verb = result === 'win' ? 'beat' : 'lost to';
      return `${verb} Daily Fritz${s != null ? ` · ${s} pts` : ''}`;
    }
    default:
      return 'posted an update';
  }
}

function itemContext(item: FeedItem): string {
  const meta = item.metadata;
  switch (item.type) {
    case 'win':
    case 'loss':
      return formatMode(meta.mode);
    case 'puzzle':
      return meta.score != null ? `Daily Puzzle · ${meta.score} pts` : 'Daily Puzzle';
    case 'daily_fritz':
      return meta.score != null ? `Play vs Fritz · ${meta.score} pts` : 'Play vs Fritz';
    case 'streak':
      return meta.source === 'puzzle' ? 'Daily Puzzle streak' : 'Win streak';
    case 'tournament':
      return String(meta.tournament_name ?? 'Tournament');
    default:
      return 'Racehorse';
  }
}

function itemBadge(type: FeedItem['type']): string | null {
  switch (type) {
    case 'win':
      return '🏆';
    case 'daily_fritz':
      return '🎁';
    case 'streak':
      return '🔥';
    default:
      return null;
  }
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
  filter: FilterTab,
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
  friendUsernames = new Set(),
  onViewProfile,
  emptyAction,
  onFeedChange,
}: ActivityFeedPanelProps) {
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterTab>('all');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

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
    onFeedChange?.(result.feed);
  }, [onFeedChange, user]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [filter]);

  const filtered = useMemo(
    () => filterItems(feed, filter, friendUsernames),
    [feed, filter, friendUsernames],
  );

  const visible = filtered.slice(0, visibleCount);
  const canLoadMore = visible.length < filtered.length;

  return (
    <div className="rh-af-panel">
      <div className="rh-af-filters" role="tablist" aria-label="Activity filters">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={filter === tab.id}
            className={`rh-af-filter${filter === tab.id ? ' rh-af-filter--active' : ''}`}
            onClick={() => setFilter(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="rh-af-feed">
        {loading && <p className="rh-af-status">Loading activity…</p>}
        {!loading && error && <p className="rh-af-status rh-af-status--error">{error}</p>}
        {!loading && !error && visible.length === 0 && (
          <div className="rh-af-empty">
            <p>
              {filter === 'mentions'
                ? 'Mentions will appear here when friends tag you in updates.'
                : 'No activity matches this filter yet.'}
            </p>
            {emptyAction}
          </div>
        )}
        {!loading && !error && visible.map((item) => {
          const badge = itemBadge(item.type);
          return (
            <article
              key={item.id}
              className="rh-af-row"
              style={{ ['--rh-af-accent' as string]: itemAccent(item.type) } as CSSProperties}
            >
              <button
                type="button"
                className="rh-af-row-avatar"
                onClick={() => onViewProfile(item.username)}
                aria-label={`View ${item.username}'s profile`}
              >
                {initials(item.username)}
              </button>
              <div className="rh-af-row-body">
                <p className="rh-af-row-primary">
                  <button
                    type="button"
                    className="rh-af-row-user"
                    onClick={() => onViewProfile(item.username)}
                  >
                    {item.username}
                  </button>
                  <span>{itemAction(item)}</span>
                  {badge ? <span className="rh-af-row-badge" aria-hidden="true">{badge}</span> : null}
                </p>
                <p className="rh-af-row-secondary">{itemContext(item)}</p>
              </div>
              <time className="rh-af-row-time" dateTime={item.created_at}>
                {timeAgo(item.created_at)}
              </time>
            </article>
          );
        })}
      </div>

      {!loading && !error && canLoadMore ? (
        <button
          type="button"
          className="rh-af-load-more"
          onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
        >
          Load More
        </button>
      ) : null}
    </div>
  );
}
