import type { ReactNode } from 'react';

export type MultiplayerTwoColumnPvLayoutProps = {
  /** Extra classes on the left column (e.g. `pml-left--stack pml-left--room`) */
  leftColClassName?: string;
  left: ReactNode;
  /** Full right column including outer `pvf-control-panel` wrapper */
  right: ReactNode;
};

/**
 * Shared 40/60 multiplayer hub row: `pvf-layout` + left `pvf-left-col` + right panel sibling.
 * Matches Private Match / Play vs Fritz structural contract.
 */
export function MultiplayerTwoColumnPvLayout({
  leftColClassName = '',
  left,
  right,
}: MultiplayerTwoColumnPvLayoutProps) {
  const leftClasses = ['pvf-left-col', leftColClassName].filter(Boolean).join(' ');
  return (
    <div className="pvf-layout mp-hub-pvf-layout">
      <div className={leftClasses}>{left}</div>
      {right}
    </div>
  );
}
