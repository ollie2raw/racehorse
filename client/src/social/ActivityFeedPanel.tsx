import { useEffect, useState, useCallback } from 'react';
import type { CSSProperties } from 'react';
import type { User } from '@supabase/supabase-js';
import { fetchActivityFeed, type FeedItem } from './socialApi';
import './activityFeed.css';

type FilterTab = 'all' | 'wins' | 'streaks' | 'tournaments';

function initials(username: string): string {
  const parts = username.replace(/[^a-zA-Z0-9]/g, ' ').split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return username.slice(0, 2).toUpperCase();
}

interface ActivityFeedPanelProps {
  user: User | null;
  onViewProfile: (username: string) => void;
  emptyAction?: React.ReactNode;
  onFeedChange?: (feed: FeedItem[]) => void;
}

function itemIcon(type: FeedItem['type']): string {
  switch (type) {
    case 'win': return '🏆';
    case 'loss': return '—';
    case 'streak': return '🔥';
    case 'tournament': return '⚔️';
    case 'puzzle': return '🧩';
    case 'daily_fritz': return '🤖';
    default: return '•';
  }
}

function itemLabel(type: FeedItem['type']): string {
  switch (type) {
    case 'win': return 'Ranked Win';
    case 'loss': return 'Ranked Loss';
    case 'streak': return 'Streak';
    case 'tournament': return 'Tournament';
    case 'puzzle': return 'Puzzle';
    case 'daily_fritz': return 'Daily Fritz';
    default: return 'Activity';
  }
}

function itemAccent(type: FeedItem['type']): string {
  switch (type) {
    case 'win': return '#4A8FD4';
    case 'loss': return '#7C8AA6';
    case 'streak': return '#19D8A2';
    case 'tournament': return '#F2A63A';
    case 'puzzle': return '#D7A64A';
    case 'daily_fritz': return '#D7A64A';
    default: return '#A9B4C9';
  }
}

function itemDescription(item: FeedItem): string {
  const meta = item.metadata;
  switch (item.type) {
    case 'win': {
      const opp = meta.opponent_username as string | undefined;
      const score = meta.score != null ? ` · ${meta.score}–${meta.opponent_score}` : '';
      return `won vs ${opp ?? 'opponent'}${score}`;
    }
    case 'loss': {
      const opp = meta.opponent_username as string | undefined;
      return `lost vs ${opp ?? 'opponent'}`;
    }
    case 'streak': {
      const n = meta.streak as number | undefined;
      return `reached a ${n ?? '?'}-day streak`;
    }
    case 'tournament': {
      const p = meta.placement as string | undefined;
      return `finished ${p ?? 'a tournament'}`;
    }
    case 'puzzle': {
      const s = meta.score as number | undefined;
      return `completed daily puzzle${s != null ? ` · ${s} pts` : ''}`;
    }
    case 'daily_fritz': {
      const result = meta.result as string | undefined;
      const s = meta.score as number | undefined;
      return `${result === 'win' ? 'beat' : 'lost to'} Daily Fritz${s != null ? ` · ${s} pts` : ''}`;
    }
    default:
      return 'did something';
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

const FILTER_TABS: { id: FilterTab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'wins', label: 'Wins' },
  { id: 'streaks', label: 'Streaks' },
  { id: 'tournaments', label: 'Tournaments' },
];

function filterItems(items: FeedItem[], filter: FilterTab): FeedItem[] {
  if (filter === 'all') return items;
  if (filter === 'wins') return items.filter((i) => i.type === 'win');
  if (filter === 'streaks') return items.filter((i) => i.type === 'streak');
  if (filter === 'tournaments') return items.filter((i) => i.type === 'tournament');
  return items;
}

export default function ActivityFeedPanel({ user, onViewProfile, emptyAction, onFeedChange }: ActivityFeedPanelProps) {
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterTab>('all');

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

  const visible = filterItems(feed, filter);

  return (
    <div className="rh-af-panel">
      <div className="rh-af-filter-bar">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.id}
            className={`rh-af-filter-btn${filter === tab.id ? ' rh-af-filter-btn--active' : ''}`}
            onClick={() => setFilter(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="rh-af-list">
        {loading && (
          <div className="rh-af-state rh-af-state--rich">
            <div className="rh-af-state-card">
              <span className="rh-af-state-kicker">Social</span>
              <strong>Loading activity feed…</strong>
              <span>Pulling in recent wins, streaks, and tournament moments.</span>
            </div>
          </div>
        )}
        {!loading && error && (
          <div className="rh-af-state rh-af-state--rich">
            <div className="rh-af-state-card rh-af-state-card--error">
              <span className="rh-af-state-kicker">Feed unavailable</span>
              <strong>{error}</strong>
              <span>Try again in a moment.</span>
            </div>
          </div>
        )}
        {!loading && !error && visible.length === 0 && (
          <div className="rh-af-state rh-af-state--rich">
            <div className="rh-af-state-card">
              <span className="rh-af-state-kicker">Quiet board</span>
              <strong>No recent activity to show.</strong>
              <span>Add friends or finish a few matches to start building your social rail.</span>
              {emptyAction ? <div className="rh-af-state-action">{emptyAction}</div> : null}
            </div>
          </div>
        )}
        {!loading && !error && visible.map((item) => (
          <div
            key={item.id}
            className="rh-af-item"
            style={{ ['--rh-af-accent' as string]: itemAccent(item.type) } as CSSProperties}
          >
            <button
              className="rh-af-avatar"
              onClick={() => onViewProfile(item.username)}
              aria-label={`View ${item.username}'s profile`}
            >
              {initials(item.username)}
            </button>
            <div className="rh-af-body">
              <div className="rh-af-meta-row">
                <span className="rh-af-chip" aria-hidden="true">
                  <span className="rh-af-chip-icon">{itemIcon(item.type)}</span>
                  <span>{itemLabel(item.type)}</span>
                </span>
                <span className="rh-af-time rh-af-time--mobile">{timeAgo(item.created_at)}</span>
              </div>
              <div className="rh-af-copy-row">
                <button
                  className="rh-af-username"
                  onClick={() => onViewProfile(item.username)}
                >
                  {item.username}
                </button>
                <span className="rh-af-desc">{itemDescription(item)}</span>
              </div>
            </div>
            <span className="rh-af-time">{timeAgo(item.created_at)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
