import type { DailyFritzLeaderboardRow } from './api';

interface DailyFritzLeaderboardProps {
  rows: DailyFritzLeaderboardRow[];
  loading: boolean;
  error: string | null;
  currentUsername?: string | null;
}

function formatCompletedAt(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export default function DailyFritzLeaderboard({
  rows,
  loading,
  error,
  currentUsername = null,
}: DailyFritzLeaderboardProps) {
  if (loading) {
    return <div className="daily-fritz-empty">Loading leaderboard…</div>;
  }
  if (error) {
    return <div className="daily-fritz-empty">{error}</div>;
  }
  if (rows.length === 0) {
    return <div className="daily-fritz-empty">No runs completed yet today.</div>;
  }

  return (
    <div className="daily-fritz-leaderboard">
      <div className="daily-fritz-leaderboard-head">
        <span>#</span>
        <span>Player</span>
        <span>Result</span>
        <span>Score</span>
        <span>Diff</span>
        <span>Moves</span>
        <span>Time</span>
      </div>
      <div className="daily-fritz-leaderboard-list">
        {rows.map((row) => {
          const isCurrentUser =
            Boolean(row.is_current_user) ||
            (currentUsername != null &&
              currentUsername.trim().length > 0 &&
              row.username.trim().toLowerCase() === currentUsername.trim().toLowerCase());
          return (
          <div
            key={`${row.rank}-${row.username}-${row.completedAt}`}
            className={`daily-fritz-leaderboard-row ${isCurrentUser ? 'is-current-user' : ''}`}
          >
            <span className="daily-fritz-rank-cell">#{row.rank}</span>
            <span className="daily-fritz-player-cell">{row.username}</span>
            <span className={`daily-fritz-result-cell ${row.won ? 'is-win' : 'is-loss'}`}>{row.won ? 'W' : 'L'}</span>
            <span className="daily-fritz-score-cell">
              <span>{row.finalScore}-{row.opponentScore}</span>
            </span>
            <span className="daily-fritz-diff-cell">
              {row.pointDiff >= 0 ? '+' : ''}{row.pointDiff}
            </span>
            <span className="daily-fritz-moves-cell">{row.movesUsed}</span>
            <span className="daily-fritz-time-cell">{formatCompletedAt(row.completedAt)}</span>
          </div>
          );
        })}
      </div>
    </div>
  );
}
