import { useCallback, useEffect, useMemo, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { fetchActivityFeed, type FeedItem } from './socialApi';
import {
  buildFeedRowViewModel,
  type FeedIconKind,
  type FeedRowViewModel,
} from './activityFeedRowModel';
import './activityFeed.css';
import './socialBoard.css';

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

type BoardOutcome = 'win' | 'loss' | 'neutral';

const BOARD_MODE_LABEL: Record<FeedItem['type'], string> = {
  win: 'Match',
  loss: 'Match',
  streak: 'Streak',
  tournament: 'Tournament',
  puzzle: 'Puzzle Rush',
  daily_fritz: 'Daily Fritz',
};

/** Everything the board's five-column row needs, derived from the shared
 *  view model plus the raw item — outcome tone, a signed margin, a plain
 *  mode label. No new data fetch; same metadata the feed already carries. */
function boardRow(item: FeedItem, vm: FeedRowViewModel): {
  modeLabel: string;
  outcome: BoardOutcome;
  margin: string | undefined;
  badge: { label: string; kind: 'skunk' | 'win' | 'loss' | 'neutral' } | undefined;
} {
  const meta = item.metadata;
  const won =
    item.type === 'win' ||
    meta.won === true ||
    meta.result === 'win' ||
    (item.type === 'tournament' && String(meta.placement ?? '').toLowerCase().includes('1st'));
  const lost = item.type === 'loss' || meta.won === false || meta.result === 'loss';
  const outcome: BoardOutcome = won ? 'win' : lost ? 'loss' : 'neutral';

  let margin: string | undefined;
  const a = Number(meta.score ?? meta.player_score);
  const b = Number(meta.opponent_score ?? meta.fritz_score);
  if (Number.isFinite(a) && Number.isFinite(b)) {
    const diff = a - b;
    margin = `${diff > 0 ? '+' : diff < 0 ? '−' : ''}${Math.abs(diff)}`;
  } else if (vm.ratingDelta) {
    margin = vm.ratingDelta;
  } else if (vm.pointsLine) {
    margin = vm.pointsLine;
  }

  let badge: { label: string; kind: 'skunk' | 'win' | 'loss' | 'neutral' } | undefined;
  const src = vm.badge ?? vm.modeBadge;
  if (src) {
    const kind =
      src.tone === 'skunk' || (src.tone === 'gold' && /skunk/i.test(src.label))
        ? 'skunk'
        : outcome === 'win'
          ? 'win'
          : outcome === 'loss'
            ? 'loss'
            : 'neutral';
    badge = { label: src.label, kind };
  }

  return {
    modeLabel: vm.modeBadge?.label ?? BOARD_MODE_LABEL[item.type],
    outcome,
    margin,
    badge,
  };
}

interface ActivityFeedFilterTabsProps {
  filter: ActivityFeedFilterTab;
  onFilterChange: (filter: ActivityFeedFilterTab) => void;
}

export function ActivityFeedFilterTabs({ filter, onFilterChange }: ActivityFeedFilterTabsProps) {
  return (
    <nav className="rh-sb-filters" role="tablist" aria-label="Activity filters">
      {FILTER_TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={filter === tab.id}
          className="rh-sb-filter"
          onClick={() => onFilterChange(tab.id)}
        >
          <span className="rh-sb-filter__icon" aria-hidden="true">
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
  /** Lower/exact handle of the signed-in player — the row that matches
   *  gets the gold left bar. Best-effort; absent just means no self row. */
  selfUsername?: string;
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

function feedItemsEqual(a: FeedItem[], b: FeedItem[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index];
    const right = b[index];
    if (
      left.id !== right.id ||
      left.username !== right.username ||
      left.type !== right.type ||
      left.created_at !== right.created_at
    ) {
      return false;
    }
  }
  return true;
}

export default function ActivityFeedPanel({
  user,
  filter,
  friendUsernames = new Set(),
  selfUsername,
  onViewProfile,
  emptyAction,
  onFeedChange,
}: ActivityFeedPanelProps) {
  const selfHandle = selfUsername?.toLowerCase() ?? null;
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
    setFeed((current) => (feedItemsEqual(current, result.feed) ? current : result.feed));
    setVisibleCount((current) => (current === 10 ? current : 10));
    onFeedChange?.(result.feed);
  }, [onFeedChange, user]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(
    () => filterItems(feed, filter, friendUsernames),
    [feed, filter, friendUsernames],
  );
  const visibleItems = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);
  const canLoadMore = visibleCount < filtered.length;

  if (loading) {
    return (
      <section className="rh-sb-table" aria-label="Activity feed">
        <div className="rh-sb-feed-state" aria-live="polite">
          <span className="rh-sb-feed-state__kicker">Loading</span>
          <strong>Building your social feed…</strong>
          <p>Recent wins, rival updates, and tournament results will appear here.</p>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="rh-sb-table" aria-label="Activity feed">
        <div className="rh-sb-feed-state" role="alert">
          <span className="rh-sb-feed-state__kicker">Feed unavailable</span>
          <strong>{error}</strong>
          <p>
            <button type="button" className="rh-sb-btn" onClick={() => void load()}>Retry</button>
          </p>
        </div>
      </section>
    );
  }

  if (filtered.length === 0) {
    return (
      <section className="rh-sb-table" aria-label="Activity feed">
        <div className="rh-sb-feed-state">
          <span className="rh-sb-feed-state__kicker">No activity yet</span>
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
      </section>
    );
  }

  return (
    <section className="rh-sb-table" aria-label="Activity feed">
      <div className="rh-sb-thead rh-sb-row-grid" aria-hidden="true">
        <span>Who</span>
        <span>What happened</span>
        <span>Score</span>
        <span>Mode</span>
        <span className="rh-sb-thead__when">When</span>
      </div>

      {visibleItems.map((item) => {
        const vm = buildFeedRowViewModel(item);
        const row = boardRow(item, vm);
        const isSelf = selfHandle != null && item.username.toLowerCase() === selfHandle;
        const outcomeClass =
          row.outcome === 'win' ? ' is-win' : row.outcome === 'loss' ? ' is-loss' : '';
        return (
          <button
            type="button"
            key={item.id}
            className={`rh-sb-row rh-sb-row-grid${isSelf ? ' rh-sb-row--self' : ''}`}
            onClick={() => onViewProfile(item.username)}
          >
            <span className="rh-sb-who">
              <span
                className="rh-sb-avatar"
                aria-hidden="true"
                style={{ '--rh-sb-avatar-hue': String(avatarHue(item.username)) } as React.CSSProperties}
              >
                {initials(item.username)}
              </span>
              <span className="rh-sb-who__copy">
                <span className="rh-sb-who__name">
                  <span className="rh-sb-who__handle">{item.username}</span>
                  {isSelf ? <span className="rh-sb-you">You</span> : null}
                </span>
                <span className="rh-sb-who__meta">{row.modeLabel}</span>
              </span>
            </span>

            <span className="rh-sb-what">
              {vm.action}
              {row.badge ? (
                <span className={`rh-sb-badge rh-sb-badge--${row.badge.kind}`}>{row.badge.label}</span>
              ) : null}
              {vm.secondary ? (
                <span className={`rh-sb-what__sub${row.badge?.kind === 'skunk' ? ' is-accent' : outcomeClass}`}>
                  {vm.secondary}
                </span>
              ) : null}
            </span>

            <span className="rh-sb-score">
              {vm.scoreLine ? (
                <span className="rh-sb-score__line">{vm.scoreLine.replace(' - ', '–')}</span>
              ) : null}
              {row.margin ? (
                <span
                  className={`rh-sb-score__margin${
                    row.badge?.kind === 'skunk' ? ' is-accent' : outcomeClass
                  }`}
                >
                  {row.margin}
                </span>
              ) : null}
            </span>

            <span>
              <span className="rh-sb-mode">{row.modeLabel}</span>
            </span>

            <span className="rh-sb-when">
              <time dateTime={item.created_at}>{timeAgo(item.created_at).replace(' ago', '')}</time>
            </span>
          </button>
        );
      })}

      {canLoadMore ? (
        <div className="rh-sb-tfoot">
          <button
            type="button"
            className="rh-sb-btn"
            onClick={() => setVisibleCount((count) => count + 10)}
          >
            Load earlier activity
          </button>
        </div>
      ) : null}
    </section>
  );
}
