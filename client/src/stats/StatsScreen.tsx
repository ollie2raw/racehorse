import { useCallback, useEffect, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import type { UserProfile } from '../auth/useAuth';
import {
  fetchPersonalStatsInsights,
  fetchPersonalStatsInsightsByUserId,
  type FritzTierKey,
  type PersonalStatsInsights,
  type StatsSummary,
} from './statsApi';

interface StatsScreenProps {
  open: boolean;
  user: User | null;
  targetUserId?: string | null;
  profile: UserProfile | null;
  title?: string;
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
  ghostRating: null,
  ghostGamesThisWeek: 0,
  ghostRatingChangeThisWeek: 0,
  ghostBestWinMarginThisWeek: null,
};

const TIER_LABELS: Record<FritzTierKey, string> = {
  rookie: 'Rookie',
  standard: 'Standard',
  elite: 'Elite',
  master: 'Master',
};

export default function StatsScreen({
  open,
  user,
  targetUserId = null,
  profile,
  title,
  onClose,
}: StatsScreenProps) {
  const [stats, setStats] = useState<StatsSummary>(EMPTY_STATS);
  const [insights, setInsights] = useState<PersonalStatsInsights | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const loadStats = useCallback(() => {
    const statsUserId = targetUserId ?? user?.id ?? null;
    if (!statsUserId) return;

    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);

    const loader =
      targetUserId && targetUserId !== user?.id
        ? fetchPersonalStatsInsightsByUserId(statsUserId)
        : user
          ? fetchPersonalStatsInsights(user)
          : fetchPersonalStatsInsightsByUserId(statsUserId);

    void loader
      .then((result) => {
        if (requestId !== requestIdRef.current) return;
        setLoading(false);
        if (result.error) {
          setError(result.error);
          return;
        }
        setInsights(result.data);
        setStats(result.data?.base ?? EMPTY_STATS);
      })
      .catch(() => {
        if (requestId !== requestIdRef.current) return;
        setLoading(false);
        setError('Unable to load stats. Please try again.');
      });
  }, [targetUserId, user]);

  const rankingProfile = insights?.rankingProfile ?? null;
  const fritz = insights?.fritz ?? null;
  const ghost = insights?.ghost ?? null;
  const puzzle = insights?.puzzle ?? null;

  const statCard = (
    label: string,
    value: string | number,
    icon: string,
    tone: 'neutral' | 'teal' | 'red' = 'neutral',
    subtitle?: string | null,
  ) => (
    <div
      key={label}
      style={{
        borderRadius: '10px',
        border: '1px solid rgba(255,255,255,0.16)',
        background: 'rgba(12,20,34,0.68)',
        padding: '16px',
        display: 'grid',
        gap: '8px',
        alignContent: 'start',
        boxShadow:
          tone === 'teal'
            ? 'inset 0 0 0 1px rgba(52,211,153,0.2)'
            : tone === 'red'
              ? 'inset 0 0 0 1px rgba(248,113,113,0.2)'
              : 'none',
      }}
    >
      <span style={{ fontSize: '1rem', color: 'rgba(191,213,223,0.9)', fontWeight: 700 }}>
        {icon} {label}
      </span>
      <strong
        style={{
          fontSize: '1.82rem',
          lineHeight: 1.05,
          letterSpacing: '0.01em',
          color:
            tone === 'teal'
              ? '#5eead4'
              : tone === 'red'
                ? '#fca5a5'
                : 'rgba(236,248,245,0.95)',
        }}
      >
        {value}
      </strong>
      {subtitle ? (
        <span style={{ fontSize: '0.92rem', color: 'rgba(191,213,223,0.84)', fontWeight: 600, lineHeight: 1.45 }}>
          {subtitle}
        </span>
      ) : null}
    </div>
  );

  useEffect(() => {
    if (!open || (!user && !targetUserId)) return;
    loadStats();

    return () => {
      requestIdRef.current += 1;
    };
  }, [loadStats, open, targetUserId, user]);

  const inferredTitle =
    profile?.username
      ? `@${profile.username} / Stats`
      : user?.email
        ? `${user.email} / Stats`
        : 'Profile / Stats';
  const headerTitle = title ?? inferredTitle;

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
          width: 'min(1320px, calc(100vw - 24px))',
          maxHeight: 'min(96vh, 980px)',
          borderRadius: '20px',
          border: '1px solid rgba(236,252,245,0.2)',
          background: 'linear-gradient(170deg, rgba(18,26,39,0.92), rgba(9,15,26,0.96))',
          boxShadow: '0 24px 64px rgba(0,0,0,0.42)',
          padding: '18px',
          color: 'rgba(235,245,242,0.96)',
          display: 'grid',
          gap: '12px',
          overflow: 'auto',
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0, fontSize: '1.4rem' }}>{headerTitle}</h3>
            {stats.ghostRating != null && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 12px',
                  borderRadius: 999,
                  fontSize: '0.9rem',
                  color: '#d8b4fe',
                  fontWeight: 700,
                  letterSpacing: '0.03em',
                  background: 'rgba(168, 85, 247, 0.1)',
                  border: '1px solid rgba(216, 180, 254, 0.18)',
                }}
              >
                <span aria-hidden="true">👻</span>
                <span>Ghost Rating {stats.ghostRating}</span>
              </span>
            )}
          </div>
          <button className="mode-inline-btn" onClick={onClose}>
            Close
          </button>
        </div>

        {rankingProfile && (
          <div
            style={{
              padding: '16px 18px',
              borderRadius: '12px',
              background: 'rgba(20, 28, 45, 0.72)',
              border: '1px solid rgba(236, 252, 245, 0.12)',
              display: 'grid',
              gap: '8px',
              position: 'relative',
              overflow: 'hidden'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
               <span style={{ fontSize: '1rem', color: 'rgba(191,213,223,0.9)', fontWeight: 700 }}>Ranked Rating</span>
               {rankingProfile.rank && (
                 <span style={{ fontSize: '0.96rem', color: '#34d399', fontWeight: 700 }}>#{rankingProfile.rank} globally</span>
               )}
            </div>
            
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
               <span style={{ fontSize: '2.5rem', fontWeight: 800, color: '#fefefe', lineHeight: 1 }}>
                 {Math.round(rankingProfile.glicko_rating).toLocaleString()}
               </span>
               {rankingProfile.provisional && (
                 <span style={{ fontSize: '1.7rem', color: 'rgba(236,252,245,0.4)', fontWeight: 600 }}>?</span>
               )}
            </div>

            {rankingProfile.provisional && (
              <span style={{ fontSize: '0.92rem', color: 'rgba(191,213,223,0.74)', marginTop: '-4px', lineHeight: 1.4 }}>
                Confirmed after 20 ranked games
              </span>
            )}

            <div style={{ height: '5px', width: '100%', background: 'rgba(255,255,255,0.06)', borderRadius: '3px', marginTop: '2px' }}>
              <div 
                style={{ 
                  height: '100%', 
                  background: 'linear-gradient(90deg, #10b981, #34d399)',
                  borderRadius: '3px',
                  width: `${Math.max(10, 100 - (rankingProfile.glicko_rd - 50) * (90/300))}%`,
                  boxShadow: '0 0 10px rgba(52, 211, 153, 0.25)',
                  transition: 'width 600ms ease-out'
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: '18px', fontSize: '0.92rem', color: 'rgba(191,213,223,0.82)', marginTop: '4px', flexWrap: 'wrap' }}>
               <span>Peak: <strong style={{ color: 'rgba(236,252,245,0.9)' }}>{Math.round(rankingProfile.peak_rating).toLocaleString()}</strong></span>
               <span>Ranked Games: <strong style={{ color: 'rgba(236,252,245,0.9)' }}>{rankingProfile.ranked_games_played}</strong></span>
            </div>
          </div>
        )}

        {loading && <p style={{ margin: 0, color: 'rgba(223,236,244,0.86)' }}>Loading stats...</p>}
        {error && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <p className="auth-inline-error" style={{ margin: 0 }}>
              {error}
            </p>
            <button className="mode-inline-btn" onClick={() => void loadStats()}>
              Retry
            </button>
          </div>
        )}

        {!loading && !error && (
          <div style={{ display: 'grid', gap: '12px', minHeight: '220px' }}>
            {fritz && (
              <section
                style={{
                  display: 'grid',
                  gap: '12px',
                  padding: '16px',
                  borderRadius: '12px',
                  border: '1px solid rgba(94, 234, 212, 0.14)',
                  background: 'rgba(8, 18, 30, 0.52)',
                }}
              >
                <div style={{ display: 'grid', gap: 4 }}>
                  <strong style={{ fontSize: '1.18rem', color: 'rgba(240,248,255,0.96)' }}>Fritz / Ranked</strong>
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                    gap: '12px',
                  }}
                >
                  {[
                    statCard('Fritz Win Rate', `${fritz.winRate}%`, '📊'),
                    statCard('Fritz Record', `${fritz.wins}-${fritz.losses}`, '🏆'),
                    statCard('Current Fritz Streak', fritz.currentStreak, '🔥'),
                    statCard('Best Fritz Streak', fritz.bestStreak, '⚡'),
                    statCard('Avg Points Scored', fritz.averagePointsScored == null ? '—' : `${fritz.averagePointsScored} pts`, '🎯'),
                    statCard('Most Points Scored', fritz.highestScore == null ? '—' : `${fritz.highestScore} pts`, '💥'),
                  ]}
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                    gap: '10px',
                  }}
                >
                  {(Object.keys(TIER_LABELS) as FritzTierKey[]).map((tier) => {
                    const record = fritz.tierRecords[tier];
                    return (
                      <div
                        key={tier}
                        style={{
                          borderRadius: '10px',
                          border: '1px solid rgba(255,255,255,0.12)',
                          background: 'rgba(14, 24, 38, 0.74)',
                          padding: '14px 14px',
                          display: 'grid',
                          gap: 6,
                        }}
                      >
                        <strong style={{ fontSize: '1rem', color: 'rgba(235,245,242,0.95)' }}>{TIER_LABELS[tier]}</strong>
                        <span style={{ fontSize: '1.28rem', color: '#f8fafc', fontWeight: 800 }}>
                          {record.wins}-{record.losses}
                        </span>
                        <span style={{ fontSize: '0.9rem', color: 'rgba(191,213,223,0.8)' }}>
                          {record.gamesPlayed} game{record.gamesPlayed === 1 ? '' : 's'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            <div
              style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
                    gap: '12px',
              }}
            >
              <section
                style={{
                  display: 'grid',
                  gap: '12px',
                  padding: '16px',
                  borderRadius: '12px',
                  border: '1px solid rgba(216, 180, 254, 0.16)',
                  background: 'rgba(33, 18, 52, 0.28)',
                }}
              >
                <div style={{ display: 'grid', gap: 4 }}>
                  <strong style={{ fontSize: '1.18rem', color: 'rgba(240,248,255,0.96)' }}>Ghost Mode</strong>
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                    gap: '12px',
                  }}
                >
                  {[
                    statCard('Ghost Rating', ghost?.rating ?? '—', '👻'),
                    statCard('Ghost Games', ghost?.gamesPlayed ?? 0, '🫥'),
                    statCard('Ghost Win Rate', `${ghost?.winRate ?? 0}%`, '📊'),
                    statCard('Best Ghost Win', ghost?.bestWinMargin == null ? '—' : `${ghost.bestWinMargin} pts`, '💨'),
                  ]}
                </div>
              </section>

              <section
                style={{
                  display: 'grid',
                  gap: '12px',
                  padding: '16px',
                  borderRadius: '12px',
                  border: '1px solid rgba(240, 192, 64, 0.16)',
                  background: 'rgba(44, 31, 10, 0.24)',
                }}
              >
                <div style={{ display: 'grid', gap: 4 }}>
                  <strong style={{ fontSize: '1.18rem', color: 'rgba(240,248,255,0.96)' }}>Daily Puzzle</strong>
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                    gap: '12px',
                  }}
                >
                  {[
                    statCard('Puzzle Streak', puzzle?.currentStreak ?? 0, '🔥'),
                    statCard('Completions', puzzle?.completions ?? 0, '🗓️'),
                    statCard('Best Today', puzzle?.bestScoreToday == null ? '—' : `${puzzle.bestScoreToday}`, '🎯'),
                    statCard('Perfect Days', puzzle?.perfectDays ?? 0, '✨'),
                  ]}
                </div>
              </section>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
