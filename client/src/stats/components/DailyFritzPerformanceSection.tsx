import type { PlayerIdentityModel } from '../../identity/playerIdentityTypes';
import { hasModeActivity } from '../statsDerivations';
import { StatsFigure, StatsFigureGrid, StatsModeCard } from './StatsModeCard';

const DASH = '—';

/**
 * Daily Fritz.
 *
 * `model.dailyFritz` was loaded on every render of this page and shown
 * nowhere — the one mode with a daily ritual and a leaderboard had no section.
 */
export function DailyFritzPerformanceSection({
  dailyFritz,
}: {
  dailyFritz: PlayerIdentityModel['dailyFritz'];
}) {
  const played = hasModeActivity([dailyFritz.completions, dailyFritz.wins, dailyFritz.bestMargin]);

  return (
    <StatsModeCard
      accent="gold"
      eyebrow="Daily Fritz"
      title="The daily set"
      empty={played ? null : "Play today's set to start a record here."}
    >
      <StatsFigureGrid>
        <StatsFigure
          tone="accent"
          value={dailyFritz.completions ?? DASH}
          label="sets completed"
        />
        <StatsFigure value={dailyFritz.wins ?? DASH} label="sets won" />
        <StatsFigure value={dailyFritz.bestFinish ?? DASH} label="best finish" />
        <StatsFigure value={dailyFritz.bestMargin ?? DASH} label="best margin" />
      </StatsFigureGrid>
    </StatsModeCard>
  );
}
