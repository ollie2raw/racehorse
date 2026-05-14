import { useEffect, useState, useCallback } from 'react';
import type { User } from '@supabase/supabase-js';
import { fetchActivityFeed, type FeedItem } from './socialApi';
import './activityFeed.css';

type FilterTab = 'all' | 'wins' | 'streaks' | 'tournaments';

interface ActivityFeedPanelProps {
  user: User | null;
  onViewProfile: (username: string) => void;
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

export default function ActivityFeedPanel({ user, onViewProfile }: ActivityFeedPanelProps) {
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterTab>('all');

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const result = await fetchActivityFeed();
    setLoading(false);
    if (result.error) { setError(result.error); return; }
    setFeed(result.feed);
  }, [user]);

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
          <div className="rh-af-state">Loading…</div>
        )}
        {!loading && error && (
          <div className="rh-af-state rh-af-state--error">{error}</div>
        )}
        {!loading && !error && visible.length === 0 && (
          <div className="rh-af-state">
            {feed.length === 0
              ? 'Add friends to see their activity here.'
              : 'No activity matching this filter.'}
          </div>
        )}
        {!loading && !error && visible.map((item) => (
          <div key={item.id} className="rh-af-item">
            <span className="rh-af-icon" aria-hidden>{itemIcon(item.type)}</span>
            <div className="rh-af-body">
              <button
                className="rh-af-username"
                onClick={() => onViewProfile(item.username)}
              >
                {item.username}
              </button>
              <span className="rh-af-desc"> {itemDescription(item)}</span>
            </div>
            <span className="rh-af-time">{timeAgo(item.created_at)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
