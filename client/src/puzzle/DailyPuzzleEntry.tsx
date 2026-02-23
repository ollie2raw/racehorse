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
                <p>
                  <strong>{puzzle.title}</strong> · {puzzle.puzzle_date}
                </p>
                <p>Objective: {objectiveLabel(puzzle)}</p>
                {puzzle.config.notes && <p>{puzzle.config.notes}</p>}
                <p>
                  {user
                    ? `Signed in as @${profile?.username ?? 'player'}`
                    : 'Guest mode: you can play, but submissions are disabled.'}
                </p>
              </div>

              <div className="mode-actions">
                <button
                  className="mode-option mode-option-primary"
                  onClick={() => setPlaying(true)}
                >
                  <span className="mode-option-title">Start Puzzle</span>
                  <span className="mode-option-meta">Play now using today’s puzzle setup</span>
                </button>
                <button className="mode-option mode-option-secondary" onClick={onBack}>
                  <span className="mode-option-title">Back to Home</span>
                </button>
              </div>

              <div className="daily-leaderboard-panel">
                <h3>Today’s Leaderboard</h3>
                {leaderboard.length === 0 ? (
                  <p className="lobby-server">No solved submissions yet.</p>
                ) : (
                  <div className="daily-leaderboard-list">
                    {leaderboard.map((row, idx) => (
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
