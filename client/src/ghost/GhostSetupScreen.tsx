import { useEffect, useState } from 'react';
import type { GhostProfileSummary } from './api';
import { fetchGhostProfileSummary, fetchGhostProfileSummaryByUsername } from './api';
import { fetchFriends, type FriendRecord } from '../friends/friendsApi';
import {
  ClaudeModeScreen,
  ClaudePrimaryAction,
  ClaudeSecondaryAction,
  ClaudeSectionLabel,
} from '../ui/claudeMode';
import './ghostMode.css';

const UNLOCK_THRESHOLD = 5;
const TRAINED_THRESHOLD = 30;
const FULL_LABEL_THRESHOLD = 15;
const FEATURED_GHOST_USERNAME = 'oliver';

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

function renderSparkline(scores: number[]) {
  if (scores.length === 0) return null;
  const maxScore = Math.max(...scores, 1);
  const width = 220;
  const height = 56;
  const step = scores.length > 1 ? width / (scores.length - 1) : width;
  const points = scores
    .map((score, index) => {
      const x = index * step;
      const y = height - (score / maxScore) * (height - 8) - 4;
      return `${x},${y}`;
    })
    .join(' ');
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="ghost-sparkline" aria-hidden="true">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      {scores.map((score, index) => {
        const x = index * step;
        const y = height - (score / maxScore) * (height - 8) - 4;
        return <circle key={`${score}-${index}`} cx={x} cy={y} r="3.5" fill="currentColor" />;
      })}
    </svg>
  );
}

interface GhostSetupScreenProps {
  userId: string | null;
  fritzGamesPlayed?: number;
  onBack: () => void;
  onStart: (summary: GhostProfileSummary, opponentName: string, opponentUserId: string | null) => void;
}

