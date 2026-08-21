import { stagePosition, stageProgress } from './rushScoring';
import type { PuzzleRushStage, PuzzleRushStageKey } from './types';

/**
 * The run's whole arc, rendered from the `stages` array at run start rather
 * than discovered as the player reaches each stage — one segment per stage,
 * filled by puzzles completed within it.
 */
export function RushStageProgress({
  stages,
  activeStageKey,
  completedOrdinals,
}: {
  stages: PuzzleRushStage[];
  activeStageKey: PuzzleRushStageKey | null;
  completedOrdinals: number[];
}) {
  const position = activeStageKey ? stagePosition(stages, activeStageKey) : null;

  return (
    <div className="pr-stage-progress" data-ui="rush-stage-progress">
      <div className="pr-stage-progress__bar" role="presentation">
        {stages.map((stage) => {
          const { done, total } = stageProgress(stage, completedOrdinals);
          const isActive = stage.key === activeStageKey;
          const fill = total > 0 ? Math.round((done / total) * 100) : 0;
          return (
            <div
              key={stage.key}
              className={`pr-stage-segment${isActive ? ' pr-stage-segment--active' : ''}`}
              data-stage={stage.key}
              data-active={isActive ? 'true' : 'false'}
            >
              <span className="pr-stage-segment__fill" style={{ width: `${fill}%` }} />
              <span className="pr-stage-segment__label">{stage.label}</span>
            </div>
          );
        })}
      </div>
      {position && (
        <span className="pr-stage-progress__position" data-ui="rush-stage-position">
          Stage {position.index} of {position.total}
        </span>
      )}
    </div>
  );
}

export default RushStageProgress;
