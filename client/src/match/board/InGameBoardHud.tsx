import type { CSSProperties, ReactNode } from 'react';

export interface InGameBoardHudProps {
  leftSlot?: ReactNode;
  centerSlot?: ReactNode;
  rightSlot?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export function InGameBoardHud({
  leftSlot,
  centerSlot,
  rightSlot,
  className,
  style,
}: InGameBoardHudProps) {
  return (
    <div
      className={`wl-top-rail bot-top-rail${className ? ` ${className}` : ''}`}
      data-ui="hud"
      style={style}
    >
      {leftSlot ? (
        <div className="bot-hud-left-cluster" style={{ gridColumn: 1 }}>
          {leftSlot}
        </div>
      ) : null}

      {centerSlot ? centerSlot : null}

      {rightSlot ? (
        <div className="bot-hud-right-cluster" style={{ gridColumn: 3, justifySelf: 'end' }}>
          {rightSlot}
        </div>
      ) : null}
    </div>
  );
}
