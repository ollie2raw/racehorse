import type { ReactNode } from 'react';

export interface MatchLayoutProps {
  topRail?: ReactNode;
  boardStage: ReactNode;
  hand: ReactNode;
  overlays?: ReactNode;
}

export function MatchLayout({ topRail, boardStage, hand, overlays }: MatchLayoutProps) {
  return (
    <div className="walnut-match-layout" data-ui="match-board">
      {topRail}
      {boardStage}
      {hand}
      {overlays}
    </div>
  );
}
