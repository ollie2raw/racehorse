import type { PlayerIdentityModel } from '../../identity/playerIdentityTypes';
import { hasModeActivity } from '../statsDerivations';
import { StatsFigure, StatsFigureGrid, StatsModeCard } from './StatsModeCard';

const DASH = '—';

/**
 * Human-v-human results only. The shared rating above also includes Fritz.
 */
export function RankedPerformanceSection({
  competitive,
}: {
  competitive: PlayerIdentityModel['competitive'];
}) {
  const played = hasModeActivity([competitive.wins, competitive.losses]);

  return (
    <StatsModeCard
      accent="gold"
      eyebrow="Human-v-human"
      title="Your multiplayer record"
      empty={played ? null : 'Play a human-v-human match to start a record here.'}
    >
      <StatsFigureGrid>
        <StatsFigure
          tone="accent"
          value={competitive.winRate == null ? DASH : `${competitive.winRate.toFixed(1)}%`}
          label="win rate"
        />
        <StatsFigure
          value={
            competitive.wins == null || competitive.losses == null
              ? DASH
              : `${competitive.wins}W – ${competitive.losses}L`
          }
          label="record"
        />
        <StatsFigure value={competitive.currentStreak ?? DASH} label="current streak" />
        <StatsFigure value={competitive.bestStreak ?? DASH} label="best streak" />
      </StatsFigureGrid>
    </StatsModeCard>
  );
}
