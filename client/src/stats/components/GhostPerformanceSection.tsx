import type { PlayerIdentityModel } from '../../identity/playerIdentityTypes';
import { hasModeActivity } from '../statsDerivations';
import { StatsFigure, StatsFigureGrid, StatsModeCard } from './StatsModeCard';

const DASH = '—';

export function GhostPerformanceSection({ ghost }: { ghost: PlayerIdentityModel['ghost'] }) {
  const played = hasModeActivity([ghost.gamesPlayed, ghost.wins, ghost.losses, ghost.rating]);

  return (
    <StatsModeCard
      accent="purple"
      eyebrow="Ghost"
      title="Practice under pressure"
      empty={played ? null : 'Play a Ghost match to start a record here.'}
    >
      <StatsFigureGrid>
        <StatsFigure
          tone="accent"
          value={ghost.rating == null ? DASH : ghost.rating.toLocaleString()}
          label="rating"
        />
        <StatsFigure
          value={
            ghost.wins == null || ghost.losses == null ? DASH : `${ghost.wins}W – ${ghost.losses}L`
          }
          label="record"
        />
        <StatsFigure
          value={ghost.winRate == null ? DASH : `${ghost.winRate.toFixed(1)}%`}
          label="win rate"
        />
        <StatsFigure
          value={ghost.bestWinMargin == null ? DASH : `${ghost.bestWinMargin} pts`}
          label="best win"
        />
        <StatsFigure value={ghost.gamesPlayed ?? DASH} label="games" />
      </StatsFigureGrid>
    </StatsModeCard>
  );
}
