import type { PlayerIdentityModel } from '../../identity/playerIdentityTypes';
import { hasModeActivity } from '../statsDerivations';
import { StatsFigure, StatsFigureGrid, StatsModeCard } from './StatsModeCard';

const DASH = '—';

export function PuzzlePerformanceSection({ puzzle }: { puzzle: PlayerIdentityModel['puzzle'] }) {
  const played = hasModeActivity([
    puzzle.completions,
    puzzle.currentStreak,
    puzzle.perfectDays,
    puzzle.bestScoreEver,
  ]);

  return (
    <StatsModeCard
      accent="blue"
      eyebrow="Daily Puzzle"
      title="A record of small edges"
      empty={played ? null : 'Complete a Daily Puzzle to begin building your record.'}
    >
      <StatsFigureGrid>
        <StatsFigure tone="accent" value={puzzle.currentStreak ?? DASH} label="current streak" />
        <StatsFigure value={puzzle.completions ?? DASH} label="completions" />
        {puzzle.bestScoreToday != null && (
          <StatsFigure value={puzzle.bestScoreToday} label="best today" />
        )}
        <StatsFigure value={puzzle.bestScoreEver ?? DASH} label="best ever" />
        <StatsFigure value={puzzle.perfectDays ?? DASH} label="perfect days" />
      </StatsFigureGrid>
    </StatsModeCard>
  );
}
