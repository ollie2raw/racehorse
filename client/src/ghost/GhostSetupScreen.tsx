import React, { useCallback, useEffect, useState } from 'react';
import type { GhostProfileSummary } from './api';
import { fetchGhostProfileSummary, fetchGhostProfileSummaryByUsername } from './api';
import { fetchFriends, type FriendRecord } from '../friends/friendsApi';
import type { AppMode } from '../types';
import { GlobalNav } from '../components';
import { useDeferredAsset } from '../ui/useDeferredAsset';
import '../bot/PlayVsFritz.css';
import './ghostMode.css';

const UNLOCK_THRESHOLD = 5;
const FEATURED_GHOST_USERNAME = 'oliver';

/** Matches Single Player hub Ghost Mode card (`SinglePlayerHubScreen`). */
const GHOST_ACCENT = '#4FC3F7';
const ELITE_GOLD = '#E7B64A';

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
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
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

const IconBars = ({ size = 24, color = 'currentColor' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="3.5" strokeLinecap="round">
    <line x1="18" y1="20" x2="18" y2="10" />
    <line x1="12" y1="20" x2="12" y2="4" />
    <line x1="6" y1="20" x2="6" y2="14" />
  </svg>
);

const IconCrown = ({ color = 'currentColor', size = 26 }: { color?: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z" fill={color} />
  </svg>
);

const IconTrend = ({ color = 'currentColor' }: { color?: string }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </svg>
);

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
  const loadHeroAsset = useCallback(
    () => import('../assets/ghost/ghostblue.webp'),
    [],
  );
  const heroSrc = useDeferredAsset('ghost-setup-hero', loadHeroAsset);
  const isViewingOwnGhost = selectedUserId === userId;
  const isLocked = Boolean(userId) && isViewingOwnGhost && fritzGamesPlayed < UNLOCK_THRESHOLD;
  const canPlay = Boolean(summary) && !loading && !isLocked;
  const trainingGamesPlayed = summary?.gamesPlayed ?? fritzGamesPlayed;

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

  const isOliverSelected = Boolean(featuredUserId && selectedUserId === featuredUserId);
  const isOwnGhostSelected = Boolean(userId && selectedUserId === userId && !isOliverSelected);
  const hasFriends = visibleFriends.length > 0;
  const lastFiveLabel =
    recentScores.length > 0 && !loading && !error && summary && !isLocked
      ? recentScores.join(' · ')
      : '—';

  const renderOpponentRow = (
    key: string,
    opts: {
      selected: boolean;
      variant: 'gold' | 'purple';
      onClick: () => void;
      icon: React.ReactNode;
      name: string;
      label: string;
    },
  ) => {
    const { selected, variant, onClick, icon, name, label } = opts;
    return (
      <div
        key={key}
        role="button"
        tabIndex={0}
        className={[
          'fritz-selectable-row',
          'ghost-pvf-opponent-row',
          `ghost-pvf-opponent-row--${variant}`,
          selected && 'fritz-selectable-row--active',
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick();
          }
        }}
      >
        <div className="ghost-pvf-opponent-row__icon">{icon}</div>
        <div className="ghost-pvf-opponent-row__body">
          <div className="ghost-pvf-opponent-row__name">{name}</div>
          <div className="ghost-pvf-opponent-row__label">{label}</div>
        </div>
        {selected ? (
          <div className="ghost-pvf-opponent-row__check" aria-hidden>
            ✓
          </div>
        ) : (
          <div className="ghost-pvf-opponent-row__check ghost-pvf-opponent-row__check--empty" aria-hidden />
        )}
      </div>
    );
  };

  return (
    <div
      className="pvf-root ghost-pvf-root tier-standard mode-accent-ghost"
      style={
        {
          '--pvf-dynamic-color': GHOST_ACCENT,
          '--pvf-active-color': GHOST_ACCENT,
        } as React.CSSProperties
      }
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
        activeColor={GHOST_ACCENT}
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
            {heroSrc ? (
              <img
                src={heroSrc}
                className="pvf-card-bg-img ghost-pvf-card-bg-img"
                alt=""
                decoding="async"
                loading="lazy"
              />
            ) : null}
            <div className="pvf-card-overlay ghost-pvf-card-overlay" />
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
              <div className="pvf-section ghost-pvf-section--opponent">
                <div className="fritz-section-label">1. CHOOSE OPPONENT</div>
                <div className="ghost-pvf-opponent-stack">
                  {renderOpponentRow('featured-oliver', {
                    selected: isOliverSelected,
                    variant: 'gold',
                    onClick: () => {
                      if (featuredUserId) {
                        handleSelectFriend({
                          id: 'featured',
                          userId: featuredUserId,
                          username: featuredUsername,
                          online: true,
                        });
                      }
                    },
                    icon: <IconCrown color={ELITE_GOLD} size={18} />,
                    name: 'Oliver · Master',
                    label: 'FEATURED',
                  })}

                  <div className="ghost-pvf-friend-block">
                    <div className="ghost-pvf-friend-section-head">
                      <div className="ghost-pvf-friend-picker__label">OR CHALLENGE A FRIEND</div>
                      {hasFriends ? (
                        <span className="ghost-pvf-friend-count" aria-label={`${visibleFriends.length} friends`}>
                          {visibleFriends.length}
                        </span>
                      ) : null}
                    </div>
                    <div className="ghost-pvf-friend-list" role="listbox" aria-label="Friends with trained ghosts">
                      {userId
                        ? renderOpponentRow('own-ghost', {
                            selected: isOwnGhostSelected,
                            variant: 'purple',
                            onClick: () => handleSelectFriend(null),
                            icon: <span className="ghost-pvf-opponent-row__initial">Y</span>,
                            name: 'Your Ghost',
                            label: 'YOUR MODEL',
                          })
                        : null}
                      {hasFriends
                        ? visibleFriends.map((f) =>
                            renderOpponentRow(f.userId, {
                              selected: selectedUserId === f.userId && !isOliverSelected,
                              variant: 'purple',
                              onClick: () => handleSelectFriend(f),
                              icon: (
                                <span className="ghost-pvf-opponent-row__initial">
                                  {(f.username[0] ?? '?').toUpperCase()}
                                </span>
                              ),
                              name: f.username,
                              label: 'TRAINED GHOST',
                            }),
                          )
                        : (
                            <div className="ghost-pvf-friend-empty fritz-selectable-row fritz-selectable-row--muted">
                              <div className="ghost-pvf-opponent-row__body">
                                <div className="ghost-pvf-opponent-row__name">No friends yet</div>
                                <div className="ghost-pvf-opponent-row__label">ADD FRIENDS TO CHALLENGE THEIR GHOSTS</div>
                              </div>
                            </div>
                          )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="pvf-section-gap ghost-pvf-section--status">
                <div className="fritz-section-label">2. GHOST STATUS</div>
                <div className="fritz-summary-strip fritz-summary-strip--mb-lg ghost-pvf-status-strip">
                  <div className="fritz-summary-item">
                    <div className="fritz-summary-icon" style={{ color: GHOST_ACCENT }}>
                      <IconShield />
                    </div>
                    <div>
                      <div className="fritz-summary-value">
                        {loading ? '—' : summary?.styleProfile ? `${confidencePct}%` : '—'}
                      </div>
                      <div className="fritz-summary-key">Confidence</div>
                    </div>
                  </div>
                  <div className="fritz-summary-divider" aria-hidden />
                  <div className="fritz-summary-item">
                    <div className="fritz-summary-icon" style={{ color: GHOST_ACCENT }}>
                      <IconBars size={18} color={GHOST_ACCENT} />
                    </div>
                    <div>
                      <div className="fritz-summary-value">
                        {summary?.avgScore == null || loading ? '—' : summary.avgScore}
                      </div>
                      <div className="fritz-summary-key">Avg Pts</div>
                    </div>
                  </div>
                  <div className="fritz-summary-divider" aria-hidden />
                  <div className="fritz-summary-item">
                    <div className="fritz-summary-icon" style={{ color: GHOST_ACCENT }}>
                      <IconTrend color={GHOST_ACCENT} />
                    </div>
                    <div>
                      <div className="fritz-summary-value ghost-pvf-last-five-value">{lastFiveLabel}</div>
                      <div className="fritz-summary-key">Last 5</div>
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

              <div className="pvf-section-gap ghost-pvf-section--play">
                <div className="fritz-section-label">3. START MATCH</div>
                <div className="ghost-training-diagnostics">
                  Ghost diagnostics: {trainingHealth}. Training counter {trainingGamesPlayed}; recent logs {compositeSourceGames}; style
                  snapshots {styleSnapshotCount}; move memory {compositeStateCount}; padding games {summary?.paddingGames ?? 0}; average turn
                  points{' '}
                  {summary?.styleProfile ? summary.styleProfile.avgTurnPoints.toFixed(1) : 'unavailable'}; rebuilt{' '}
                  {formatDiagnosticDate(compositeLog?.generatedAt)}.
                </div>

                <p className="fritz-summary-note ghost-pvf-cta-note">
                  {isLocked
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
                      ? `linear-gradient(180deg, ${GHOST_ACCENT} 0%, ${GHOST_ACCENT}CC 100%)`
                      : undefined,
                    boxShadow: canPlay ? `0 0 32px ${GHOST_ACCENT}33, inset 0 1px 0 rgba(255,255,255,0.4)` : undefined,
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
