import type { CSSProperties, ReactNode } from 'react';

export interface InGameBoardHudProps {
  leftSlot?: ReactNode;
  centerSlot?: ReactNode;
  rightSlot?: ReactNode;
  /**
   * Which cluster holds the empty slot the OPEN pill is drawn into on the installed phone app in landscape (useHudMetaSlot). It is
   * the side with room: the multiplayer HUD's centre status chip is wide, and Play vs Fritz keeps its history stepper on the right.
   */
  metaSlotSide?: 'left' | 'right';
  className?: string;
  style?: CSSProperties;
}

export function InGameBoardHud({
  leftSlot,
  centerSlot,
  rightSlot,
  metaSlotSide = 'right',
  className,
  style,
}: InGameBoardHudProps) {
  const metaSlot = <div className={`rh-hud-meta-slot rh-hud-meta-slot--${metaSlotSide}`} data-ui="hud-meta-slot" />;
  return (
    <div
      className={`wl-top-rail bot-top-rail rh-hud-rail${className ? ` ${className}` : ''}`}
      data-ui="hud"
      style={style}
    >
      {leftSlot ? (
        <div className="bot-hud-left-cluster" style={{ gridColumn: 1 }}>
          {leftSlot}
          {metaSlotSide === 'left' ? metaSlot : null}
        </div>
      ) : null}

      {centerSlot ? centerSlot : null}

      {rightSlot ? (
        <div className="bot-hud-right-cluster" style={{ gridColumn: 3, justifySelf: 'end' }}>
          {metaSlotSide === 'right' ? metaSlot : null}
          {rightSlot}
        </div>
      ) : null}
    </div>
  );
}
