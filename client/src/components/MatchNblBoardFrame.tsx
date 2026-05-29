import type { ReactNode } from 'react';
import { BoardWatermark } from '../match/BoardWatermark';
import '../practice/noBrainerLab.css';

export interface MatchNblBoardFrameProps {
  children: ReactNode;
  toolbar?: ReactNode;
  className?: string;
}

/** No Brainer Lab board surface — grid frame, inset bezel, centered canvas. */
export function MatchNblBoardFrame({ children, toolbar, className }: MatchNblBoardFrameProps) {
  return (
    <main className={`nbl-stage walnut-nbl-stage rh-board-stage${className ? ` ${className}` : ''}`}>
      <div className="nbl-board-frame rh-board-frame">
        <div className="nbl-board-canvas rh-board-canvas" data-ui="board">
          <BoardWatermark />
          {children}
          {toolbar ? <div className="nbl-board-toolbar">{toolbar}</div> : null}
        </div>
      </div>
    </main>
  );
}
