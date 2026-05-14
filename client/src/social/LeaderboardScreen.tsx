import { useEffect, useState, useCallback } from 'react';
import type { User } from '@supabase/supabase-js';
import { fetchFriendsLeaderboard, type LeaderboardEntry } from './socialApi';
import './leaderboard.css';

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

export default function LeaderboardScreen({ user, onViewProfile, onClose }: LeaderboardScreenProps) {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const result = await fetchFriendsLeaderboard();
    setLoading(false);
    if (result.error) { setError(result.error); return; }
    setLeaderboard(result.leaderboard);
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  const selfEntry = leaderboard.find((e) => e.is_self);
  const othersInView = leaderboard.filter((e) => !e.is_self);

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
          <span className="rh-lb-subtitle">Friends · Ranked by Rating</span>
        </div>
      </div>

      <div className="rh-lb-content">
        {loading && (
          <div className="rh-lb-state">
            <span className="rh-lb-state-text">Loading…</span>
          </div>
        )}

        {!loading && error && (
          <div className="rh-lb-state">
            <span className="rh-lb-state-text rh-lb-error">{error}</span>
          </div>
        )}

        {!loading && !error && leaderboard.length === 0 && (
          <div className="rh-lb-state">
            <span className="rh-lb-state-text">Add friends to see your leaderboard.</span>
          </div>
        )}

        {!loading && !error && leaderboard.length > 0 && (
          <div className="rh-lb-list">
            {leaderboard.map((entry) => {
              const tier = ratingTier(entry.glicko_rating, entry.provisional);
              const medalColor = entry.rank_in_friends <= 3 ? MEDAL_COLORS[entry.rank_in_friends - 1] : null;
              return (
                <button
                  key={entry.userId}
                  className={`rh-lb-row${entry.is_self ? ' rh-lb-row--self' : ''}`}
                  style={medalColor ? { borderLeftColor: medalColor } : undefined}
                  onClick={() => onViewProfile(entry.username)}
                >
                  <span className="rh-lb-rank" style={medalColor ? { color: medalColor } : undefined}>
                    #{entry.rank_in_friends}
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
            })}
          </div>
        )}
      </div>

      {selfEntry && (
        <div className="rh-lb-self-pin">
          <div className="rh-lb-self-pin-inner">
            <span className="rh-lb-rank" style={{ color: 'var(--tier-standard)' }}>#{selfEntry.rank_in_friends}</span>
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
