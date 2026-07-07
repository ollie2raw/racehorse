import type { ReactNode, RefObject } from 'react';
import { MatchLiveLayout } from '../../../match/board';

type BotMatchLiveLayoutSectionProps = {
  boardStageRef: RefObject<HTMLDivElement | null>;
  ghostBoardPulse: boolean;
  boardStageInner: ReactNode;
  handTray: ReactNode;
  hudLeft: ReactNode;
  hudCenter: ReactNode | null;
  hudRight: ReactNode;
};

export function BotMatchLiveLayoutSection({
  boardStageRef,
  ghostBoardPulse,
  boardStageInner,
  handTray,
  hudLeft,
  hudCenter,
  hudRight,
}: BotMatchLiveLayoutSectionProps) {
  return (
    <MatchLiveLayout
      boardStageRef={boardStageRef}
      boardStageClassName={ghostBoardPulse ? 'ghost-board-pulse' : undefined}
      boardInner={boardStageInner}
      handDock={handTray}
      hudLeft={hudLeft}
      hudCenter={hudCenter}
      hudRight={hudRight}
    />
  );
}