import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import type { UserProfile } from '../auth/useAuth';
import { fetchUserStats, type StatsSummary } from './statsApi';

interface StatsScreenProps {
  open: boolean;
  user: User | null;
  profile: UserProfile | null;
  onClose: () => void;
}

const EMPTY_STATS: StatsSummary = {
  onlineGamesPlayed: 0,
  wins: 0,
  losses: 0,
  avgMoveQuality: null,
  longestWinStreak: 0,
  winRate: 0,
  currentWinStreak: 0,
  gamesThisWeek: 0,
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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Profile stats"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1900,
        display: 'grid',
        placeItems: 'center',
        background: 'rgba(6, 10, 18, 0.62)',
        backdropFilter: 'blur(4px)',
        pointerEvents: open ? 'auto' : 'none',
        opacity: open ? 1 : 0,
        visibility: open ? 'visible' : 'hidden',
        transform: open ? 'scale(1)' : 'scale(0.97)',
        transition: 'opacity 180ms ease, transform 180ms ease',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative',
          zIndex: 1901,
          pointerEvents: 'auto',
          width: 'min(760px, calc(100vw - 24px))',
          borderRadius: '16px',
          border: '1px solid rgba(236,252,245,0.2)',
          background: 'linear-gradient(170deg, rgba(18,26,39,0.92), rgba(9,15,26,0.96))',
          boxShadow: '0 24px 64px rgba(0,0,0,0.42)',
          padding: '18px',
          color: 'rgba(235,245,242,0.96)',
          display: 'grid',
          gap: '14px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
          }}
        >
          <h3 style={{ margin: 0 }}>Profile / Stats</h3>
          <button className="mode-inline-btn" onClick={onClose}>
            Close
          </button>
        </div>

        <p style={{ margin: 0, color: 'rgba(223,236,244,0.86)', fontSize: '1.02rem' }}>
          {profile?.username ? `@${profile.username}` : 'Guest'}
        </p>

        <div
          style={{
            display: 'grid',
            justifyItems: 'center',
            gap: 8,
            padding: '4px 0 2px',
          }}
        >
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: '50%',
              display: 'grid',
              placeItems: 'center',
              background: 'linear-gradient(140deg, #34d399, #0ea5a3)',
              color: '#04211c',
              fontSize: '2rem',
              fontWeight: 800,
              letterSpacing: '0.02em',
              border: '1px solid rgba(236,252,245,0.34)',
              boxShadow: '0 10px 24px rgba(14, 116, 102, 0.28)',
            }}
          >
            {(profile?.username?.[0] ?? user?.email?.[0] ?? 'G').toUpperCase()}
          </div>
          <strong style={{ fontSize: '1.08rem' }}>
            {profile?.username ? `@${profile.username}` : user?.email ?? 'Guest'}
          </strong>
          <span style={{ fontSize: '0.8rem', color: 'rgba(188, 212, 222, 0.72)', letterSpacing: '0.04em' }}>
            Member
          </span>
        </div>

        {loading && <p style={{ margin: 0, color: 'rgba(223,236,244,0.86)' }}>Loading stats...</p>}
        {error && <p className="auth-inline-error">{error}</p>}

        {!loading && !error && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: '12px',
              minHeight: '220px',
            }}
          >
            {[
              { label: 'Win Rate', value: `${stats.winRate}%`, icon: '📊', tone: 'neutral' },
              { label: 'Wins', value: stats.wins, icon: '🏆', tone: 'teal' },
              { label: 'Losses', value: stats.losses, icon: '📉', tone: 'red' },
              {
                label: 'Avg Move Quality',
                value: stats.avgMoveQuality == null ? '—' : `${Math.round(stats.avgMoveQuality)}%`,
                subtitle:
                  stats.avgMoveQuality == null
                    ? 'Not enough data'
                    : stats.avgMoveQuality >= 85
                      ? 'Excellent'
                      : stats.avgMoveQuality >= 70
                        ? 'Good'
                        : 'Developing',
                icon: '🎯',
                tone:
                  stats.avgMoveQuality == null
                    ? 'neutral'
                    : stats.avgMoveQuality >= 85
                      ? 'teal'
                      : 'neutral',
              },
              { label: 'Current Streak', value: stats.currentWinStreak, icon: '🔥', tone: 'neutral' },
              { label: 'Best Streak', value: stats.longestWinStreak, icon: '⚡', tone: 'neutral' },
              { label: 'This Week', value: stats.gamesThisWeek, icon: '🎮', tone: 'neutral' },
              { label: 'Online Games', value: stats.onlineGamesPlayed, icon: '🧩', tone: 'neutral' },
            ].map((item) => (
              <div
                key={item.label}
                style={{
                  borderRadius: '10px',
                  border: '1px solid rgba(255,255,255,0.16)',
                  background: 'rgba(12,20,34,0.68)',
                  padding: '12px',
                  display: 'grid',
                  gap: '6px',
                  alignContent: 'start',
                  boxShadow:
                    item.tone === 'teal'
                      ? 'inset 0 0 0 1px rgba(52,211,153,0.2)'
                      : item.tone === 'red'
                        ? 'inset 0 0 0 1px rgba(248,113,113,0.2)'
                        : 'none',
                }}
              >
                <span style={{ fontSize: '0.86rem', color: 'rgba(191,213,223,0.86)' }}>
                  {item.icon} {item.label}
                </span>
                <strong
                  style={{
                    fontSize: '1.4rem',
                    lineHeight: 1.05,
                    letterSpacing: '0.01em',
                    color:
                      item.tone === 'teal'
                        ? '#5eead4'
                        : item.tone === 'red'
                          ? '#fca5a5'
                          : 'rgba(236,248,245,0.95)',
                  }}
                >
                  {item.value}
                </strong>
                {'subtitle' in item && item.subtitle && (
                  <span
                    style={{
                      fontSize: '0.78rem',
                      color:
                        item.subtitle === 'Excellent'
                          ? '#5eead4'
                          : item.subtitle === 'Good'
                            ? 'rgba(236,248,245,0.9)'
                            : 'rgba(191,213,223,0.8)',
                      fontWeight: 600,
                    }}
                  >
                    {item.subtitle}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
