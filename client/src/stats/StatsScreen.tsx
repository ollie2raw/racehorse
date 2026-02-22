import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import type { UserProfile } from "../auth/useAuth";
import { fetchUserStats, type StatsSummary } from "./statsApi";

interface StatsScreenProps {
  open: boolean;
  user: User | null;
  profile: UserProfile | null;
  onClose: () => void;
}

const EMPTY_STATS: StatsSummary = {
  gamesPlayed: 0,
  wins: 0,
  losses: 0,
  botWins: 0,
  botLosses: 0,
};

export default function StatsScreen({ open, user, profile, onClose }: StatsScreenProps) {
  const [stats, setStats] = useState<StatsSummary>(EMPTY_STATS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !user) return;

    let active = true;
    setLoading(true);
    setError(null);

    fetchUserStats(user).then((result) => {
      if (!active) return;
      setLoading(false);
      if (result.error) {
        setError(result.error);
        return;
      }
      setStats(result.data ?? EMPTY_STATS);
    });

    return () => {
      active = false;
    };
  }, [open, user]);

  if (!open) return null;

  return (
    <div className="auth-modal-overlay" role="dialog" aria-modal="true" aria-label="Profile stats">
      <div className="auth-modal-card stats-modal-card">
        <div className="auth-modal-header">
          <h3>Profile / Stats</h3>
          <button className="btn text compact" onClick={onClose}>Close</button>
        </div>

        <p className="auth-modal-copy">{profile?.username ? `@${profile.username}` : "Guest"}</p>

        {loading && <p className="auth-modal-copy">Loading stats...</p>}
        {error && <p className="auth-inline-error">{error}</p>}

        {!loading && !error && (
          <div className="stats-grid">
            <div className="stats-tile"><span>Games</span><strong>{stats.gamesPlayed}</strong></div>
            <div className="stats-tile"><span>Wins</span><strong>{stats.wins}</strong></div>
            <div className="stats-tile"><span>Losses</span><strong>{stats.losses}</strong></div>
            <div className="stats-tile"><span>Bot Wins</span><strong>{stats.botWins}</strong></div>
            <div className="stats-tile"><span>Bot Losses</span><strong>{stats.botLosses}</strong></div>
          </div>
        )}
      </div>
    </div>
  );
}
