import { useCallback, useEffect, useMemo, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { fetchActivityFeed, type FeedItem } from './socialApi';
import './activityFeed.css';

export type ActivityFeedFilterTab = 'all' | 'friends' | 'wins' | 'streaks' | 'tournaments' | 'mentions';

export const ACTIVITY_FEED_FILTER_TABS: { id: ActivityFeedFilterTab; label: string }[] = [
  { id: 'all', label: 'All Activity' },
  { id: 'friends', label: 'Friends' },
  { id: 'wins', label: 'Wins' },
  { id: 'streaks', label: 'Streaks' },
  { id: 'tournaments', label: 'Tournaments' },
  { id: 'mentions', label: 'Mentions' },
];

function initials(username: string): string {
  const parts = username.replace(/[^a-zA-Z0-9]/g, ' ').split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return username.slice(0, 2).toUpperCase();
}

interface ActivityFeedFilterTabsProps {
  filter: ActivityFeedFilterTab;
  onFilterChange: (filter: ActivityFeedFilterTab) => void;
}

export function ActivityFeedFilterTabs({ filter, onFilterChange }: ActivityFeedFilterTabsProps) {
  return (
    <nav
      className="rh-af-filters social-tabs-row social-filter-tabs"
      role="tablist"
      aria-label="Activity filters"
    >
      {ACTIVITY_FEED_FILTER_TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={filter === tab.id}
          className={`rh-af-filter social-filter-tab${filter === tab.id ? ' rh-af-filter--active active' : ''}`}
          onClick={() => onFilterChange(tab.id)}
        >
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

interface FeedRowCopy {
  action: string;
  detail: string | null;
  pill: string;
  icon: string;
  accent: 'win' | 'loss' | 'streak' | 'tournament' | 'fritz' | 'puzzle' | 'mention';
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

function feedModeKey(mode: unknown): 'fritz' | 'ranked' {
  const value = typeof mode === 'string' ? mode.toLowerCase() : '';
  if (value.includes('fritz') || value === 'bot' || value === 'daily_fritz') return 'fritz';
  return 'ranked';
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
        detail: score ? `${score} 🏆` : '🏆',
        pill: `${formatMode(meta.mode)}${tilesSuffix(meta) || ' • Ranked'}`,
        icon: '🏆',
        accent: 'win',
      };
    }
    case 'loss': {
      const opp = meta.opponent_username as string | undefined;
      return {
        action: `lost vs ${opp ?? 'opponent'}`,
        detail:
          meta.score != null && meta.opponent_score != null
            ? `${meta.score}–${meta.opponent_score}`
            : null,
        pill: `${formatMode(meta.mode)}${tilesSuffix(meta) || ' • Ranked'}`,
        icon: '•',
        accent: 'loss',
      };
    }
    case 'streak': {
      const n = meta.streak as number | undefined;
      return {
        action: `${n ?? '?'} win streak`,
        detail: null,
        pill: meta.source === 'puzzle' ? 'Daily Puzzle' : 'Play vs Fritz',
        icon: '🔥',
        accent: 'streak',
      };
    }
    case 'tournament': {
      const p = meta.placement as string | undefined;
      return {
        action: String(meta.tournament_name ?? 'Tournament'),
        detail: p ?? 'Placement posted',
        pill: 'Tournament Result',
        icon: '🏆',
        accent: 'tournament',
      };
    }
    case 'puzzle': {
      const s = meta.score as number | undefined;
      return {
        action: 'completed daily puzzle',
        detail: s != null ? `${s} pts` : null,
        pill: 'Daily Puzzle',
        icon: '◆',
        accent: 'puzzle',
      };
    }
    case 'daily_fritz': {
      const result = meta.result as string | undefined;
      const gameNumber = meta.game_number as number | undefined;
      const playerScore = meta.player_score as number | undefined;
      const fritzScore = meta.fritz_score as number | undefined;
      const scoreline =
        playerScore != null && fritzScore != null ? `${playerScore}-${fritzScore}` : null;
      const legacyScore = meta.score as number | undefined;
      const verb = result === 'win' ? 'won' : 'lost';
      const ptsDetail =
        scoreline
          ?? (legacyScore != null ? `${legacyScore} pts` : null);
      return {
        action:
          gameNumber != null && scoreline
            ? `${verb} Game ${gameNumber} vs Daily Fritz`
            : `${verb} to Daily Fritz`,
        detail:
          ptsDetail && result === 'win'
            ? `${ptsDetail} 🏆`
            : ptsDetail,
        pill: scoreline ? 'Daily Fritz · Elite' : 'Daily Fritz · Elite',
        icon: result === 'win' ? '🏆' : '•',
        accent: result === 'win' ? 'win' : 'loss',
      };
    }
    default:
      return {
        action: 'posted an update',
        detail: null,
        pill: 'Racehorse',
        icon: '•',
        accent: 'mention',
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
      <div className="rh-af-feed-card rh-social-card social-feed-panel-surface">
        <div className="rh-af-feed social-feed-scroll">
          {loading && <p className="rh-af-status">Loading activity…</p>}
          {!loading && error && <p className="rh-af-status rh-af-status--error">{error}</p>}
          {!loading && !error && filtered.length === 0 && (
            <div className="rh-af-empty">
              <p>
                {filter === 'mentions'
                  ? 'Mentions will appear here when friends tag you in updates.'
                  : 'No activity matches this filter yet.'}
              </p>
              {emptyAction}
            </div>
          )}
          {!loading && !error && visibleItems.map((item) => {
            const copy = feedRowCopy(item);
            const modeKey = item.type === 'win' || item.type === 'loss'
              ? feedModeKey(item.metadata.mode)
              : undefined;
            return (
              <article
                key={item.id}
                className="rh-af-row rh-activity-row"
                data-feed-type={item.type}
                data-feed-mode={modeKey}
                data-feed-accent={copy.accent}
                data-event={
                  copy.accent === 'fritz' || copy.accent === 'puzzle'
                    ? copy.accent === 'puzzle'
                      ? 'puzzle'
                      : 'win'
                    : copy.accent === 'mention'
                      ? 'social'
                      : copy.accent
                }
              >
                <button
                  type="button"
                  className="rh-af-row-avatar rh-social-avatar"
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
                    {copy.detail ? <span className="rh-af-row-score">{copy.detail}</span> : null}
                    {!copy.detail && copy.icon !== '•' ? (
                      <span className="rh-af-row-badge" aria-hidden="true">{copy.icon}</span>
                    ) : null}
                  </p>
                  <div className="rh-af-row-secondary-wrap">
                    <span className="rh-af-row-secondary rh-activity-pill">{copy.pill}</span>
                  </div>
                </div>
                <time className="rh-af-row-time" dateTime={item.created_at}>
                  {timeAgo(item.created_at)}
                </time>
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
                Load More
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
