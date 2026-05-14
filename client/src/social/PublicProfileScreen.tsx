import { useEffect, useState, useCallback } from 'react';
import type { User } from '@supabase/supabase-js';
import { fetchPublicProfile, type PublicProfile, type PresenceStatus } from './socialApi';
import { sendFriendRequest } from '../friends/friendsApi';
import './publicProfile.css';

interface PublicProfileScreenProps {
  username: string;
  user: User | null;
  onClose: () => void;
  showToast: (msg: string) => void;
}

function presenceDot(status: PresenceStatus) {
  const color = status === 'online' ? 'var(--tier-rookie)' : status === 'in_game' ? 'var(--tier-elite)' : 'var(--text-dim)';
  const label = status === 'online' ? 'Online' : status === 'in_game' ? 'In Game' : 'Offline';
  return (
    <span className="rh-pp-presence">
      <span className="rh-pp-presence-dot" style={{ background: color }} />
      {label}
    </span>
  );
}

function ratingTier(rating: number, provisional: boolean): { label: string; color: string } {
  if (provisional) return { label: 'Provisional', color: 'var(--text-dim)' };
  if (rating >= 1600) return { label: 'Master', color: 'var(--tier-master)' };
  if (rating >= 1300) return { label: 'Elite', color: 'var(--tier-elite)' };
  if (rating >= 1000) return { label: 'Standard', color: 'var(--tier-standard)' };
  return { label: 'Rookie', color: 'var(--tier-rookie)' };
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

export default function PublicProfileScreen({ username, user, onClose, showToast }: PublicProfileScreenProps) {
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addingFriend, setAddingFriend] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchPublicProfile(username);
    setLoading(false);
    if (result.error) { setError(result.error); return; }
    setProfile(result.profile);
  }, [username]);

  useEffect(() => { void load(); }, [load]);

  const handleAddFriend = async () => {
    if (!user || !profile) return;
    setAddingFriend(true);
    const result = await sendFriendRequest(user.id, profile.username);
    setAddingFriend(false);
    if (result.error) { showToast(result.error); return; }
    showToast(`Friend request sent to ${profile.username}`);
    void load();
  };

  if (loading) {
    return (
      <div className="rh-pp-screen">
        <div className="rh-pp-loading">
          <div className="rh-pp-loading-text">Loading…</div>
        </div>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="rh-pp-screen">
        <div className="rh-pp-header">
          <button className="rh-pp-back" onClick={onClose} aria-label="Back">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M19 12H5M5 12L12 19M5 12L12 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        <div className="rh-pp-error-state">{error ?? 'Player not found.'}</div>
      </div>
    );
  }

  const tier = ratingTier(profile.glicko_rating, profile.provisional);
  const winRate = profile.ranked_games_played > 0
    ? `${profile.win_rate.toFixed(1)}%`
    : '—';

  return (
    <div className="rh-pp-screen">
      <div className="rh-pp-header">
        <button className="rh-pp-back" onClick={onClose} aria-label="Back">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M19 12H5M5 12L12 19M5 12L12 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span className="rh-pp-breadcrumb">Player Profile</span>
      </div>

      <div className="rh-pp-content">
        {/* Hero */}
        <div className="rh-pp-hero">
          <div className="rh-pp-avatar">
            {profile.username.slice(0, 2).toUpperCase()}
          </div>
          <div className="rh-pp-hero-info">
            <div className="rh-pp-username-row">
              <h1 className="rh-pp-username">{profile.username}</h1>
              {presenceDot(profile.presence.status)}
            </div>
            <div className="rh-pp-tier" style={{ color: tier.color }}>{tier.label}</div>
            {profile.global_rank && (
              <div className="rh-pp-rank">#{profile.global_rank} globally</div>
            )}
          </div>
          {!profile.is_self && user && (
            <div className="rh-pp-hero-actions">
              {!profile.is_friend && !profile.has_pending_request && (
                <button
                  className="rh-pp-btn rh-pp-btn--primary"
                  onClick={handleAddFriend}
                  disabled={addingFriend}
                >
                  {addingFriend ? 'Sending…' : '+ Add Friend'}
                </button>
              )}
              {profile.has_pending_request && (
                <span className="rh-pp-pending-badge">Request Pending</span>
              )}
              {profile.is_friend && (
                <span className="rh-pp-friend-badge">✓ Friends</span>
              )}
            </div>
          )}
        </div>

        {/* Stats grid */}
        <div className="rh-pp-stats-grid">
          <div className="rh-pp-stat">
            <span className="rh-pp-stat-value">{Math.round(profile.glicko_rating).toLocaleString()}</span>
            <span className="rh-pp-stat-label">RATING</span>
          </div>
          <div className="rh-pp-stat">
            <span className="rh-pp-stat-value">{Math.round(profile.peak_rating).toLocaleString()}</span>
            <span className="rh-pp-stat-label">PEAK</span>
          </div>
          <div className="rh-pp-stat">
            <span className="rh-pp-stat-value">{winRate}</span>
            <span className="rh-pp-stat-label">WIN RATE</span>
          </div>
          <div className="rh-pp-stat">
            <span className="rh-pp-stat-value">{profile.wins}</span>
            <span className="rh-pp-stat-label">WINS</span>
          </div>
          <div className="rh-pp-stat">
            <span className="rh-pp-stat-value">{profile.losses}</span>
            <span className="rh-pp-stat-label">LOSSES</span>
          </div>
          <div className="rh-pp-stat">
            <span className="rh-pp-stat-value">{profile.ranked_games_played}</span>
            <span className="rh-pp-stat-label">RANKED GAMES</span>
          </div>
          <div className="rh-pp-stat">
            <span className="rh-pp-stat-value">{profile.puzzles_completed ?? 0}</span>
            <span className="rh-pp-stat-label">PUZZLES</span>
          </div>
          <div className="rh-pp-stat">
            <span className="rh-pp-stat-value">
              {(profile.fritz_wins != null && profile.fritz_losses != null)
                ? `${profile.fritz_wins}W ${profile.fritz_losses}L`
                : '—'}
            </span>
            <span className="rh-pp-stat-label">FRITZ RECORD</span>
          </div>
          <div className="rh-pp-stat">
            <span className="rh-pp-stat-value">{profile.best_puzzle_score ?? '—'}</span>
            <span className="rh-pp-stat-label">BEST PUZZLE</span>
          </div>
        </div>

        {/* Recent matches */}
        {profile.recent_matches.length > 0 && (
          <div className="rh-pp-section">
            <h2 className="rh-pp-section-title">Recent Matches</h2>
            <div className="rh-pp-matches">
              {profile.recent_matches.map((m, i) => (
                <div key={i} className={`rh-pp-match rh-pp-match--${m.result}`}>
                  <span className={`rh-pp-match-result rh-pp-match-result--${m.result}`}>
                    {m.result === 'win' ? 'W' : 'L'}
                  </span>
                  <span className="rh-pp-match-vs">vs {m.opponent_username}</span>
                  {m.score != null && m.opponent_score != null && (
                    <span className="rh-pp-match-score">{m.score} – {m.opponent_score}</span>
                  )}
                  <span className="rh-pp-match-mode">{m.mode}</span>
                  <span className="rh-pp-match-time">{timeAgo(m.played_at)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
