import { forwardRef, type CSSProperties, type Ref } from 'react';
import { BoneyardStackIcon } from './BoneyardStackIcon';

export interface BoneyardCountPillProps {
  count: number;
  lockedThreshold?: number;
  className?: string;
  iconStyle?: CSSProperties;
}

export const BoneyardCountPill = forwardRef(function BoneyardCountPill(
  { count, lockedThreshold = 2, className = '', iconStyle }: BoneyardCountPillProps,
  ref: Ref<HTMLDivElement>,
) {
  const isLocked = count > 0 && count <= lockedThreshold;

  return (
    <div
      ref={ref}
      className={`boneyard-pill board-corner-pill board-corner-pill--tr${isLocked ? ' locked' : ''}${className ? ` ${className}` : ''}`}
      aria-label={`${count} tiles in boneyard${isLocked ? ', locked' : ''}`}
    >
      <BoneyardStackIcon
        className="boneyard-icon"
        style={{ width: 21, height: 21, opacity: 0.95, ...iconStyle }}
      />
      <span className="boneyard-count">{count}</span>
      {isLocked ? (
        <span
          className="boneyard-meta"
          style={{
            fontSize: '0.62rem',
            fontWeight: 700,
            textTransform: 'uppercase',
            opacity: 0.9,
          }}
        >
          locked
        </span>
      ) : null}
    </div>
  );
});
