import type { PlayerIdentityModel } from '../../identity/playerIdentityTypes';
import { StatsFigure, StatsFigureGrid, StatsModeCard } from './StatsModeCard';

/**
 * Closest rival.
 *
 * `model.rivalry` was fetched and never rendered. It is the only stat on this
 * page about another person, which is most of why it is worth showing.
 *
 * Renders nothing at all when there is no rival yet — an empty rival card
 * would be a panel about nobody.
 */
export function RivalCard({ rivalry }: { rivalry: PlayerIdentityModel['rivalry'] }) {
  const rival = rivalry.closestRival;
  if (!rival) return null;

  return (
    <StatsModeCard accent="purple" eyebrow="Rivalry" title={`@${rival.username}`}>
      <StatsFigureGrid>
        <StatsFigure
          tone="accent"
          value={`${rival.winsAgainst}W – ${rival.lossesAgainst}L`}
          label="head to head"
        />
        <StatsFigure value={rival.gamesPlayed} label="games together" />
        <StatsFigure
          value={rival.rating == null ? '—' : rival.rating.toLocaleString()}
          label="their rating"
        />
      </StatsFigureGrid>
    </StatsModeCard>
  );
}
