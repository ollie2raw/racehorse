import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import type { UserProfile } from '../auth/useAuth';
import DailyPuzzlePlay from './DailyPuzzlePlay';
import {
  getTodayLeaderboard,
  getTodayPuzzle,
  type DailyPuzzle,
  type LeaderboardRow,
} from './puzzleApi';

interface DailyPuzzleEntryProps {
  user: User | null;
  profile: UserProfile | null;
  onBack: () => void;
}

function formatMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function objectiveLabel(puzzle: DailyPuzzle | null): string {
  if (!puzzle) return '';
  const obj = puzzle.config.objective;
  if (obj.type === 'finish_in_moves') return `Finish hand in ${obj.maxMoves} moves`;
  return 'Finish the hand';
}

export default function DailyPuzzleEntry({ user, profile, onBack }: DailyPuzzleEntryProps) {
  const [puzzle, setPuzzle] = useState<DailyPuzzle | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playHovered, setPlayHovered] = useState(false);

  useEffect(() => {
    let active = true;

    const load = async () => {
      setLoading(true);
      setError(null);
      const todayPuzzle = await getTodayPuzzle();
      if (!active) return;
      setPuzzle(todayPuzzle);
      if (!todayPuzzle) {
        setError('No puzzle published for today yet.');
        setLeaderboard([]);
        setLoading(false);
        return;
      }
      const boardRows = await getTodayLeaderboard(todayPuzzle.id);
      if (!active) return;
      setLeaderboard(boardRows);
      setLoading(false);
    };

    void load();
    return () => {
      active = false;
    };
  }, []);

  const refreshLeaderboard = async () => {
    if (!puzzle) return;
    const rows = await getTodayLeaderboard(puzzle.id);
    setLeaderboard(rows);
  };

  if (playing && puzzle) {
    return (
      <DailyPuzzlePlay
        puzzle={puzzle}
        user={user}
        onBack={() => setPlaying(false)}
        onSubmitted={() => {
          void refreshLeaderboard();
        }}
      />
    );
  }

  const formattedPuzzleDate = puzzle
    ? new Date(`${puzzle.puzzle_date}T00:00:00`).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : '';

  return (
    <div className="app">
      <div className="screen lobby-screen mode-home-screen">
        <div className="mode-home-glow" aria-hidden="true" />
        <div className="card lobby-card mode-card daily-puzzle-entry-card">
          <p className="lobby-kicker">Racehorse Dominoes</p>
          <h2>Daily Puzzle</h2>
          <p className="mode-subtitle">
            Solve today’s challenge with the fewest moves and fastest time.
          </p>

          {loading && <p className="lobby-server">Loading today’s puzzle...</p>}
          {!loading && error && <p className="auth-inline-error">{error}</p>}

          {!loading && puzzle && (
            <>
              <div className="daily-puzzle-summary">
                <p>Objective: {objectiveLabel(puzzle)}</p>
                {puzzle.config.notes && <p>{puzzle.config.notes}</p>}
                <p>
                  {user
                    ? `Signed in as @${profile?.username ?? 'player'}`
                    : 'Guest mode: you can play, but submissions are disabled.'}
                </p>
              </div>

              <div style={{ textAlign: 'center' }}>
                <button
                  onClick={() => setPlaying(true)}
                  onMouseEnter={() => setPlayHovered(true)}
                  onMouseLeave={() => setPlayHovered(false)}
                  aria-label="Start Today's Puzzle"
                  style={{
                    width: 110,
                    height: 110,
                    borderRadius: '50%',
                    background: 'radial-gradient(circle at 40% 35%, #2ecc71, #16a34a)',
                    border: '1.5px solid rgba(134,239,172,0.4)',
                    fontSize: '2.4rem',
                    color: 'white',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '40px auto 12px',
                    boxShadow: playHovered
                      ? '0 0 60px rgba(34,197,94,0.55), 0 0 120px rgba(34,197,94,0.25)'
                      : '0 0 40px rgba(34,197,94,0.35), 0 0 80px rgba(34,197,94,0.15), inset 0 1px 0 rgba(255,255,255,0.2)',
                    transition: 'box-shadow 0.2s ease, transform 0.2s ease',
                    transform: playHovered ? 'scale(1.05)' : 'scale(1)',
                  }}
                >
                  ▶
                </button>
                <div
                  style={{
                    fontSize: '1rem',
                    fontWeight: 600,
                    color: 'rgba(255,255,255,0.9)',
                    marginBottom: 8,
                  }}
                >
                  Start Today&apos;s Puzzle
                </div>
                <div style={{ fontSize: '0.82rem', color: 'rgba(255,255,255,0.58)' }}>
                  {formattedPuzzleDate}
                </div>
              </div>

              <div className="mode-option daily-leaderboard-panel" style={{ marginTop: 48, cursor: 'default' }}>
                <h3>Today’s Leaderboard</h3>
                {leaderboard.length === 0 ? (
                  <p className="lobby-server">No solved submissions yet.</p>
                ) : (
                  <div className="daily-leaderboard-list">
                    {leaderboard.slice(0, 3).map((row, idx) => (
                      <div className="daily-leaderboard-row" key={`${row.userId}-${idx}`}>
                        <span className="daily-leaderboard-rank">#{idx + 1}</span>
                        <span className="daily-leaderboard-name">@{row.username}</span>
                        <span>{row.moves} moves</span>
                        <span>{formatMs(row.milliseconds)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <button
                onClick={onBack}
                style={{
                  display: 'block',
                  margin: '20px auto 0',
                  background: 'none',
                  border: 'none',
                  color: 'rgba(255,255,255,0.35)',
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                }}
              >
                Back to Home
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
