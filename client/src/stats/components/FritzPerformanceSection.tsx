import type { PlayerIdentityModel } from '../../identity/playerIdentityTypes';
import type { FritzTierKey } from '../statsTypes';
import { hasModeActivity } from '../statsDerivations';
import { StatsFigure, StatsFigureGrid, StatsModeCard } from './StatsModeCard';

const DASH = '—';

const TIERS: Array<{ key: FritzTierKey; label: string; color: string }> = [
  { key: 'rookie', label: 'Rookie', color: 'var(--tier-rookie)' },
  { key: 'standard', label: 'Standard', color: 'var(--tier-standard)' },
  { key: 'elite', label: 'Elite', color: 'var(--tier-elite)' },
  { key: 'master', label: 'Master', color: 'var(--tier-master)' },
];

export function FritzPerformanceSection({ fritz }: { fritz: PlayerIdentityModel['fritz'] }) {
  const played =
    hasModeActivity([fritz.totalWins, fritz.totalLosses, fritz.bestScore]) ||
    fritz.difficultyRecords.length > 0;
  const records = new Map(
    fritz.difficultyRecords.map((record) => [record.difficulty.toLowerCase(), record]),
  );

  return (
    <StatsModeCard
      accent="green"
      wide
      eyebrow="Fritz"
      title="Against every difficulty"
      empty={played ? null : 'Play Fritz to start a record here.'}
    >
      <StatsFigureGrid>
        <StatsFigure
          tone="accent"
          value={
            fritz.totalWins == null || fritz.totalLosses == null
              ? DASH
              : `${fritz.totalWins}W – ${fritz.totalLosses}L`
          }
          label="record"
        />
        <StatsFigure
          value={fritz.winRate == null ? DASH : `${fritz.winRate.toFixed(1)}%`}
          label="win rate"
        />
        <StatsFigure
          value={fritz.averageScore == null ? DASH : fritz.averageScore.toLocaleString()}
          label="average score"
        />
        <StatsFigure
          value={fritz.bestScore == null ? DASH : fritz.bestScore.toLocaleString()}
          label="best score"
        />
      </StatsFigureGrid>

      {/* Per-tier is the part that actually says something about a player:
          a strong rookie record and a losing elite one is a different story
          from an even split across all four. */}
      <ul className="rh-stats-tiers">
        {TIERS.map((tier) => {
          const record = records.get(tier.key);
          return (
            <li key={tier.key} className="rh-stats-tier">
              <span className="rh-stats-tier-name">
                <i style={{ background: tier.color }} aria-hidden="true" />
                {tier.label}
              </span>
              <span className="rh-stats-tier-record">
                {record ? `${record.wins}W – ${record.losses}L` : DASH}
              </span>
              <span className="rh-stats-tier-games">
                {record ? `${record.games} games` : 'not played'}
              </span>
            </li>
          );
        })}
      </ul>
    </StatsModeCard>
  );
}
