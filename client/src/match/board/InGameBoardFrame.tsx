import type { ReactNode, RefObject } from 'react';
import { MatchBoardCanvas } from './MatchBoardCanvas';

export interface InGameBoardFrameProps {
  boardInner: ReactNode;
  boardToolbar?: ReactNode;
  handDock?: ReactNode;
  boardStageRef?: RefObject<HTMLDivElement | null>;
  boardStageClassName?: string;
  studioShellClassName?: string;
  boardZoneClassName?: string;
  handDockClassName?: string;
}

export function InGameBoardFrame({
  boardInner,
  boardToolbar,
  handDock,
  boardStageRef,
  boardStageClassName,
  studioShellClassName,
  boardZoneClassName,
  handDockClassName,
}: InGameBoardFrameProps) {
  return (
    <div
      className={`rh-live-studio-shell${studioShellClassName ? ` ${studioShellClassName}` : ''}`}
      data-ui="live-studio-shell"
    >
      <div
        className={`rh-live-board-zone${boardZoneClassName ? ` ${boardZoneClassName}` : ''}`}
        data-ui="live-board-zone"
      >
        <div
          ref={boardStageRef}
          className={`wl-stage-shell${boardStageClassName ? ` ${boardStageClassName}` : ''}`}
        >
          <MatchBoardCanvas toolbar={boardToolbar}>{boardInner}</MatchBoardCanvas>
        </div>
      </div>
      {handDock ? (
        <div
          className={`rh-live-hand-deck${handDockClassName ? ` ${handDockClassName}` : ''}`}
          data-ui="live-hand-deck"
        >
          {handDock}
        </div>
      ) : null}
    </div>
  );
}
