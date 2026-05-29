import type { ReactNode, RefObject } from 'react';
import { MatchBoardCanvas } from './MatchBoardCanvas';

export interface InGameBoardFrameProps {
  boardInner: ReactNode;
  boardToolbar?: ReactNode;
  handDock?: ReactNode;
  /** Optional bar below the hand deck (e.g. No Brainer Lab training controls). */
  handFooter?: ReactNode;
  boardStageRef?: RefObject<HTMLDivElement | null>;
  boardStageClassName?: string;
  studioShellClassName?: string;
  boardZoneClassName?: string;
  handDockClassName?: string;
  handStackClassName?: string;
  handFooterClassName?: string;
}

export function InGameBoardFrame({
  boardInner,
  boardToolbar,
  handDock,
  handFooter,
  boardStageRef,
  boardStageClassName,
  studioShellClassName,
  boardZoneClassName,
  handDockClassName,
  handStackClassName,
  handFooterClassName,
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
      {handDock || handFooter ? (
        <div
          className={`rh-live-hand-stack${handStackClassName ? ` ${handStackClassName}` : ''}`}
          data-ui="live-hand-stack"
        >
          {handDock ? (
            <div
              className={`rh-live-hand-deck${handDockClassName ? ` ${handDockClassName}` : ''}`}
              data-ui="live-hand-deck"
            >
              {handDock}
            </div>
          ) : null}
          {handFooter ? (
            <div
              className={`rh-live-hand-footer-slot${handFooterClassName ? ` ${handFooterClassName}` : ''}`}
              data-ui="live-hand-footer"
            >
              {handFooter}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
