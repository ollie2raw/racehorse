import type { ReactNode } from 'react';

export interface InGameBoardFrameProps {
  boardStage: ReactNode;
  handDock?: ReactNode;
  studioShellClassName?: string;
  boardZoneClassName?: string;
  handDockClassName?: string;
}

export function InGameBoardFrame({
  boardStage,
  handDock,
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
        {boardStage}
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
