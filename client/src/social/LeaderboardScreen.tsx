import { useEffect, useState, useCallback } from 'react';
import type { User } from '@supabase/supabase-js';
import {
  fetchFriendsLeaderboard,
  fetchGlobalLeaderboard,
  type LeaderboardEntry,
  type GlobalLeaderboardEntry,
} from './socialApi';
import './leaderboard.css';

type Tab = 'global' | 'friends';

interface LeaderboardScreenProps {
  user: User | null;
  onViewProfile: (username: string) => void;
  onClose: () => void;
}

const MEDAL_COLORS = ['#E7B64A', '#94A3B8', '#C97B3F'] as const;

function ratingTier(rating: number, provisional: boolean): { label: string; color: string } {
  if (provisional) return { label: 'Provisional', color: 'var(--text-dim)' };
  if (rating >= 1600) return { label: 'Master', color: 'var(--tier-master)' };
  if (rating >= 1300) return { label: 'Elite', color: 'var(--tier-elite)' };
  if (rating >= 1000) return { label: 'Standard', color: 'var(--tier-standard)' };
  return { label: 'Rookie', color: 'var(--tier-rookie)' };
}

type AnyEntry = (LeaderboardEntry | GlobalLeaderboardEntry) & { rank: number };

function normalizeEntry(entry: LeaderboardEntry | GlobalLeaderboardEntry, tab: Tab): AnyEntry {
  if (tab === 'friends') {
    const e = entry as LeaderboardEntry;
    return { ...e, rank: e.rank_in_friends };
  }
  const e = entry as GlobalLeaderboardEntry;
  return { ...e, rank: e.global_rank };
}

function LeaderboardRow({
  entry,
  rank,
  onViewProfile,
}: {
  entry: LeaderboardEntry | GlobalLeaderboardEntry;
  rank: number;
  onViewProfile: (username: string) => void;
}) {
  const tier = ratingTier(entry.glicko_rating, entry.provisional);
  const medalColor = rank <= 3 ? MEDAL_COLORS[rank - 1] : null;
  return (
    <button
      className={`rh-lb-row${entry.is_self ? ' rh-lb-row--self' : ''}`}
      style={medalColor ? { borderLeftColor: medalColor } : undefined}
      onClick={() => onViewProfile(entry.username)}
    >
      <span className="rh-lb-rank" style={medalColor ? { color: medalColor } : undefined}>
        #{rank}
      </span>
      <span className="rh-lb-username">
        {entry.username}
        {entry.is_self && <span className="rh-lb-you"> YOU</span>}
      </span>
      <span className="rh-lb-tier" style={{ color: tier.color }}>{tier.label}</span>
      <span className="rh-lb-rating">{Math.round(entry.glicko_rating).toLocaleString()}</span>
      <span className="rh-lb-games">{entry.ranked_games_played} games</span>
    </button>
  );
}

export default function LeaderboardScreen({ user, onViewProfile, onClose }: LeaderboardScreenProps) {
  const [tab, setTab] = useState<Tab>('global');
  const [globalData, setGlobalData] = useState<{ leaderboard: GlobalLeaderboardEntry[]; self: GlobalLeaderboardEntry | null } | null>(null);
  const [friendsData, setFriendsData] = useState<LeaderboardEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadGlobal = useCallback(async () => {
    if (!user || globalData) return;
    setLoading(true);
    setError(null);
    const result = await fetchGlobalLeaderboard();
    setLoading(false);
    if (result.error) { setError(result.error); return; }
    setGlobalData({ leaderboard: result.leaderboard, self: result.self });
  }, [user, globalData]);

  const loadFriends = useCallback(async () => {
    if (!user || friendsData) return;
    setLoading(true);
    setError(null);
    const result = await fetchFriendsLeaderboard();
    setLoading(false);
    if (result.error) { setError(result.error); return; }
    setFriendsData(result.leaderboard);
  }, [user, friendsData]);

  useEffect(() => {
    if (tab === 'global') void loadGlobal();
    else void loadFriends();
  }, [tab, loadGlobal, loadFriends]);

  const rows: Array<{ entry: LeaderboardEntry | GlobalLeaderboardEntry; rank: number }> =
    tab === 'global'
      ? (globalData?.leaderboard ?? []).map((e) => ({ entry: e, rank: e.global_rank }))
      : (friendsData ?? []).map((e) => ({ entry: e, rank: e.rank_in_friends }));

  const selfEntry: (GlobalLeaderboardEntry | LeaderboardEntry) | undefined =
    tab === 'global' ? (globalData?.self ?? undefined) : (friendsData?.find((e) => e.is_self));
  const selfRank = tab === 'global'
    ? (selfEntry as GlobalLeaderboardEntry | undefined)?.global_rank
    : (selfEntry as LeaderboardEntry | undefined)?.rank_in_friends;

  return (
    <div className="rh-lb-screen">
      <div className="rh-lb-header">
        <button className="rh-lb-back" onClick={onClose} aria-label="Back">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M19 12H5M5 12L12 19M5 12L12 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="rh-lb-title-block">
          <h1 className="rh-lb-title">Leaderboard</h1>
        </div>
        <div className="rh-lb-tabs">
          <button
            className={`rh-lb-tab${tab === 'global' ? ' rh-lb-tab--active' : ''}`}
            onClick={() => setTab('global')}
          >
            Global
          </button>
          <button
            className={`rh-lb-tab${tab === 'friends' ? ' rh-lb-tab--active' : ''}`}
            onClick={() => setTab('friends')}
          >
            Friends
          </button>
        </div>
      </div>

      <div className="rh-lb-content">
        {loading && <div className="rh-lb-state"><span className="rh-lb-state-text">Loading…</span></div>}
        {!loading && error && <div className="rh-lb-state"><span className="rh-lb-state-text rh-lb-error">{error}</span></div>}
        {!loading && !error && rows.length === 0 && (
          <div className="rh-lb-state">
            <span className="rh-lb-state-text">
              {tab === 'friends' ? 'Add friends to see your friends leaderboard.' : 'No ranked players yet.'}
            </span>
          </div>
        )}
        {!loading && !error && rows.length > 0 && (
          <div className="rh-lb-list">
            {rows.map(({ entry, rank }) => (
              <LeaderboardRow key={entry.userId} entry={entry} rank={rank} onViewProfile={onViewProfile} />
            ))}
          </div>
        )}
      </div>

      {selfEntry && selfRank && (
        <div className="rh-lb-self-pin">
          <div className="rh-lb-self-pin-inner">
            <span className="rh-lb-rank" style={{ color: 'var(--tier-standard)' }}>#{selfRank}</span>
            <span className="rh-lb-username">{selfEntry.username} <span className="rh-lb-you">YOU</span></span>
            <span className="rh-lb-tier" style={{ color: ratingTier(selfEntry.glicko_rating, selfEntry.provisional).color }}>
              {ratingTier(selfEntry.glicko_rating, selfEntry.provisional).label}
            </span>
            <span className="rh-lb-rating">{Math.round(selfEntry.glicko_rating).toLocaleString()}</span>
          </div>
        </div>
      )}
    </div>
  );
}