export default function GhostSetupScreen({ userId, fritzGamesPlayed = 0, onBack, onStart }: GhostSetupScreenProps) {
  const [summary, setSummary] = useState<GhostProfileSummary | null>(null);
  const [loading, setLoading] = useState(Boolean(userId));
  const [error, setError] = useState<string | null>(null);
  const [friends, setFriends] = useState<FriendRecord[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(userId);
  const [selectedUsername, setSelectedUsername] = useState<string>('Your Ghost');
  const [featuredUserId, setFeaturedUserId] = useState<string | null>(null);
  const [featuredUsername, setFeaturedUsername] = useState<string>(FEATURED_GHOST_USERNAME);

  const isViewingOwnGhost = selectedUserId === userId;
  const isLocked = isViewingOwnGhost && fritzGamesPlayed < UNLOCK_THRESHOLD;
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
    return () => { active = false; };
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
    return () => { active = false; };
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

  const visibleFriends = friends.filter(
    (f) => !featuredUserId || f.userId !== featuredUserId,
  );

  const confidence = summary?.styleProfile?.confidence ?? 0;
  const confidencePct = Math.round(confidence * 100);
  const gamesToUnlock = Math.max(0, UNLOCK_THRESHOLD - fritzGamesPlayed);
  const gamesToTrained = Math.max(0, TRAINED_THRESHOLD - trainingGamesPlayed);
  const recentScores = summary?.recentScores.slice(0, 5) ?? [];
  const compositeLog = summary?.compositeLog ?? null;
  const compositeSourceGames = compositeLog?.sourceGameIds.length ?? 0;
  const compositeStateCount = compositeLog?.states.length ?? 0;
  const styleSnapshotCount = compositeLog?.recentGameStyles.length ?? 0;
  const gamesToReliableStyle = Math.max(0, FULL_LABEL_THRESHOLD - styleSnapshotCount);
  const gamesToMaxConfidence = Math.max(0, 20 - styleSnapshotCount);
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

  if (!userId) {
    return (
      <div className="screen ghost-setup-screen mode-subpage-screen mode-accent-ghost claude-mode-screen-shell">
        <ClaudeModeScreen
          accent="#a78bfa"
          eyebrow="Single Player"
          title={'GHOST\nMODE'}
          description="Ghost Mode is tied to your account and training progress."
          decor="G"
          backLabel="Back to Home"
          onBack={onBack}
          panel={
            <div className="claude-mode-panel-stack">
              <div className="ghost-setup-panel">
                <ClaudeSectionLabel color="#a78bfa">Sign In Required</ClaudeSectionLabel>
                <h3>Ghost Mode tracks your rolling self.</h3>
                <p>Create an account so the game can build your ghost from completed Fritz runs.</p>
              </div>
            </div>
          }
        />
      </div>
    );
  }

  // Build hero footer: style bars if we have a profile, otherwise training chips
  const ghostHeroFooter = summary?.styleProfile ? (
    <div className="ghost-hero-style-bars">
      {[
        { label: 'Scoring Bias',    val: summary.styleProfile.scoringBias },
        { label: 'Double Priority', val: summary.styleProfile.doublePriority },
        { label: 'Board Control',   val: summary.styleProfile.attackSetup },
        { label: 'Branching',       val: summary.styleProfile.branchingFrequency },
      ].map((s) => (
        <div key={s.label} className="ghost-hero-style-bar-row">
          <div className="ghost-hero-style-bar-meta">
            <span className="ghost-hero-style-bar-label">{s.label}</span>
            <span className="ghost-hero-style-bar-pct">{Math.round(s.val * 100)}%</span>
          </div>
          <div className="ghost-hero-style-bar-track">
            <div className="ghost-hero-style-bar-fill" style={{ width: `${s.val * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  ) : (
    <div className="claude-mode-chip-row">
      <span className="claude-mode-chip">{selectedUsername}</span>
      <span className="claude-mode-chip">{trainingGamesPlayed} training games</span>
      <span className="claude-mode-chip">{confidencePct}% style confidence</span>
    </div>
  );

  return (
    <div className="screen ghost-setup-screen mode-subpage-screen mode-accent-ghost claude-mode-screen-shell">
      <ClaudeModeScreen
        accent="#c040ff"
        eyebrow="Single Player"
        title={'GHOST\nMODE'}
        decor="G"
        backLabel="Back to Single Player"
        onBack={onBack}
        heroFooter={ghostHeroFooter}
        panel={
          <div className="ghost-claude-panel-v2">

            {/* ── Ghost stats header ── */}
            {selectedUserId && !loading && !error && summary && !isLocked && (
              <div className="ghost-stats-header">
                <div className="ghost-stats-header__left">
                  <div className="ghost-stats-badge">
                    <span className="ghost-stats-badge__dot" aria-hidden="true" />
                    {tier === 'trained'
                      ? `TRAINED GHOST — ${confidencePct}% CONFIDENCE`
                      : tier === 'learning'
                        ? `LEARNING — ${confidencePct}% CONFIDENCE`
                        : `EARLY GHOST — ${fritzGamesPlayed}/${UNLOCK_THRESHOLD} GAMES`}
                  </div>
                  <div className="ghost-stats-avg">
                    <span className="ghost-stats-avg__value">
                      {summary.avgScore == null ? '—' : summary.avgScore}
                    </span>
                    <span className="ghost-stats-avg__unit">AVG PTS</span>
                  </div>
                </div>
                {summary.styleProfile && (
                  <div className="ghost-confidence-ring" title={`${confidencePct}% style confidence`}>
                    <svg viewBox="0 0 50 50" className="ghost-ring-svg">
                      <circle cx="25" cy="25" r="20" fill="none" stroke="rgba(192,64,255,0.12)" strokeWidth="3" />
                      <circle
                        cx="25" cy="25" r="20" fill="none"
                        stroke="#c040ff" strokeWidth="3"
                        strokeDasharray={`${(confidencePct / 100) * 125.66} 125.66`}
                        strokeLinecap="round"
                        transform="rotate(-90 25 25)"
                      />
                    </svg>
                    <span className="ghost-ring-label">{confidencePct}%</span>
                  </div>
                )}
              </div>
            )}

            {/* ── Loading / error states ── */}
            {selectedUserId && loading && (
              <div className="ghost-flat-section">
                <ClaudeSectionLabel color="#c040ff">Loading Ghost Profile</ClaudeSectionLabel>
                <p className="ghost-flat-body">Preparing {selectedUsername}…</p>
              </div>
            )}

            {selectedUserId && !loading && error && (
              <div className="ghost-flat-section">
                <ClaudeSectionLabel color="#c040ff">Ghost Unavailable</ClaudeSectionLabel>
                <p className="ghost-flat-body">{error}</p>
              </div>
            )}

            {/* ── Locked state ── */}
            {isLocked && (
              <div className="ghost-flat-section">
                <ClaudeSectionLabel color="#c040ff">Locked</ClaudeSectionLabel>
                <p className="ghost-locked-title">Your ghost unlocks after {UNLOCK_THRESHOLD} Fritz games.</p>
                <p className="ghost-flat-body">
                  Complete <strong>{gamesToUnlock}</strong> more Fritz {gamesToUnlock === 1 ? 'game' : 'games'} to start playing.
                </p>
                <div className="ghost-progress-row">
                  <div className="ghost-progress-bar">
                    <div className="ghost-progress-fill" style={{ width: `${Math.min(100, (fritzGamesPlayed / UNLOCK_THRESHOLD) * 100)}%` }} />
                  </div>
                  <span className="ghost-progress-label">{fritzGamesPlayed}/{UNLOCK_THRESHOLD}</span>
                </div>
              </div>
            )}

            {/* ── Last 5 scores + sparkline ── */}
            {!loading && !error && summary && !isLocked && recentScores.length > 0 && (
              <div className="ghost-flat-section">
                <ClaudeSectionLabel color="#c040ff">Last 5 Scores</ClaudeSectionLabel>
                <div className="ghost-score-list">
                  {recentScores.map((score, index) => (
                    <span key={`${score}-${index}`} className="ghost-score-pill ghost-score-pill--sharp">
                      {score}
                    </span>
                  ))}
                </div>
                {renderSparkline(recentScores)}
              </div>
            )}

            {/* ── How it works ── */}
            <div className="ghost-flat-section">
              <ClaudeSectionLabel color="#c040ff">How It Works</ClaudeSectionLabel>
              {[
                { n: '01', title: 'Play Fritz matches',    copy: 'Every match teaches your ghost your habits.' },
                { n: '02', title: 'Unlock at 5 games',     copy: 'Then you can play against your own ghost.' },
                { n: '03', title: 'Gets sharper over time', copy: 'Around 30 games, it starts to feel much more like you.' },
              ].map((s) => (
                <div key={s.n} className="ghost-how-row">
                  <span className="ghost-how-num">{s.n}</span>
                  <div>
                    <p className="ghost-how-title">{s.title}</p>
                    <p className="ghost-how-copy">{s.copy}</p>
                  </div>
                </div>
              ))}
              <div className="ghost-tier-pills">
                <span className="ghost-tier-pill active">Unlocks at 5 games</span>
                <span className={`ghost-tier-pill ${trainingGamesPlayed >= FULL_LABEL_THRESHOLD ? 'active' : ''}`}>15 — Learning</span>
                <span className={`ghost-tier-pill ${trainingGamesPlayed >= TRAINED_THRESHOLD ? 'active' : ''}`}>30 — Trained ✓</span>
              </div>
            </div>

            {/* ── Opponent selector (sharp rows) ── */}
            {userId && (
              <div className="ghost-flat-section">
                <ClaudeSectionLabel color="#c040ff">Select Opponent</ClaudeSectionLabel>
                <div className="ghost-opponent-list">
                  <button
                    className={`ghost-opponent-row ${selectedUserId === userId ? 'is-active' : ''}`}
                    onClick={() => handleSelectFriend(null)}
                  >
                    <div>
                      <span className="ghost-opponent-name">You</span>
                      <span className="ghost-opponent-sub">
                        {tier === 'trained' ? 'Trained ghost' : tier === 'learning' ? 'Learning ghost' : 'Early ghost'}
                      </span>
                    </div>
                    <span className="ghost-opponent-dot" aria-hidden="true" />
                  </button>
                  <button
                    className={`ghost-opponent-row ghost-opponent-row--featured ${selectedUserId === featuredUserId ? 'is-active' : ''}`}
                    onClick={() => featuredUserId && handleSelectFriend({ id: 'featured', userId: featuredUserId, username: featuredUsername, online: true })}
                  >
                    <div>
                      <span className="ghost-opponent-name">@{featuredUsername}</span>
                      <span className="ghost-opponent-sub">Trained ghost</span>
                    </div>
                    <span className="ghost-opponent-dot" aria-hidden="true" />
                  </button>
                  {visibleFriends.map((f) => (
                    <button
                      key={f.userId}
                      className={`ghost-opponent-row ${selectedUserId === f.userId ? 'is-active' : ''}`}
                      onClick={() => handleSelectFriend(f)}
                    >
                      <div>
                        <span className="ghost-opponent-name">{f.username}</span>
                        <span className="ghost-opponent-sub">Friend ghost</span>
                      </div>
                      <span className="ghost-opponent-dot" aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ── Hidden diagnostics (screen-reader / debug) ── */}
            <div className="ghost-training-diagnostics">
              Ghost diagnostics: {trainingHealth}. Training counter {trainingGamesPlayed};
              recent logs {compositeSourceGames}; style snapshots {styleSnapshotCount};
              move memory {compositeStateCount}; padding games {summary?.paddingGames ?? 0};
              average turn points {summary?.styleProfile ? summary.styleProfile.avgTurnPoints.toFixed(1) : 'unavailable'};
              rebuilt {formatDiagnosticDate(compositeLog?.generatedAt)}.
            </div>

            {/* ── CTA ── */}
            <div className="ghost-cta-section">
              <ClaudePrimaryAction
                accent="#c040ff"
                title="Play Ghost"
                meta={
                  !userId
                    ? 'Sign in to unlock this mode'
                    : isLocked
                      ? `Unlocks after ${UNLOCK_THRESHOLD} Fritz games`
                      : loading
                        ? 'Loading ghost profile…'
                        : summary
                          ? `Opponent: ${selectedUsername}`
                          : 'Ghost profile unavailable'
                }
                onClick={() => summary && onStart(summary, selectedUsername, selectedUserId)}
                disabled={!canPlay}
              />
              <ClaudeSecondaryAction
                title="Back to Home"
                meta="Return to game mode menu"
                onClick={onBack}
              />
            </div>
          </div>
        }
      />
    </div>
  );
}
