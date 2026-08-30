import type { PlayerIdentityModel } from '../../identity/playerIdentityTypes';
import { StatsModeCard } from './StatsModeCard';

/**
 * Journey progress, as a bar rather than the bare "9 of 12" it used to be —
 * the point of a progress stat is being able to see the progress.
 */
export function JourneyProgressCard({ learning }: { learning: PlayerIdentityModel['learning'] }) {
  const { completedNodes, totalNodes } = learning;
  if (completedNodes == null || totalNodes == null || totalNodes <= 0) return null;
  const pct = Math.min(100, Math.round((completedNodes / totalNodes) * 100));

  return (
    <StatsModeCard
      accent="green"
      eyebrow="Journey"
      title={learning.activeChapterTitle ?? 'Learning path'}
    >
      <div
        className="rh-stats-progress"
        role="progressbar"
        aria-valuenow={completedNodes}
        aria-valuemin={0}
        aria-valuemax={totalNodes}
        aria-label={`${completedNodes} of ${totalNodes} nodes completed`}
      >
        <span className="rh-stats-progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <p className="rh-stats-progress-label">
        {completedNodes} of {totalNodes} nodes completed
      </p>
    </StatsModeCard>
  );
}
