import type { PlayerIdentityModel } from '../playerIdentityTypes';

type Props = { model: PlayerIdentityModel };

const hasValue = (...values: Array<number | null>) => values.some((value) => value != null);
const display = (value: number | null) => value == null ? '—' : value.toLocaleString();

export function PlayerModeSummary({ model }: Props) {
  const { fritz, puzzle, learning, ghost, subject, sourceStatus } = model;
  const showFritz = hasValue(fritz.totalWins, fritz.totalLosses, fritz.winRate, fritz.bestScore) || fritz.difficultyRecords.length > 0;
  const showPuzzle = hasValue(puzzle.completions, puzzle.currentStreak, puzzle.bestScore, puzzle.perfectDays);
  const showJourney = subject.isCurrentUser && sourceStatus.journey === 'ready' && hasValue(learning.completedNodes, learning.totalNodes);
  const showGhost = subject.isCurrentUser && sourceStatus.personal_insights === 'ready' && hasValue(ghost.rating, ghost.gamesPlayed, ghost.wins, ghost.losses, ghost.winRate, ghost.bestWinMargin);
  if (!showFritz && !showPuzzle && !showJourney && !showGhost) return null;

  return (
    <section className="identity-section" aria-labelledby="identity-modes-title">
      <div className="identity-section__heading">
        <p className="identity-eyebrow">Mode identity</p>
        <h2 id="identity-modes-title">The tables they know</h2>
      </div>
      <div className="identity-mode-grid">
        {showFritz && <article className="identity-mode-card identity-mode-card--gold"><h3>Fritz</h3><p className="identity-mode-card__lead">{fritz.totalWins != null && fritz.totalLosses != null ? `${fritz.totalWins}W – ${fritz.totalLosses}L` : 'Record unavailable'}</p><p>{fritz.winRate == null ? '—' : `${fritz.winRate.toFixed(1)}% win rate`} · best score {display(fritz.bestScore)}</p>{fritz.difficultyRecords.length > 0 && <div className="identity-difficulty-list">{fritz.difficultyRecords.map((record) => <span key={record.difficulty}>{record.difficulty}: {record.wins}–{record.losses}</span>)}</div>}</article>}
        {showPuzzle && <article className="identity-mode-card identity-mode-card--blue"><h3>Daily Puzzle</h3><p className="identity-mode-card__lead">{display(puzzle.completions)} completions</p><p>{puzzle.currentStreak == null ? '—' : `${puzzle.currentStreak} day streak`} · best {display(puzzle.bestScore)}</p><p>{puzzle.perfectDays == null ? '—' : `${puzzle.perfectDays} perfect days`}</p></article>}
        {showJourney && <article className="identity-mode-card identity-mode-card--green"><h3>Journey</h3><p className="identity-mode-card__lead">{display(learning.completedNodes)} / {display(learning.totalNodes)} nodes</p><p>{learning.activeChapterTitle ?? 'Progress recorded'}</p></article>}
        {showGhost && <article className="identity-mode-card identity-mode-card--purple"><h3>Ghost</h3><p className="identity-mode-card__lead">{display(ghost.rating)} rating</p><p>{ghost.gamesPlayed == null || ghost.wins == null || ghost.losses == null ? '—' : `${ghost.wins}W – ${ghost.losses}L`} · {ghost.winRate == null ? '—' : `${ghost.winRate.toFixed(1)}%`}</p><p>Best win {ghost.bestWinMargin == null ? '—' : `${ghost.bestWinMargin} pts`}</p></article>}
      </div>
    </section>
  );
}
