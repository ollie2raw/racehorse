import { useEffect, useState } from 'react';
import LayoutScreen from '../ui/LayoutScreen';
import type { GhostProfileSummary } from './api';
import { fetchGhostProfileSummary, fetchGhostProfileSummaryByUsername } from './api';
import { fetchFriends, type FriendRecord } from '../friends/friendsApi';
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
      <LayoutScreen
        className="screen mode-subpage-screen mode-accent-ghost mode-auth-gate-screen"
        badge="Compete"
        title="Sign In Required"
        subtitle="Ghost Mode is tied to your account and training progress."
        contentClassName="mode-auth-gate-content"
      >
        <button className="mode-inline-btn" onClick={onBack}>Back to Home</button>
      </LayoutScreen>
    );
  }

  return (
    <LayoutScreen
      className="ghost-setup-screen mode-subpage-screen mode-accent-ghost"
      badge="Compete"
      title="Ghost Mode"
      subtitle="Play against a version of yourself — or a friend — trained on real Fritz matches."
      contentClassName="screen-shell ghost-setup-content"
    >
      <div className="ghost-setup-grid">
        <div className="ghost-setup-left-col">
          <div className="ghost-explainer-panel">
            <p className="ghost-setup-eyebrow">How to use Ghost Mode</p>
            <h3 className="ghost-explainer-title">Play the ghost that learns how you play.</h3>
            <div className="ghost-explainer-steps" aria-label="Ghost mode steps">
              <div className="ghost-explainer-step">
                <span className="ghost-explainer-step-num">1</span>
                <div>
                  <p className="ghost-explainer-step-title">Play Fritz matches</p>
                  <p className="ghost-explainer-step-copy">Every match teaches your ghost your habits.</p>
                </div>
              </div>
              <div className="ghost-explainer-step">
                <span className="ghost-explainer-step-num">2</span>
                <div>
                  <p className="ghost-explainer-step-title">Unlock at 5 games</p>
                  <p className="ghost-explainer-step-copy">Then you can play against your own ghost.</p>
                </div>
              </div>
              <div className="ghost-explainer-step">
                <span className="ghost-explainer-step-num">3</span>
                <div>
                  <p className="ghost-explainer-step-title">Gets sharper over time</p>
                  <p className="ghost-explainer-step-copy">Around 30 games, it starts to feel much more like you.</p>
                </div>
              </div>
            </div>
            <div className="ghost-explainer-callout">
              {isLocked
                  ? `${gamesToUnlock} more Fritz ${gamesToUnlock === 1 ? 'game' : 'games'} until your ghost unlocks`
                  : tier === 'trained'
                  ? `Your ghost is trained and ready`
                  : `${gamesToTrained} more completed Fritz ${gamesToTrained === 1 ? 'game' : 'games'} until your ghost is fully trained`}
            </div>
            <div className="ghost-tier-pills">
              <span className={`ghost-tier-pill active`}>Unlocks at 0 games</span>
              <span className={`ghost-tier-pill ${trainingGamesPlayed >= FULL_LABEL_THRESHOLD ? 'active' : ''}`}>15 games — Learning</span>
              <span className={`ghost-tier-pill ${trainingGamesPlayed >= TRAINED_THRESHOLD ? 'active' : ''}`}>30 games — Trained ✓</span>
            </div>
          </div>
        </div>

        <div className="ghost-setup-middle-col">
          {!userId && (
            <div className="ghost-setup-panel">
              <p className="ghost-setup-eyebrow">Sign in required</p>
              <h3>Ghost Mode tracks your rolling self.</h3>
              <p>Create an account so the game can build your ghost from completed Fritz runs.</p>
            </div>
          )}

          {selectedUserId && loading && (
            <div className="ghost-setup-panel">
              <p className="ghost-setup-eyebrow">Loading ghost profile</p>
              <h3>Preparing {selectedUsername}…</h3>
            </div>
          )}

          {selectedUserId && !loading && error && (
            <div className="ghost-setup-panel">
              <p className="ghost-setup-eyebrow">Ghost unavailable</p>
              <h3>{error}</h3>
            </div>
          )}

          {selectedUserId && !loading && !error && summary && !isLocked && (
            <div className="ghost-setup-panel">
              {tier === 'early' && isViewingOwnGhost && (
                <div className="ghost-tier-badge ghost-tier-badge--early">
                  ⚡ Early Ghost — still learning ({fritzGamesPlayed}/{UNLOCK_THRESHOLD} games to unlock)
                </div>
              )}
              {tier === 'trained' && isViewingOwnGhost && (
                <div className="ghost-tier-badge ghost-tier-badge--trained">
                  ✓ Trained Ghost — {confidencePct}% style confidence
                </div>
              )}
              {tier !== 'trained' && isViewingOwnGhost && summary.styleProfile && (
                <div className="ghost-tier-badge ghost-tier-badge--early">
                  Still learning — {trainingGamesPlayed}/{TRAINED_THRESHOLD} usable training games, {confidencePct}% style confidence
                </div>
              )}

              <div className="ghost-setup-header">
                <div className="ghost-setup-average">
                  <p className="ghost-setup-eyebrow">Ghost Avg</p>
                  <h3>{summary.avgScore == null ? '—' : `${summary.avgScore} pts`}</h3>
                </div>
                {summary.styleProfile && (
                  <div className="ghost-confidence-ring" title={`${confidencePct}% style confidence`}>
                    <svg viewBox="0 0 36 36" className="ghost-ring-svg">
                      <circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
                      <circle
                        cx="18" cy="18" r="15.9" fill="none"
                        stroke="#8e6dff" strokeWidth="3"
                        strokeDasharray={`${confidencePct} 100`}
                        strokeLinecap="round"
                        transform="rotate(-90 18 18)"
                      />
                    </svg>
                    <span className="ghost-ring-label">{confidencePct}%</span>
                  </div>
                )}
              </div>
              <p className="ghost-setup-note">
                Style confidence measures how much usable move history your ghost has learned from. It is not a win-rate or strength rating.
              </p>

              <div className="ghost-setup-history">
                <div>
                  <p className="ghost-setup-eyebrow">Last 5 Scores</p>
                  <div className="ghost-score-list">
                    {(recentScores.length > 0 ? recentScores : ['—']).map((score, index) => (
                      <span key={`${score}-${index}`} className="ghost-score-pill">
                        {typeof score === 'number' ? `${score} pts` : score}
                      </span>
                    ))}
                  </div>
                </div>
                {renderSparkline(recentScores)}
              </div>

              {summary.styleProfile && (
                <div className="ghost-style-profile">
                  <p className="ghost-setup-eyebrow">Style Profile</p>
                  <div className="ghost-style-grid">
                    <div className="ghost-style-item">
                      <span>Scoring Bias</span>
                      <div className="ghost-style-bar"><div style={{ width: `${summary.styleProfile.scoringBias * 100}%` }} /></div>
                    </div>
                    <div className="ghost-style-item">
                      <span>Double Priority</span>
                      <div className="ghost-style-bar"><div style={{ width: `${summary.styleProfile.doublePriority * 100}%` }} /></div>
                    </div>
                    <div className="ghost-style-item">
                      <span>Board Control</span>
                      <div className="ghost-style-bar"><div style={{ width: `${summary.styleProfile.attackSetup * 100}%` }} /></div>
                    </div>
                    <div className="ghost-style-item">
                      <span>Branching</span>
                      <div className="ghost-style-bar"><div style={{ width: `${summary.styleProfile.branchingFrequency * 100}%` }} /></div>
                    </div>
                  </div>
                </div>
              )}

              <div className="ghost-training-diagnostics">
                Ghost diagnostics: {trainingHealth}. Training counter {trainingGamesPlayed};
                recent logs {compositeSourceGames}; style snapshots {styleSnapshotCount};
                move memory {compositeStateCount}; padding games {summary.paddingGames};
                average turn points {summary.styleProfile ? summary.styleProfile.avgTurnPoints.toFixed(1) : 'unavailable'};
                rebuilt {formatDiagnosticDate(compositeLog?.generatedAt)}.
                {styleSnapshotCount === 0
                  ? ' If this stays at zero after completed Fritz games, the completion request or move log is not being saved correctly.'
                  : confidence < 0.85
                    ? ` ${gamesToReliableStyle} more usable style ${gamesToReliableStyle === 1 ? 'game' : 'games'} to reach the learning tier; ${gamesToMaxConfidence} to reach full confidence.`
                    : ' Training data looks healthy. If the ghost still feels weak, tune the competitive move resolver next.'}
              </div>
            </div>
          )}
        </div>

        <div className="ghost-setup-right-col">
          {userId && (
            <div className="ghost-friend-selector">
              <p className="ghost-setup-eyebrow">Select Opponent</p>
              <div className="ghost-friend-list">
                <button
                  className={`ghost-friend-btn ${selectedUserId === userId ? 'active' : ''}`}
                  onClick={() => handleSelectFriend(null)}
                >
                  You {tier === 'trained' ? '✓' : tier === 'early' ? '⚡' : ''}
                </button>
                <button
                  className={`ghost-friend-btn ghost-friend-btn-featured ${selectedUserId === featuredUserId ? 'active' : ''}`}
                  onClick={() => featuredUserId && handleSelectFriend({ id: 'featured', userId: featuredUserId, username: featuredUsername, online: true })}
                >
                  <span className="ghost-featured-mark" aria-hidden="true">★</span>
                  <span>@{featuredUsername}</span>
                </button>
                {visibleFriends.map((f) => (
                  <button
                    key={f.userId}
                    className={`ghost-friend-btn ${selectedUserId === f.userId ? 'active' : ''}`}
                    onClick={() => handleSelectFriend(f)}
                  >
                    {f.username}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mode-actions ghost-setup-actions">
            <button
              className="mode-option mode-option-primary mode-accent-ghost ghost-setup-start"
              onClick={() => summary && onStart(summary, selectedUsername, selectedUserId)}
              disabled={!canPlay}
            >
              <span className="mode-option-title">Play Ghost</span>
              <span className="mode-option-meta">
                {!userId
                  ? 'Sign in to unlock this mode'
                  : isLocked
                    ? `Unlocks after ${UNLOCK_THRESHOLD} Fritz games`
                  : loading
                    ? 'Loading ghost profile…'
                    : summary
                      ? `Opponent: ${selectedUsername}`
                      : 'Ghost profile unavailable'}
              </span>
            </button>
            <button className="mode-option mode-option-secondary bot-setup-back" onClick={onBack}>
              <span className="mode-option-title">Back to Home</span>
              <span className="mode-option-meta">Return to game mode menu</span>
            </button>
          </div>
        </div>
      </div>
    </LayoutScreen>
  );
}
