import type { DailyFritzLeaderboardRow } from './api';

interface DailyFritzLeaderboardProps {
  rows: DailyFritzLeaderboardRow[];
  loading: boolean;
  error: string | null;
  currentUsername?: string | null;
  variant?: 'default' | 'page';
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
  variant = 'default',
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

  const pageVariant = variant === 'page';

  return (
    <div className={`daily-fritz-leaderboard ${pageVariant ? 'is-page' : ''}`}>
      {!pageVariant && (
        <div className="daily-fritz-leaderboard-head">
          <span>#</span>
          <span>Player</span>
          <span>Result</span>
          <span>Score</span>
          <span>Diff</span>
          <span>Moves</span>
          <span>Time</span>
        </div>
      )}
      <div className="daily-fritz-leaderboard-list">
        {rows.map((row) => {
          const isCurrentUser =
            Boolean(row.is_current_user) ||
            (currentUsername != null &&
              currentUsername.trim().length > 0 &&
              row.username.trim().toLowerCase() === currentUsername.trim().toLowerCase());
          const initials = row.username.replace(/^@/, '').slice(0, 2).toUpperCase() || 'P';
          return (
            <div
              key={`${row.rank}-${row.username}-${row.completedAt}`}
              className={`daily-fritz-leaderboard-row ${pageVariant ? 'is-page' : ''} ${isCurrentUser ? 'is-current-user' : ''}`}
            >
              {pageVariant && row.rank <= 3 ? <span className={`daily-fritz-top-accent rank-${row.rank}`} aria-hidden="true" /> : null}
              <span className="daily-fritz-rank-cell">
                {pageVariant ? (
                  <>
                    <span className={`daily-fritz-rank-dot rank-${row.rank <= 3 ? row.rank : 0}`} aria-hidden="true" />
                    <span className={`daily-fritz-rank-value rank-${row.rank <= 3 ? row.rank : 0}`}>{row.rank}</span>
                  </>
                ) : (
                  `#${row.rank}`
                )}
              </span>
              <span className="daily-fritz-player-cell">
                {pageVariant ? (
                  <>
                    <span className={`daily-fritz-avatar ${isCurrentUser ? 'is-current-user' : ''}`} aria-hidden="true">
                      {initials}
                    </span>
                    <span className="daily-fritz-player-name">
                      {row.username}
                      {isCurrentUser ? <span className="daily-fritz-you-pill">YOU</span> : null}
                    </span>
                  </>
                ) : (
                  row.username
                )}
              </span>
              <span className={`daily-fritz-result-cell ${row.won ? 'is-win' : 'is-loss'}`}>
                {row.won ? 'Won set' : 'Lost set'}
              </span>
              <span className="daily-fritz-score-cell">
                <span>{row.finalScore}-{row.opponentScore}</span>
              </span>
              <span className="daily-fritz-diff-cell">
                {pageVariant ? (
                  <span className="daily-fritz-meta-metric">
                    <span className="daily-fritz-meta-label">Diff</span>
                    <span className="daily-fritz-meta-value">
                      {row.pointDiff >= 0 ? '+' : ''}{row.pointDiff}
                    </span>
                  </span>
                ) : (
                  <>{row.pointDiff >= 0 ? '+' : ''}{row.pointDiff}</>
                )}
              </span>
              {pageVariant ? (
                <span className="daily-fritz-meta-cell">
                  <span className="daily-fritz-meta-metric">
                    <span className="daily-fritz-meta-label">Moves</span>
                    <span className="daily-fritz-meta-value">{row.movesUsed}</span>
                  </span>
                  <span className="daily-fritz-meta-metric">
                    <span className="daily-fritz-meta-label">Time</span>
                    <span className="daily-fritz-meta-value">{formatCompletedAt(row.completedAt)}</span>
                  </span>
                </span>
              ) : (
                <>
                  <span className="daily-fritz-moves-cell">{row.movesUsed}</span>
                  <span className="daily-fritz-time-cell">{formatCompletedAt(row.completedAt)}</span>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
