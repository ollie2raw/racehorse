import type { DailyFritzLeaderboardRow } from './api';
import { getGameSkunkChipLabel, getSetSkunkBadgeFromLeaderboardRow } from './skunk';

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

function formatMargin(value: number): string {
  return `${value >= 0 ? '+' : ''}${value}`;
}

function isBestOfThreeRow(row: DailyFritzLeaderboardRow): boolean {
  return Boolean(row.games?.length);
}

function getInitials(username: string): string {
  const cleaned = username.replace(/^@/, '').trim();
  if (!cleaned) return 'P';
  const parts = cleaned.split(/[\s_-]+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
  return cleaned.slice(0, 2).toUpperCase();
}

function formatGameChip(game: NonNullable<DailyFritzLeaderboardRow['games']>[number]): string {
  return getGameSkunkChipLabel(game) ?? `G${game.gameNumber} ${game.playerWon ? 'W' : 'L'} ${game.playerScore}–${game.fritzScore}`;
}

function isCurrentUserRow(
  row: DailyFritzLeaderboardRow,
  currentUsername: string | null,
): boolean {
  return (
    Boolean(row.is_current_user) ||
    (currentUsername != null &&
      currentUsername.trim().length > 0 &&
      row.username.trim().toLowerCase() === currentUsername.trim().toLowerCase())
  );
}

function renderGameBreakdown(row: DailyFritzLeaderboardRow, compact = false) {
  if (!row.games?.length) return <span className="daily-fritz-breakdown-empty">No game breakdown</span>;
  return (
    <div className={`daily-fritz-game-chip-row ${compact ? 'is-compact' : ''}`}>
      {row.games.map((game) => (
        <span
          key={`${row.username}-${row.rank}-${game.gameNumber}`}
          className={`daily-fritz-game-chip ${game.playerWon ? 'is-win' : 'is-loss'} ${game.skunk ? 'is-skunk' : ''}`}
        >
          {formatGameChip(game)}
        </span>
      ))}
    </div>
  );
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
    return <div className="daily-fritz-empty" role="alert">
        Couldn&apos;t load the leaderboard.
        <br />
        Please try again.
      </div>;
  }
  if (rows.length === 0) {
    return <div className="daily-fritz-empty">No completed sets yet today.
        <br />
        Play Daily Fritz to claim the first spot.</div>;
  }

  const pageVariant = variant === 'page';

  if (!pageVariant) {
    return (
      <div className="daily-fritz-leaderboard">
        <div className="daily-fritz-leaderboard-head">
          <span>#</span>
          <span>Player</span>
          <span>Set Result</span>
          <span>Set Score</span>
          <span>Set Margin</span>
          <span>Finished</span>
        </div>
        <div className="daily-fritz-leaderboard-list">
          {rows.map((row) => {
            const isCurrentUser = isCurrentUserRow(row, currentUsername);
            return (
              <div
                key={`${row.rank}-${row.username}-${row.completedAt}`}
                className={`daily-fritz-leaderboard-row ${isCurrentUser ? 'is-current-user' : ''}`}
              >
                <span className="daily-fritz-rank-cell">#{row.rank}</span>
                <span className="daily-fritz-player-cell">{row.username}</span>
                <span className={`daily-fritz-result-cell ${row.won ? 'is-win' : 'is-loss'}`}>
                  {row.won ? 'Won set' : 'Lost set'}
                </span>
                <span className="daily-fritz-score-cell">{row.finalScore}–{row.opponentScore}</span>
                <span className="daily-fritz-diff-cell">{formatMargin(row.pointDiff)}</span>
                <span className="daily-fritz-time-cell">{formatCompletedAt(row.completedAt)}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="daily-fritz-results-hub">
      <section className="daily-fritz-global-results" aria-label="Daily Fritz global leaderboard">
        <div className="daily-fritz-global-results-head">
          <div>
            <span className="daily-fritz-results-kicker">Today’s Daily Fritz Board</span>
            <p className="daily-fritz-standings-note">
              Player skunks rank first by earliest game, then point margin. Other sets rank by result and score.
            </p>
          </div>
          <span className="daily-fritz-global-results-count">
            {rows.length} {rows.length === 1 ? 'player' : 'players'}
          </span>
        </div>

        <div className="daily-fritz-standings-head" aria-hidden="true">
          <span>Rank</span>
          <span>Player</span>
          <span>Set Result</span>
          <span>Set Score</span>
          <span>Set Margin</span>
          <span>Finished</span>
          <span>Game Breakdown</span>
        </div>

        <div className="daily-fritz-global-results-list">
          {rows.map((row) => {
            const isCurrentUser = isCurrentUserRow(row, currentUsername);
            const initials = getInitials(row.username);
            const bestOfThree = isBestOfThreeRow(row);
            return (
              <article
                key={`${row.rank}-${row.username}-${row.completedAt}`}
                className={`daily-fritz-global-row ${isCurrentUser ? 'is-current-user' : ''} ${bestOfThree ? 'is-v2' : 'is-legacy'} ${row.won ? 'is-won' : 'is-lost'}`}
              >
                {row.rank <= 3 ? <span className={`daily-fritz-top-accent rank-${row.rank}`} aria-hidden="true" /> : null}
                <div className="daily-fritz-global-rank">
                  <span className={`daily-fritz-rank-dot rank-${row.rank <= 3 ? row.rank : 0}`} aria-hidden="true" />
                  <strong className={`daily-fritz-rank-value rank-${row.rank <= 3 ? row.rank : 0}`}>#{row.rank}</strong>
                </div>
                <div className="daily-fritz-global-player">
                  <span className={`daily-fritz-avatar ${isCurrentUser ? 'is-current-user' : ''}`} aria-hidden="true">
                    {initials}
                  </span>
                  <div className="daily-fritz-global-player-copy">
                    <strong className="daily-fritz-player-name">
                      {row.username}
                      {isCurrentUser ? <span className="daily-fritz-you-pill">YOU</span> : null}
                      {bestOfThree && getSetSkunkBadgeFromLeaderboardRow(row) ? (
                        <span className="daily-fritz-skunk-badge daily-fritz-skunk-badge--inline">
                          {getSetSkunkBadgeFromLeaderboardRow(row)}
                        </span>
                      ) : null}
                    </strong>
                    {!bestOfThree ? <span className="daily-fritz-legacy-pill">Legacy</span> : null}
                  </div>
                </div>
                <div
                  className={`daily-fritz-global-cell daily-fritz-global-cell-result ${row.won ? 'is-win' : 'is-loss'}`}
                  data-label="Set Result"
                >
                  {row.won ? 'Won set' : bestOfThree ? 'Lost set' : 'Legacy result'}
                </div>
                <div className="daily-fritz-global-cell" data-label="Set Score">{row.finalScore}–{row.opponentScore}</div>
                <div className={`daily-fritz-global-cell ${row.pointDiff >= 0 ? 'is-win' : 'is-loss'}`} data-label="Set Margin">
                  {formatMargin(row.pointDiff)}
                </div>
                <div className="daily-fritz-global-cell" data-label="Finished">{formatCompletedAt(row.completedAt)}</div>
                <div className="daily-fritz-global-breakdown">
                  {bestOfThree ? renderGameBreakdown(row) : <span className="daily-fritz-breakdown-empty">Single match</span>}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
