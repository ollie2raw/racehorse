import React, { useEffect, useState } from 'react';
import type { GhostProfileSummary } from './api';
import { fetchGhostProfileSummary, fetchGhostProfileSummaryByUsername } from './api';
import { fetchFriends, type FriendRecord } from '../friends/friendsApi';
import type { AppMode } from '../types';
import { GlobalNav } from '../components';
import '../bot/PlayVsFritz.css';
import './ghostMode.css';

const UNLOCK_THRESHOLD = 5;
const TRAINED_THRESHOLD = 30;
const FULL_LABEL_THRESHOLD = 15;
const FEATURED_GHOST_USERNAME = 'oliver';

const GHOST_DYNAMIC = '#c040ff';

function ghostTier(gamesPlayed: number): 'early' | 'learning' | 'trained' {
  if (gamesPlayed < FULL_LABEL_THRESHOLD) return 'early';
  if (gamesPlayed < TRAINED_THRESHOLD) return 'learning';
  return 'trained';
}

function formatDiagnosticDate(value: string | null | undefined): string {
  if (!value) return 'Not built yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const IconLightning = ({ color = 'currentColor' }: { color?: string }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M13 3L5 14H12L11 21L19 10H12L13 3Z" fill={color} />
  </svg>
);

const IconShield = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="M12 8v8" />
    <path d="M8 12h8" />
  </svg>
);

const IconBars = ({ size = 24 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round">
    <line x1="18" y1="20" x2="18" y2="10" />
    <line x1="12" y1="20" x2="12" y2="4" />
    <line x1="6" y1="20" x2="6" y2="14" />
  </svg>
);

const HOW_IT_WORKS: Array<{ n: string; title: string; copy: string }> = [
  { n: '01', title: 'Play Fritz matches', copy: 'Every match teaches your ghost your habits.' },
  { n: '02', title: 'Unlock at 5 games', copy: 'Then you can play against your own ghost.' },
  { n: '03', title: 'Gets sharper over time', copy: 'Around 30 games, it starts to feel much more like you.' },
];

function renderSparkline(scores: number[], compact?: boolean) {
  if (scores.length === 0) return null;
  const maxScore = Math.max(...scores, 1);
  const width = compact ? 140 : 220;
  const height = compact ? 32 : 56;
  const strokeW = compact ? 2 : 3;
  const rDot = compact ? 2.5 : 3.5;
  const step = scores.length > 1 ? width / (scores.length - 1) : width;
  const points = scores
    .map((score, index) => {
      const x = index * step;
      const y = height - (score / maxScore) * (height - 8) - 4;
      return `${x},${y}`;
    })
    .join(' ');
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={`ghost-sparkline${compact ? ' ghost-sparkline--compact' : ''}`} aria-hidden="true">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth={strokeW} strokeLinecap="round" strokeLinejoin="round" />
      {scores.map((score, index) => {
        const x = index * step;
        const y = height - (score / maxScore) * (height - 8) - 4;
        return <circle key={`${score}-${index}`} cx={x} cy={y} r={rDot} fill="currentColor" />;
      })}
    </svg>
  );
}

interface GhostSetupScreenProps {
  userId: string | null;
  fritzGamesPlayed?: number;
  onBack: () => void;
  onStart: (summary: GhostProfileSummary, opponentName: string, opponentUserId: string | null) => void;
  onNavigate?: (mode: AppMode) => void;
  onOpenAuth?: () => void;
  onOpenAccount?: () => void;
}

