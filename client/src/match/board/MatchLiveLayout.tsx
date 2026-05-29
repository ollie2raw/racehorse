import type { ReactNode, RefObject } from 'react';
import { InGameBoardShell } from './InGameBoardShell';
import { InGameBoardHud } from './InGameBoardHud';
import { InGameBoardFrame } from './InGameBoardFrame';

export interface MatchLiveLayoutProps {
  hudLeft: ReactNode;
  hudCenter?: ReactNode;
  hudRight: ReactNode;
  boardInner: ReactNode;
  boardToolbar?: ReactNode;
  handDock: ReactNode;
  handFooter?: ReactNode;
  boardStageRef?: RefObject<HTMLDivElement | null>;
  boardStageClassName?: string;
  shellClassName?: string;
  handStackClassName?: string;
  handFooterClassName?: string;
}

/**
 * Canonical live match layout: HUD + board arena + hand dock.
 * Used by BotMatchScreen (Fritz / Daily Fritz / Ghost) and App multiplayer.
 */
export function MatchLiveLayout({
  hudLeft,
  hudCenter,
  hudRight,
  boardInner,
  boardToolbar,
  handDock,
  handFooter,
  boardStageRef,
  boardStageClassName,
  shellClassName,
  handStackClassName,
  handFooterClassName,
}: MatchLiveLayoutProps) {
  return (
    <InGameBoardShell className={shellClassName}>
      <InGameBoardHud
        style={{ position: 'relative' }}
        leftSlot={hudLeft}
        centerSlot={hudCenter}
        rightSlot={hudRight}
      />
      <InGameBoardFrame
        boardInner={boardInner}
        boardToolbar={boardToolbar}
        handDock={handDock}
        handFooter={handFooter}
        boardStageRef={boardStageRef}
        boardStageClassName={boardStageClassName}
        handStackClassName={handStackClassName}
        handFooterClassName={handFooterClassName}
      />
    </InGameBoardShell>
  );
}
