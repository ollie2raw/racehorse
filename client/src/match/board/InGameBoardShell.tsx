import type { ReactNode } from 'react';

export interface InGameBoardShellProps {
  topHud?: ReactNode;
  children: ReactNode;
  className?: string;
  dataUi?: string;
}

export function InGameBoardShell({
  topHud,
  children,
  className,
  dataUi = 'match-board',
}: InGameBoardShellProps) {
  return (
    <div
      className={className ?? 'walnut-match-layout game-layout-layer'}
      data-ui={dataUi}
    >
      {topHud}
      {children}
    </div>
  );
}
