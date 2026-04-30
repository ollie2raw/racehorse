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
import './statsScreen.css';

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

const TIER_COLORS: Record<FritzTierKey, string> = {
  rookie: '#00e676',
  standard: '#3d8eff',
  elite: '#ff4040',
  master: '#f0c040',
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
        if (result.error) { setError(result.error); return; }
        setInsights(result.data);
        setStats(result.data?.base ?? EMPTY_STATS);
      })
      .catch(() => {
        if (requestId !== requestIdRef.current) return;
        setLoading(false);
        setError('Unable to load stats. Please try again.');
      });
  }, [targetUserId, user]);

  useEffect(() => {
    if (!open || (!user && !targetUserId)) return;
    loadStats();
    return () => { requestIdRef.current += 1; };
  }, [loadStats, open, targetUserId, user]);

  const rankingProfile = insights?.rankingProfile ?? null;
  const fritz = insights?.fritz ?? null;
  const ghost = insights?.ghost ?? null;
  const puzzle = insights?.puzzle ?? null;

  // Keep stats reference used by callers who check stats.ghostRating
  void stats;

  const displayName =
    profile?.username
      ? `@${profile.username}`
      : user?.email
        ? `@${user.email.split('@')[0]}`
        : 'Player';

  const headerTitle = title ?? `${displayName} / Stats`;

  if (!open) return null;

  return (
    <div className="stats-page" role="dialog" aria-modal="true" aria-label="Stats">

      {/* ── Top nav ── */}
      <header className="stats-page-topbar">
        <div className="stats-page-brand">RACEHORSE</div>
        <button type="button" className="stats-page-back" onClick={onClose}>
          <svg viewBox="0 0 12 12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="12" height="12">
            <path d="M7.5 2L3 6l4.5 4" />
          </svg>
          {headerTitle}
        </button>
      </header>

      {/* ── Hero rating strip (full width) ── */}
      {rankingProfile && (
        <div className="stats-page-hero-strip">
          <div className="stats-page-hero-strip__atmo" aria-hidden="true" />
          <div className="stats-page-hero-strip__line" aria-hidden="true" />
          <div className="stats-page-hero-strip__inner">
            <div>
              <p className="stats-page-hero-strip__eyebrow">{displayName.toUpperCase()} / RANKED RATING</p>
              <div className="stats-page-hero-strip__rating-row">
                <span className="stats-page-hero-strip__rating">
                  {Math.round(rankingProfile.glicko_rating).toLocaleString()}
                  {rankingProfile.provisional && (
                    <span className="stats-page-hero-strip__prov">?</span>
                  )}
                </span>
                {rankingProfile.rank && (
                  <span className="stats-page-hero-strip__rank">#{rankingProfile.rank} Globally</span>
                )}
              </div>
              <div className="stats-page-hero-strip__sub-row">
                <span>Peak: {Math.round(rankingProfile.peak_rating).toLocaleString()}</span>
                <span>{rankingProfile.ranked_games_played} ranked games</span>
              </div>
            </div>
            <div className="stats-page-hero-strip__bar-col">
              <div className="stats-page-hero-strip__bar-track">
                <div
                  className="stats-page-hero-strip__bar-fill"
                  style={{ width: `${Math.max(10, (rankingProfile.glicko_rating / 2400) * 100)}%` }}
                />
              </div>
              <div className="stats-page-hero-strip__bar-labels">
                <span>0</span>
                <span>2400</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Scrollable body ── */}
      <div className="stats-page-body">

        {loading && <p className="stats-page-note">Loading stats…</p>}
        {error && (
          <div className="stats-page-error-row">
            <p className="stats-page-error">{error}</p>
            <button type="button" className="stats-page-retry" onClick={() => void loadStats()}>Retry</button>
          </div>
        )}

        {!loading && !error && (
          <>
            {/* Fritz / Ranked */}
            {fritz && (
              <section className="stats-page-section">
                <p className="stats-page-section-label" style={{ color: '#3d8eff' }}>Fritz / Ranked</p>
                <div className="stats-page-grid stats-page-grid--6">
                  {[
                    { label: 'Win Rate',       value: `${fritz.winRate}%`,                                                      accent: '#3d8eff' as string | null },
                    { label: 'Record',         value: `${fritz.wins}–${fritz.losses}`,                                           accent: null },
                    { label: 'Current Streak', value: String(fritz.currentStreak),                                               accent: null },
                    { label: 'Best Streak',    value: String(fritz.bestStreak),                                                  accent: null },
                    { label: 'Avg Score',      value: fritz.averagePointsScored == null ? '—' : String(fritz.averagePointsScored), accent: null },
                    { label: 'Best Score',     value: fritz.highestScore == null ? '—' : String(fritz.highestScore),             accent: null },
                  ].map((s) => (
                    <div
                      key={s.label}
                      className="stats-page-statcard"
                      style={s.accent ? { borderTopColor: s.accent } : undefined}
                    >
                      <p className="stats-page-statcard__label">{s.label}</p>
                      <p className="stats-page-statcard__value" style={s.accent ? { color: s.accent } : undefined}>{s.value}</p>
                    </div>
                  ))}
                </div>
                <div className="stats-page-grid stats-page-grid--4" style={{ marginTop: 6 }}>
                  {(Object.keys(TIER_LABELS) as FritzTierKey[]).map((tier) => {
                    const record = fritz.tierRecords[tier];
                    return (
                      <div key={tier} className="stats-page-statcard" style={{ borderTopColor: TIER_COLORS[tier] }}>
                        <div className="stats-page-tier-header">
                          <span className="stats-page-tier-dot" style={{ background: TIER_COLORS[tier] }} />
                          <p className="stats-page-statcard__label">{TIER_LABELS[tier]}</p>
                        </div>
                        <p className="stats-page-statcard__value">{record.wins}–{record.losses}</p>
                        <p className="stats-page-tier-games">{record.gamesPlayed} games</p>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Ghost + Puzzle */}
            <div className="stats-page-two-col">
              <section className="stats-page-section">
                <p className="stats-page-section-label" style={{ color: '#c040ff' }}>Ghost Mode</p>
                <div className="stats-page-grid stats-page-grid--2">
                  {[
                    { label: 'Ghost Rating', value: ghost?.rating == null ? '—' : String(ghost.rating),                            accent: '#c040ff' as string | null },
                    { label: 'Ghost Games',  value: String(ghost?.gamesPlayed ?? 0),                                                accent: null },
                    { label: 'Win Rate',     value: `${ghost?.winRate ?? 0}%`,                                                      accent: null },
                    { label: 'Best Win',     value: ghost?.bestWinMargin == null ? '—' : `${ghost.bestWinMargin} pts`,              accent: null },
                  ].map((s) => (
                    <div key={s.label} className="stats-page-statcard" style={s.accent ? { borderTopColor: s.accent } : undefined}>
                      <p className="stats-page-statcard__label">{s.label}</p>
                      <p className="stats-page-statcard__value" style={s.accent ? { color: s.accent } : undefined}>{s.value}</p>
                    </div>
                  ))}
                </div>
              </section>

              <section className="stats-page-section">
                <p className="stats-page-section-label" style={{ color: '#ffb800' }}>Daily Puzzle</p>
                <div className="stats-page-grid stats-page-grid--2">
                  {[
                    { label: 'Puzzle Streak', value: String(puzzle?.currentStreak ?? 0),                                            accent: '#ffb800' as string | null },
                    { label: 'Completions',   value: String(puzzle?.completions ?? 0),                                              accent: null },
                    { label: 'Best Score',    value: puzzle?.bestScoreToday == null ? '—' : String(puzzle.bestScoreToday),          accent: null },
                    { label: 'Perfect Days',  value: String(puzzle?.perfectDays ?? 0),                                             accent: null },
                  ].map((s) => (
                    <div key={s.label} className="stats-page-statcard" style={s.accent ? { borderTopColor: s.accent } : undefined}>
                      <p className="stats-page-statcard__label">{s.label}</p>
                      <p className="stats-page-statcard__value" style={s.accent ? { color: s.accent } : undefined}>{s.value}</p>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
