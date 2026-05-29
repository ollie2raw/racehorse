import type { ReactNode } from 'react';
import { MatchBoardCanvas } from '../match/board/MatchBoardCanvas';

export interface MatchNblBoardFrameProps {
  children: ReactNode;
  toolbar?: ReactNode;
  className?: string;
}

/** @deprecated Prefer MatchLiveLayout + InGameBoardFrame. Kept for guided-learn board slot. */
export function MatchNblBoardFrame({ children, toolbar, className }: MatchNblBoardFrameProps) {
  return (
    <MatchBoardCanvas className={className} toolbar={toolbar}>
      {children}
    </MatchBoardCanvas>
  );
}
