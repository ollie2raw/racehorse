import type { PlayerIdentityModel } from '../../identity/playerIdentityTypes';
import { AnimatedScore } from '../../components/AnimatedScore';

type Props = { puzzle: PlayerIdentityModel['puzzle'] };
const value = (number: number | null) =>
  number == null ? '—' : <AnimatedScore value={number} from={0} format={(n) => n.toLocaleString()} />;

export function PuzzlePerformanceSection({ puzzle }: Props) {
  const ready = [puzzle.completions, puzzle.currentStreak, puzzle.bestScoreToday, puzzle.bestScoreEver, puzzle.perfectDays].some((item) => item != null);
  if (!ready) return null;
  const empty = puzzle.completions === 0 && puzzle.currentStreak === 0 && puzzle.perfectDays === 0 && puzzle.bestScoreToday == null && puzzle.bestScoreEver == null;
  return <section className="stats-analysis-card stats-analysis-card--puzzle" aria-labelledby="stats-puzzle-title"><div className="stats-section-heading"><p className="stats-eyebrow stats-eyebrow--blue">Daily Puzzle performance</p><h2 id="stats-puzzle-title">A record of small edges</h2></div>{empty ? <p className="stats-empty-note">Complete a Daily Puzzle to begin building your record.</p> : <div className="stats-fact-grid stats-fact-grid--cards"><span><b>{value(puzzle.currentStreak)}</b> current streak</span><span><b>{value(puzzle.completions)}</b> completions</span>{puzzle.bestScoreToday != null && <span><b>{value(puzzle.bestScoreToday)}</b> best today</span>}{puzzle.bestScoreEver != null && <span><b>{value(puzzle.bestScoreEver)}</b> best ever</span>}<span><b>{value(puzzle.perfectDays)}</b> perfect days</span></div>}</section>;
}
