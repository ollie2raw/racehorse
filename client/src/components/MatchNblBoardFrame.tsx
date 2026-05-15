import type { ReactNode } from 'react';
import '../practice/noBrainerLab.css';

export interface MatchNblBoardFrameProps {
  children: ReactNode;
  toolbar?: ReactNode;
  className?: string;
}

/** No Brainer Lab board surface — grid frame, inset bezel, centered canvas. */
export function MatchNblBoardFrame({ children, toolbar, className }: MatchNblBoardFrameProps) {
  return (
    <main className={`nbl-stage walnut-nbl-stage${className ? ` ${className}` : ''}`}>
      <div className="nbl-board-frame">
        <div className="nbl-board-canvas" data-ui="board">
          <div className="nbl-board-watermark" aria-hidden="true">
            <img src="/brand_logo.png" alt="" />
          </div>
          {children}
          {toolbar ? <div className="nbl-board-toolbar">{toolbar}</div> : null}
        </div>
      </div>
    </main>
  );
}
