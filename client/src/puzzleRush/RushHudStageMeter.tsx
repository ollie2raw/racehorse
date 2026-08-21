import { stagePosition } from './rushScoring';
import type { PuzzleRushStage, PuzzleRushStageKey } from './types';

/**
 * In-HUD stage meter.
 *
 * Replaces the old three-tab strip that sat under the hand dock. That version
 * read as a separate control bar; this reads as run state, so it sits in the
 * HUD next to the score.
 *
 * Three segments sized to their real puzzle counts (3 / 5 / 7, not equal
 * thirds), each filling as its puzzles are completed, with the active stage
 * named and the run position spelled out. One glance answers "which stage,
 * how far in, how much left".
 */
export function RushHudStageMeter({
  stages,
  activeStageKey,
  ordinal,
  totalPuzzles,
  completedOrdinals,
}: {
  stages: PuzzleRushStage[];
  activeStageKey: PuzzleRushStageKey;
  ordinal: number;
  totalPuzzles: number;
  completedOrdinals: number[];
}) {
  const { index, total } = stagePosition(stages, activeStageKey);
  const activeStage = stages.find((stage) => stage.key === activeStageKey) ?? stages[0];

  return (
    <div className="pr-hud-stage" data-ui="rush-hud-stage" data-stage={activeStageKey}>
      <div className="pr-hud-stage__top">
        <span className="pr-hud-stage__name" data-ui="rush-hud-stage-name">
          {activeStage?.label ?? ''}
        </span>
        <span className="pr-hud-stage__count" data-ui="rush-hud-stage-count">
          {ordinal}
          <span className="pr-hud-stage__count-total">/{totalPuzzles}</span>
        </span>
      </div>

      <div className="pr-hud-stage__meter" role="presentation">
        {stages.map((stage) => {
          const size = Math.max(1, stage.toOrdinal - stage.fromOrdinal + 1);
          const done = completedOrdinals.filter(
            (o) => o >= stage.fromOrdinal && o <= stage.toOrdinal,
          ).length;
          const isActive = stage.key === activeStageKey;
          const isPast = stage.toOrdinal < ordinal && !isActive;
          return (
            <span
              key={stage.key}
              className={[
                'pr-hud-stage__seg',
                isActive ? 'is-active' : '',
                isPast ? 'is-past' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              // Segments are weighted by real puzzle count, so Master reads as
              // the long stretch it is rather than an equal third.
              style={{ flexGrow: size }}
              data-stage={stage.key}
              aria-label={`${stage.label}: ${done} of ${size}`}
            >
              <span
                className="pr-hud-stage__seg-fill"
                style={{ width: `${Math.round((Math.min(done, size) / size) * 100)}%` }}
              />
            </span>
          );
        })}
      </div>

      <span className="pr-hud-stage__position">
        Stage {index} of {total}
      </span>
    </div>
  );
}

export default RushHudStageMeter;
