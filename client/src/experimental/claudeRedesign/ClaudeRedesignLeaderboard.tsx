import { useState } from 'react';
import type { CSSProperties } from 'react';
import type { ClaudeLeaderboardMode, ClaudeRedesignScreen } from './ClaudeRedesignShared';
import { SectionLabel, claudeTokens } from './ClaudeRedesignShared';

const fritzRows = [
  { rank: 1, handle: 'Magnus_D', result: 'W', score: 610, detail: '+47', moves: 22, time: '7:14' },
  { rank: 2, handle: 'Cerulean99', result: 'W', score: 580, detail: '+31', moves: 24, time: '8:02' },
  { rank: 3, handle: 'pipcount', result: 'W', score: 562, detail: '+19', moves: 21, time: '6:48' },
  { rank: 6, handle: '@Oliver', result: 'W', score: 498, detail: '-2', moves: 29, time: '11:22', isMe: true },
];

const puzzleRows = [
  { rank: 1, handle: 'pipcount', result: 'Solved', score: 100, detail: '★★★', moves: 6, time: '0:42' },
  { rank: 2, handle: 'Magnus_D', result: 'Solved', score: 100, detail: '★★★', moves: 6, time: '1:08' },
  { rank: 3, handle: 'TileBreaker', result: 'Solved', score: 97, detail: '★★★', moves: 7, time: '2:14' },
  { rank: 4, handle: '@Oliver', result: 'Solved', score: 88, detail: '★★☆', moves: 9, time: '4:55', isMe: true },
];

export function ClaudeRedesignLeaderboard({
  onNavigate,
}: {
  onNavigate: (screen: ClaudeRedesignScreen) => void;
}) {
  const [mode, setMode] = useState<ClaudeLeaderboardMode>('fritz');
  const rows = mode === 'fritz' ? fritzRows : puzzleRows;
  const accent = mode === 'fritz' ? claudeTokens.cyan : claudeTokens.amber;
  const myRow = rows.find((row) => row.isMe) ?? rows[0];

  return (
    <section
      className="claude-leaderboard"
      style={{ ['--claude-leaderboard-accent' as const]: accent } as CSSProperties}
    >
      <div className="claude-leaderboard__hero">
        <SectionLabel color={accent}>Leaderboard</SectionLabel>
        <h1>GLOBAL RESULTS</h1>
        <p>Preview ranking layout with local mock data. No real leaderboard fetches are used here.</p>
        <div className="claude-segmented claude-segmented--tight">
          <button className={mode === 'fritz' ? 'is-active' : ''} type="button" onClick={() => setMode('fritz')}>
            Daily Fritz
          </button>
          <button className={mode === 'puzzle' ? 'is-active' : ''} type="button" onClick={() => setMode('puzzle')}>
            Daily Puzzle
          </button>
        </div>
      </div>

      <div className="claude-leaderboard__cards">
        <div className="claude-summary-card">
          <SectionLabel>Your Rank</SectionLabel>
          <strong>#{myRow.rank}</strong>
          <span>Today</span>
        </div>
        <div className="claude-summary-card">
          <SectionLabel>Score</SectionLabel>
          <strong>{myRow.score}</strong>
          <span>{mode === 'fritz' ? 'vs Fritz Elite' : `${myRow.moves} moves`}</span>
        </div>
        <div className="claude-summary-card">
          <SectionLabel>{mode === 'fritz' ? 'Rating Δ' : 'Stars'}</SectionLabel>
          <strong>{myRow.detail}</strong>
          <span>{mode === 'fritz' ? 'Mock ELO impact' : 'Solved state'}</span>
        </div>
      </div>

      <div className="claude-leaderboard__table">
        <div className="claude-leaderboard__head">
          <span>#</span>
          <span>Player</span>
          <span>Result</span>
          <span>Score</span>
          <span>{mode === 'fritz' ? 'Diff' : 'Stars'}</span>
          <span>Moves</span>
          <span>Time</span>
        </div>
        {rows.map((row) => (
          <div key={`${mode}-${row.rank}-${row.handle}`} className={`claude-leaderboard__row${row.isMe ? ' is-me' : ''}`}>
            <span>{row.rank}</span>
            <span>{row.handle}</span>
            <span>{row.result}</span>
            <span>{row.score}</span>
            <span>{row.detail}</span>
            <span>{row.moves}</span>
            <span>{row.time}</span>
          </div>
        ))}
      </div>

      <button className="claude-secondary-row" type="button" onClick={() => onNavigate('home')}>
        <span>
          <span className="claude-secondary-row__label">Return to Preview Home</span>
          <span className="claude-secondary-row__sub">Go back to the Claude redesign home</span>
        </span>
        <span className="claude-secondary-row__arrow" aria-hidden="true">
          →
        </span>
      </button>
    </section>
  );
}
