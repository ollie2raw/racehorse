import type { ReactNode, RefObject } from 'react';
import { MatchNblBoardFrame } from '../../../components/MatchNblBoardFrame.tsx';

type BotMatchBoardStageFrameProps = {
  boardStageRef: RefObject<HTMLDivElement | null>;
  ghostBoardPulse: boolean;
  children: ReactNode;
};

export function BotMatchBoardStageFrame({
  boardStageRef,
  ghostBoardPulse,
  children,
}: BotMatchBoardStageFrameProps) {
  return (
    <div ref={boardStageRef} className="wl-stage-shell">
      <MatchNblBoardFrame className={ghostBoardPulse ? 'ghost-board-pulse' : undefined}>
        {children}
      </MatchNblBoardFrame>
    </div>
  );
}