export default function GhostSetupScreen({
  userId,
  fritzGamesPlayed = 0,
  onBack,
  onStart,
  onNavigate,
  onOpenAuth,
  onOpenAccount,
}: GhostSetupScreenProps) {
  const [summary, setSummary] = useState<GhostProfileSummary | null>(null);
  const [loading, setLoading] = useState(Boolean(userId));
  const [error, setError] = useState<string | null>(null);
  const [friends, setFriends] = useState<FriendRecord[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(userId);
  const [selectedUsername, setSelectedUsername] = useState<string>('Your Ghost');
  const [featuredUserId, setFeaturedUserId] = useState<string | null>(null);
  const [featuredUsername, setFeaturedUsername] = useState<string>(FEATURED_GHOST_USERNAME);

  const isViewingOwnGhost = selectedUserId === userId;
  const isLocked = Boolean(userId) && isViewingOwnGhost && fritzGamesPlayed < UNLOCK_THRESHOLD;
  const canPlay = Boolean(summary) && !loading && !isLocked;
  const trainingGamesPlayed = summary?.gamesPlayed ?? fritzGamesPlayed;
  const tier = ghostTier(trainingGamesPlayed);

  useEffect(() => {
    let active = true;
    void fetchGhostProfileSummaryByUsername(FEATURED_GHOST_USERNAME)
      .then((result) => {
        if (!active) return;
        setFeaturedUserId(result.userId);
        setFeaturedUsername(result.username);
      })
      .catch(() => {
        if (!active) return;
        setFeaturedUserId(null);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (userId) {
      void fetchFriends(userId).then((res) => {
        if (!res.error) setFriends(res.friends);
      });
    }
  }, [userId]);

  useEffect(() => {
    if (!selectedUserId) {
      setLoading(false);
      setSummary(null);
      setError(null);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    void fetchGhostProfileSummary(selectedUserId)
      .then((data) => {
        if (!active) return;
        setSummary(data);
        setLoading(false);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Unable to load Ghost Mode.');
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedUserId]);

  const handleSelectFriend = (friend: FriendRecord | null) => {
    if (!friend) {
      setSelectedUserId(userId);
      setSelectedUsername('Your Ghost');
    } else {
      setSelectedUserId(friend.userId);
      setSelectedUsername(`${friend.username}'s Ghost`);
    }
  };

  const visibleFriends = friends.filter((f) => !featuredUserId || f.userId !== featuredUserId);

  const confidence = summary?.styleProfile?.confidence ?? 0;
  const confidencePct = Math.round(confidence * 100);
  const gamesToUnlock = Math.max(0, UNLOCK_THRESHOLD - fritzGamesPlayed);
  const recentScores = summary?.recentScores.slice(0, 5) ?? [];
  const compositeLog = summary?.compositeLog ?? null;
  const compositeSourceGames = compositeLog?.sourceGameIds.length ?? 0;
  const compositeStateCount = compositeLog?.states.length ?? 0;
  const styleSnapshotCount = compositeLog?.recentGameStyles.length ?? 0;
  const trainingHealth =
    !summary
      ? 'Unavailable'
      : trainingGamesPlayed === 0
        ? 'No completed games yet'
        : styleSnapshotCount === 0
          ? 'No usable style snapshots'
          : compositeStateCount === 0
            ? 'No playable move memory'
            : confidence < 0.85
              ? 'Still learning'
              : 'Healthy';

  const statusBadgeText =
    !userId || !summary
      ? 'GHOST MODE'
      : isLocked
        ? `EARLY GHOST — ${fritzGamesPlayed}/${UNLOCK_THRESHOLD} GAMES`
        : tier === 'trained'
          ? `TRAINED GHOST — ${confidencePct}% CONFIDENCE`
          : tier === 'learning'
            ? `LEARNING — ${confidencePct}% CONFIDENCE`
            : `EARLY GHOST — ${fritzGamesPlayed}/${UNLOCK_THRESHOLD} GAMES`;

  const tierSubLabel =
    tier === 'trained' ? 'Trained ghost' : tier === 'learning' ? 'Learning ghost' : 'Early ghost';

  return (
    <div
      className="pvf-root ghost-pvf-root tier-master mode-accent-ghost"
      style={{ '--pvf-dynamic-color': GHOST_DYNAMIC } as React.CSSProperties}
    >
      <div className="home-bg" aria-hidden="true">
        <div className="home-bg__halo" />
        <div className="home-bg__domino home-bg__domino--tl" />
        <div className="home-bg__domino home-bg__domino--tr" />
        <div className="home-bg__line home-bg__line--1" />
        <div className="home-bg__line home-bg__line--2" />
        <div className="home-bg__line home-bg__line--3" />
        <div className="home-bg__texture" />
      </div>
      <GlobalNav
        currentMode="ghostSetup"
        onNavigate={onNavigate || ((mode) => (mode === 'home' ? onBack() : undefined))}
        onOpenAuth={onOpenAuth}
        onOpenAccount={onOpenAccount}
        activeColor={GHOST_DYNAMIC}
      />

      <div className="pvf-layout">
        <div className="pvf-left-col">
          <button type="button" className="pvf-back-btn rh-back-button" onClick={onBack}>
            <span>←</span> Back to Single Player
          </button>

          <div className="pvf-header">
            <div className="pvf-label">SINGLE PLAYER</div>
            <h1 className="pvf-title">Ghost Mode</h1>
            <p className="pvf-subtitle">
              {userId
                ? 'Train a rolling model of how you play from Fritz matches, then spar against your ghost—or a friend’s.'
                : 'Ghost Mode is tied to your account and training progress. Sign in to build and play your ghost.'}
            </p>
          </div>

          <div className="pvf-opponent-card ghost-pvf-opponent-card">
            <img src="/fritzGHOST.png" className="pvf-card-bg-img ghost-pvf-card-bg-img" alt="" />
            <div className="pvf-card-overlay" />
            <div className="pvf-card-content">
              <div className="pvf-card-header">
                <div className="pvf-card-eyebrow">YOUR GHOST</div>
                <h2 className="pvf-card-name">Ghost</h2>
                <p className="pvf-card-description">
                  Your ghost learns how you play from Fritz matches. Unlock it in five games, then sharpen it as you keep
                  playing.
                </p>
              </div>

              <div className="pvf-card-badges">
                <div className="pvf-card-badge">
                  <div className="pvf-card-badge-header">
                    <IconLightning color="var(--pvf-dynamic-color)" />
                    <span className="pvf-card-badge-title">Play Fritz matches</span>
                  </div>
                  <div className="pvf-card-badge-desc">Every match teaches your ghost your habits.</div>
                </div>
                <div className="pvf-card-badge">
                  <div className="pvf-card-badge-header">
                    <span style={{ color: 'var(--pvf-dynamic-color)', display: 'flex' }}>
                      <IconShield />
                    </span>
                    <span className="pvf-card-badge-title" style={{ color: 'var(--pvf-dynamic-color)' }}>
                      Unlock at 5 games
                    </span>
                  </div>
                  <div className="pvf-card-badge-desc">Then you can play against your own ghost.</div>
                </div>
                <div className="pvf-card-badge">
                  <div className="pvf-card-badge-header">
                    <span style={{ color: 'var(--pvf-dynamic-color)', display: 'flex' }}>
                      <IconBars size={14} />
                    </span>
                    <span className="pvf-card-badge-title" style={{ color: 'var(--pvf-dynamic-color)' }}>
                      Gets sharper over time
                    </span>
                  </div>
                  <div className="pvf-card-badge-desc">Around 30 games, it starts to feel much more like you.</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="pvf-control-panel">
          {!userId ? (
            <div className="ghost-pvf-control-body ghost-pvf-control-body--signedout">
              <div className="pvf-section">
                <div className="fritz-section-label">1. ACCOUNT</div>
                <p className="ghost-pvf-plain ghost-pvf-plain--tight">
                  Create an account so the game can build your ghost from completed Fritz runs.
                </p>
              </div>
              <div className="pvf-section-gap ghost-pvf-signout-cta">
                <button type="button" className="pvf-start-btn" disabled style={{ opacity: 0.45, cursor: 'not-allowed' }}>
                  <span>Play Ghost</span>
                  <span className="pvf-start-arrow">›</span>
                </button>
                <a className="pvf-view-tiers" href="#" onClick={(e) => { e.preventDefault(); onBack(); }}>
                  Back to Home ›
                </a>
              </div>
            </div>
          ) : (
            <div className="ghost-pvf-control-body">
              <div className="pvf-section ghost-pvf-section--status">
                <div className="fritz-section-label">1. GHOST STATUS</div>
                <div className="pvf-difficulty-grid ghost-pvf-status-grid">
                  <div className="pvf-tier-card ghost-pvf-stat-card">
                    <div className="pvf-tier-icon" style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.12em' }}>
                      ●
                    </div>
                    <div className="pvf-tier-name" style={{ fontSize: 13, lineHeight: 1.25 }}>
                      {loading ? 'Loading…' : statusBadgeText}
                    </div>
                    <div className="pvf-tier-elo" style={{ fontSize: 14, color: 'var(--pvf-dynamic-color)' }}>
                      {summary?.styleProfile ? `${confidencePct}%` : '—'}
                    </div>
                    <div className="pvf-tier-desc">Style confidence</div>
                  </div>
                  <div className="pvf-tier-card ghost-pvf-stat-card">
                    <div className="pvf-tier-icon">
                      <IconBars size={22} />
                    </div>
                    <div className="pvf-tier-name">Avg Pts</div>
                    <div className="pvf-tier-elo" style={{ color: 'var(--pvf-dynamic-color)' }}>
                      {summary?.avgScore == null || loading ? '—' : summary.avgScore}
                    </div>
                    <div className="pvf-tier-desc">Recent performance</div>
                  </div>
                  <div className="pvf-tier-card ghost-pvf-stat-card">
                    <div className="pvf-tier-icon" style={{ fontSize: 12, fontWeight: 900, opacity: 0.85 }}>
                      5
                    </div>
                    <div className="pvf-tier-name">Last 5 Scores</div>
                    <div className="pvf-tier-desc ghost-pvf-tier-scores">
                      {recentScores.length > 0 && !loading && !error && summary && !isLocked ? (
                        <>
                          <div className="ghost-score-list ghost-score-list--pvf">
                            {recentScores.map((score, index) => (
                              <span key={`${score}-${index}`} className="ghost-score-pill ghost-score-pill--sharp">
                                {score}
                              </span>
                            ))}
                          </div>
                          {renderSparkline(recentScores, true)}
                        </>
                      ) : (
                        <span style={{ color: 'var(--pvf-muted)' }}>—</span>
                      )}
                    </div>
                  </div>
                </div>

                {selectedUserId && loading && (
                  <p className="ghost-pvf-plain">Preparing {selectedUsername}…</p>
                )}
                {selectedUserId && !loading && error && <p className="ghost-pvf-plain">{error}</p>}
                {isLocked && (
                  <div className="ghost-pvf-locked-block">
                    <p className="ghost-locked-title">Your ghost unlocks after {UNLOCK_THRESHOLD} Fritz games.</p>
                    <p className="ghost-flat-body">
                      Complete <strong>{gamesToUnlock}</strong> more Fritz {gamesToUnlock === 1 ? 'game' : 'games'} to start playing.
                    </p>
                    <div className="ghost-progress-row">
                      <div className="ghost-progress-bar">
                        <div
                          className="ghost-progress-fill"
                          style={{ width: `${Math.min(100, (fritzGamesPlayed / UNLOCK_THRESHOLD) * 100)}%` }}
                        />
                      </div>
                      <span className="ghost-progress-label">
                        {fritzGamesPlayed}/{UNLOCK_THRESHOLD}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <div className="pvf-section-gap ghost-pvf-section--how">
                <div className="fritz-section-label">2. HOW IT WORKS</div>
                <div className="pvf-deal-grid ghost-pvf-deal-row">
                  {HOW_IT_WORKS.map((s) => (
                    <div key={s.n} className="pvf-deal-card ghost-pvf-stat-card">
                      <div
                        className="pvf-deal-icon"
                        style={{
                          fontFamily: 'var(--font-display)',
                          fontSize: 22,
                          fontWeight: 900,
                          color: 'rgba(255,255,255,0.28)',
                        }}
                      >
                        {s.n}
                      </div>
                      <div className="pvf-deal-content">
                        <div className="pvf-deal-label" style={{ color: 'var(--pvf-dynamic-color)' }}>
                          {s.title}
                        </div>
                        <div className="pvf-deal-sub">{s.copy}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="ghost-pvf-milestone-strip" aria-label="Ghost training milestones">
                  <span className="ghost-pvf-milestone-strip__item">Unlocks at 5 games</span>
                  <span className="ghost-pvf-milestone-strip__sep" aria-hidden="true">
                    ·
                  </span>
                  <span className="ghost-pvf-milestone-strip__item">15 — Learning</span>
                  <span className="ghost-pvf-milestone-strip__sep" aria-hidden="true">
                    ·
                  </span>
                  <span className="ghost-pvf-milestone-strip__item">30 — Trained ✓</span>
                </div>
              </div>

              <div className="pvf-section-gap ghost-pvf-select-section">
                <div className="fritz-section-label">3. SELECT OPPONENT</div>
                <div className="ghost-pvf-opponent-scroll">
                  <button
                    type="button"
                    className={`fritz-selectable-row${selectedUserId === userId ? ' fritz-selectable-row--active' : ''}`}
                    onClick={() => handleSelectFriend(null)}
                  >
                    <div className="fritz-summary-icon" style={{ color: 'var(--pvf-dynamic-color)' }}>
                      <span style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 900 }}>Y</span>
                    </div>
                    <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                      <div className="fritz-summary-value">You</div>
                      <div className="fritz-summary-key">{tierSubLabel}</div>
                    </div>
                  </button>
                  <button
                    type="button"
                    className={[
                      'fritz-selectable-row',
                      'ghost-pvf-row--featured',
                      featuredUserId && selectedUserId === featuredUserId ? 'fritz-selectable-row--active' : '',
                      !featuredUserId ? 'fritz-selectable-row--muted' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    disabled={!featuredUserId}
                    onClick={() =>
                      featuredUserId &&
                      handleSelectFriend({
                        id: 'featured',
                        userId: featuredUserId,
                        username: featuredUsername,
                        online: true,
                      })
                    }
                  >
                    <div className="fritz-summary-icon" style={{ color: 'var(--pvf-dynamic-color)' }}>
                      <span style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 900 }}>★</span>
                    </div>
                    <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                      <div className="fritz-summary-value">@{featuredUsername}</div>
                      <div className="fritz-summary-key">Trained ghost</div>
                    </div>
                  </button>
                  {visibleFriends.map((f) => (
                    <button
                      type="button"
                      key={f.userId}
                      className={`fritz-selectable-row${selectedUserId === f.userId ? ' fritz-selectable-row--active' : ''}`}
                      onClick={() => handleSelectFriend(f)}
                    >
                      <div className="fritz-summary-icon" style={{ color: 'var(--pvf-dynamic-color)' }}>
                        <span style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 900 }}>
                          {(f.username[0] ?? '?').toUpperCase()}
                        </span>
                      </div>
                      <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                        <div className="fritz-summary-value">{f.username}</div>
                        <div className="fritz-summary-key">Friend ghost</div>
                      </div>
                    </button>
                  ))}
                </div>

                <div className="ghost-training-diagnostics">
                  Ghost diagnostics: {trainingHealth}. Training counter {trainingGamesPlayed}; recent logs {compositeSourceGames}; style
                  snapshots {styleSnapshotCount}; move memory {compositeStateCount}; padding games {summary?.paddingGames ?? 0}; average turn
                  points{' '}
                  {summary?.styleProfile ? summary.styleProfile.avgTurnPoints.toFixed(1) : 'unavailable'}; rebuilt{' '}
                  {formatDiagnosticDate(compositeLog?.generatedAt)}.
                </div>

                <p className="fritz-summary-note ghost-pvf-cta-note">
                  {!userId
                    ? 'Sign in to unlock this mode'
                    : isLocked
                      ? `Unlocks after ${UNLOCK_THRESHOLD} Fritz games`
                      : loading
                        ? 'Loading ghost profile…'
                        : summary
                          ? `Opponent: ${selectedUsername}`
                          : 'Ghost profile unavailable'}
                </p>
                <button
                  type="button"
                  className="pvf-start-btn ghost-pvf-start-btn"
                  onClick={() => summary && onStart(summary, selectedUsername, selectedUserId)}
                  disabled={!canPlay}
                  style={{
                    background: canPlay
                      ? `linear-gradient(180deg, ${GHOST_DYNAMIC} 0%, ${GHOST_DYNAMIC}CC 100%)`
                      : undefined,
                    boxShadow: canPlay ? `0 0 32px ${GHOST_DYNAMIC}33, inset 0 1px 0 rgba(255,255,255,0.4)` : undefined,
                    opacity: canPlay ? 1 : 0.45,
                    cursor: canPlay ? 'pointer' : 'not-allowed',
                  }}
                >
                  <span>Play Ghost</span>
                  <span className="pvf-start-arrow">›</span>
                </button>
                <a className="pvf-view-tiers" href="#" onClick={(e) => { e.preventDefault(); onBack(); }}>
                  Back to Home ›
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
