import { useEffect, useState } from 'react';
import LayoutScreen from '../ui/LayoutScreen';
import type { GhostProfileSummary } from './api';
import { fetchGhostProfileSummary } from './api';
import { fetchFriends, type FriendRecord } from '../friends/friendsApi';
import './ghostMode.css';

interface GhostSetupScreenProps {
  userId: string | null;
  onBack: () => void;
  onStart: (summary: GhostProfileSummary, opponentName: string) => void;
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

export default function GhostSetupScreen({ userId, onBack, onStart }: GhostSetupScreenProps) {
  const [summary, setSummary] = useState<GhostProfileSummary | null>(null);
  const [loading, setLoading] = useState(Boolean(userId));
  const [error, setError] = useState<string | null>(null);
  const [friends, setFriends] = useState<FriendRecord[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(userId);
  const [selectedUsername, setSelectedUsername] = useState<string>('Your Ghost');

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

  return (
    <LayoutScreen
      className="ghost-setup-screen mode-home-screen mode-subpage-screen mode-accent-ghost"
      badge="Compete"
      title="Ghost Mode"
      subtitle="Beat the composite of your last five Ghost Mode runs."
      contentClassName="screen-shell ghost-setup-content"
    >
      <div className="ghost-setup-grid">
        <div className="ghost-setup-left-col">
          {userId && friends.length > 0 && (
            <div className="ghost-friend-selector">
              <p className="ghost-setup-eyebrow">Select Opponent</p>
              <div className="ghost-friend-list">
                <button
                  className={`ghost-friend-btn ${selectedUserId === userId ? 'active' : ''}`}
                  onClick={() => handleSelectFriend(null)}
                >
                  You
                </button>
                {friends.map((f) => (
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

          {!userId && (
            <div className="ghost-setup-panel">
              <p className="ghost-setup-eyebrow">Sign in required</p>
              <h3>Ghost Mode tracks your rolling self.</h3>
              <p>
                Create an account or sign in so the game can build your ghost from completed runs.
              </p>
            </div>
          )}

          {selectedUserId && loading && (
            <div className="ghost-setup-panel">
              <p className="ghost-setup-eyebrow">Loading ghost profile</p>
              <h3>Preparing {selectedUsername}.</h3>
            </div>
          )}

          {selectedUserId && !loading && error && (
            <div className="ghost-setup-panel">
              <p className="ghost-setup-eyebrow">Ghost unavailable</p>
              <h3>{error}</h3>
            </div>
          )}

          {selectedUserId && !loading && !error && summary && (
            <div className="ghost-setup-panel">
              <div className="ghost-setup-header">
                <div>
                  <p className="ghost-setup-eyebrow">{selectedUsername} Rating</p>
                  <h3>👻 {summary.ghostRating}</h3>
                </div>
                <div className="ghost-setup-average">
                  <span>Ghost Avg</span>
                  <strong>{summary.avgScore == null ? '—' : `${summary.avgScore} pts`}</strong>
                </div>
              </div>

              <div className="ghost-setup-history">
                <div>
                  <p className="ghost-setup-eyebrow">Last 5 Scores</p>
                  <div className="ghost-score-list">
                    {(summary.recentScores.length > 0 ? summary.recentScores : ['—']).map(
                      (score, index) => (
                        <span key={`${score}-${index}`} className="ghost-score-pill">
                          {typeof score === 'number' ? `${score} pts` : score}
                        </span>
                      ),
                    )}
                  </div>
                </div>
                {renderSparkline(summary.recentScores)}
              </div>

              {summary.styleProfile && (
                <div className="ghost-style-profile">
                  <p className="ghost-setup-eyebrow">Style Profile</p>
                  <div className="ghost-style-grid">
                    <div className="ghost-style-item">
                      <span>Scoring Bias</span>
                      <div className="ghost-style-bar">
                        <div style={{ width: `${summary.styleProfile.scoringBias * 100}%` }} />
                      </div>
                    </div>
                    <div className="ghost-style-item">
                      <span>Double Priority</span>
                      <div className="ghost-style-bar">
                        <div style={{ width: `${summary.styleProfile.doublePriority * 100}%` }} />
                      </div>
                    </div>
                    <div className="ghost-style-item">
                      <span>Branching</span>
                      <div className="ghost-style-bar">
                        <div style={{ width: `${summary.styleProfile.branchingFrequency * 100}%` }} />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {summary.gamesPlayed < 5 && (
                <p className="ghost-setup-note">
                  {summary.gamesPlayed === 0
                    ? 'First run: the ghost is fully random.'
                    : `Padding ${summary.paddingGames} missing game${summary.paddingGames === 1 ? '' : 's'} with random behavior.`}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="ghost-setup-right-col">
          <div className="mode-actions ghost-setup-actions">
            <button
              className="mode-option mode-option-primary mode-accent-ghost ghost-setup-start"
              onClick={() => summary && onStart(summary, selectedUsername)}
              disabled={!summary}
            >
              <span className="mode-option-title">Play Ghost</span>
              <span className="mode-option-meta">
                {!userId
                  ? 'Sign in to unlock this mode'
                  : loading
                    ? 'Loading ghost profile'
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
