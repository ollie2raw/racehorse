import type { ReactNode } from 'react';
import { BoardWatermark } from '../BoardWatermark';
import '../matchBoardSurface.css';

export interface MatchBoardCanvasProps {
  children: ReactNode;
  toolbar?: ReactNode;
  className?: string;
}

/** Board arena: NBL frame + canvas + watermark. Used by live bot/MP match. */
export function MatchBoardCanvas({ children, toolbar, className }: MatchBoardCanvasProps) {
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
