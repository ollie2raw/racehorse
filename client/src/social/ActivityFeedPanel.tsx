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

interface FeedRowCopy {
  action: string;
  secondary: string;
  score: string | null;
  badge: string | null;
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

function tilesSuffix(meta: Record<string, unknown>): string {
  const tiles = meta.tiles ?? meta.hand_size ?? meta.tile_count;
  if (tiles == null || tiles === '') return '';
  return ` • ${tiles} Tiles`;
}

function itemAccent(type: FeedItem['type']): string {
  switch (type) {
    case 'win':
      return 'var(--tier-elite)';
    case 'loss':
      return 'color-mix(in srgb, var(--tier-elite) 55%, transparent)';
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

function feedRowCopy(item: FeedItem): FeedRowCopy {
  const meta = item.metadata;

  switch (item.type) {
    case 'win': {
      const opp = meta.opponent_username as string | undefined;
      const score =
        meta.score != null && meta.opponent_score != null
          ? `${meta.score}–${meta.opponent_score}`
          : null;
      return {
        action: `won vs ${opp ?? 'opponent'}`,
        secondary: `${formatMode(meta.mode)}${tilesSuffix(meta)}`,
        score,
        badge: '🏆',
      };
    }
    case 'loss': {
      const opp = meta.opponent_username as string | undefined;
      return {
        action: `lost vs ${opp ?? 'opponent'}`,
        secondary: `${formatMode(meta.mode)}${tilesSuffix(meta)}`,
        score: null,
        badge: null,
      };
    }
    case 'streak': {
      const n = meta.streak as number | undefined;
      return {
        action: `${n ?? '?'} win streak`,
        secondary: meta.source === 'puzzle' ? 'Daily Puzzle' : 'Play vs Fritz',
        score: null,
        badge: '🔥',
      };
    }
    case 'tournament': {
      const p = meta.placement as string | undefined;
      return {
        action: p ?? 'Tournament placement',
        secondary: String(meta.tournament_name ?? 'Tournament'),
        score: null,
        badge: null,
      };
    }
    case 'puzzle': {
      const s = meta.score as number | undefined;
      return {
        action: 'completed daily puzzle',
        secondary: s != null ? `Daily Puzzle · ${s} pts` : 'Daily Puzzle',
        score: null,
        badge: null,
      };
    }
    case 'daily_fritz': {
      const result = meta.result as string | undefined;
      const s = meta.score as number | undefined;
      const verb = result === 'win' ? 'beat' : 'lost to';
      return {
        action: `${verb} Daily Fritz`,
        secondary: s != null ? `Play vs Fritz · ${s} pts` : 'Play vs Fritz',
        score: null,
        badge: result === 'win' ? '🏆' : '🎁',
      };
    }
    default:
      return {
        action: 'posted an update',
        secondary: 'Racehorse',
        score: null,
        badge: null,
      };
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
  const showLoadMore = !loading && !error && visible.length > 0;

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

      <div className="rh-af-feed-card">
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
            const copy = feedRowCopy(item);
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
                    <span className="rh-af-row-action">{copy.action}</span>
                    {copy.score ? <span className="rh-af-row-score">{copy.score}</span> : null}
                    {copy.badge ? <span className="rh-af-row-badge" aria-hidden="true">{copy.badge}</span> : null}
                  </p>
                  <p className="rh-af-row-secondary">{copy.secondary}</p>
                </div>
                <time className="rh-af-row-time" dateTime={item.created_at}>
                  {timeAgo(item.created_at)}
                </time>
              </article>
            );
          })}
        </div>

        {showLoadMore ? (
          <button
            type="button"
            className="rh-af-load-more"
            disabled={!canLoadMore}
            onClick={() => {
              if (canLoadMore) setVisibleCount((count) => count + PAGE_SIZE);
            }}
          >
            Load More
          </button>
        ) : null}
      </div>
    </div>
  );
}
