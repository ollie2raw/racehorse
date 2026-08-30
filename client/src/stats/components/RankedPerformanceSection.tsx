import type { PlayerIdentityModel } from '../../identity/playerIdentityTypes';
import { hasModeActivity } from '../statsDerivations';
import { StatsFigure, StatsFigureGrid, StatsModeCard } from './StatsModeCard';

const DASH = '—';

/**
 * The ranked record. Rating, rank and peak live in the hero above — this is
 * what produced them.
 */
export function RankedPerformanceSection({
  competitive,
}: {
  competitive: PlayerIdentityModel['competitive'];
}) {
  const played = hasModeActivity([competitive.rankedGames, competitive.wins, competitive.losses]);

  return (
    <StatsModeCard
      accent="gold"
      eyebrow="Ranked"
      title="The record behind the rating"
      empty={played ? null : 'Play a ranked match to start a record here.'}
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
