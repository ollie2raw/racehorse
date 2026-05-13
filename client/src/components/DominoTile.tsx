// client/src/components/DominoTile.tsx
import { memo } from 'react';
import type { Tile } from '../types';

// ─── Pip Layouts ─────────────────────────────────────────────

const pipLayouts: Record<number, [number, number][]> = {
  0: [],
  1: [[1, 1]],
  2: [
    [0, 0],
    [2, 2],
  ],
  3: [
    [0, 0],
    [1, 1],
    [2, 2],
  ],
  4: [
    [0, 0],
    [0, 2],
    [2, 0],
    [2, 2],
  ],
  5: [
    [0, 0],
    [0, 2],
    [1, 1],
    [2, 0],
    [2, 2],
  ],
  6: [
    [0, 0],
    [0, 2],
    [1, 0],
    [1, 2],
    [2, 0],
    [2, 2],
  ],
};

const PIP_COLORS: Record<number, string> = {
  1: '#1e3a8a',
  2: '#0B5A3C',
  3: '#38bdf8',
  4: '#f97316',
  5: '#22c55e',
  6: '#dc2626',
};

// ─── Pip Half Component ──────────────────────────────────────

interface PipHalfProps {
  value: number;
  size: number;
}

function PipHalf({ value, size }: PipHalfProps) {
  const positions = pipLayouts[value] || [];
  const pipSize = Math.max(6, size / 4.5);
  const cellSize = size / 3;
  const pipColor = PIP_COLORS[value] ?? '#1f2937';

  return (
    <div
      className="pip-half"
      style={{
        width: size,
        height: size,
        position: 'relative',
        flexShrink: 0,
      }}
    >
      {positions.map(([row, col], idx) => (
        <div
          key={idx}
          className="pip"
          style={{
            position: 'absolute',
            width: pipSize,
            height: pipSize,
            borderRadius: '50%',
            backgroundColor: pipColor,
            boxShadow: 'none',
            border: '1px solid rgba(0,0,0,0.18)',
            left: col * cellSize + cellSize / 2 - pipSize / 2,
            top: row * cellSize + cellSize / 2 - pipSize / 2,
          }}
        />
      ))}
    </div>
  );
}

// ─── Domino Tile Component ───────────────────────────────────

export interface DominoTileProps {
  tile: Tile;
  size?: number;
  selected?: boolean;
  highlight?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  flipped?: boolean;
  rotation?: number;
  vertical?: boolean;
  style?: React.CSSProperties;
}

function tilesEqual(a: Tile, b: Tile): boolean {
  return a.high === b.high && a.low === b.low;
}

function stylesEqual(a?: React.CSSProperties, b?: React.CSSProperties): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (a[key as keyof React.CSSProperties] !== b[key as keyof React.CSSProperties]) {
      return false;
    }
  }
  return true;
}

function DominoTileComponent({
  tile,
  size = 70,
  selected = false,
  highlight = false,
  onClick,
  disabled = false,
  className = '',
  flipped = false,
  rotation = 0,
  vertical = false,
  style,
}: DominoTileProps) {
  const isDouble = tile.high === tile.low;

  const tileClass = [
    'domino-tile',
    isDouble ? 'double' : '',
    selected ? 'selected' : '',
    highlight ? 'highlight' : '',
    disabled ? 'disabled' : '',
    vertical ? 'vertical' : 'horizontal',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  // Determine which pip to show first based on flipped flag
  // When flipped=false: low on left/top, high on right/bottom
  // When flipped=true: high on left/top, low on right/bottom
  const firstPip = flipped ? tile.high : tile.low;
  const secondPip = flipped ? tile.low : tile.high;

  // Tile is rendered horizontally or vertically based on 'vertical' flag
  // Rotation is applied via CSS transform
  const borderWidth = size < 30 ? 1.5 : 3;
  const dividerSize = size < 30 ? 1.5 : 3;
  const totalWidth = vertical ? size : (size * 2) + dividerSize;
  const totalHeight = vertical ? (size * 2) + dividerSize : size;

  return (
    <button
      className={tileClass}
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'block',
        padding: 0,
        border: 'none',
        background: 'none',
        cursor: disabled ? 'default' : onClick ? 'pointer' : 'default',
        transform: rotation ? `rotate(${rotation}deg)` : undefined,
        width: totalWidth,
        height: totalHeight,
        ...style,
      }}
    >
      <div
        className="domino-body"
        style={{
          display: 'flex',
          flexDirection: vertical ? 'column' : 'row',
          width: '100%',
          height: '100%',
          borderWidth: borderWidth,
          borderRadius: size < 30 ? 4 : 6,
        }}
      >
        <PipHalf value={firstPip} size={size} />
        <div 
          className={`domino-divider ${vertical ? 'horizontal' : 'vertical'}`} 
          style={{ 
            width: vertical ? '100%' : dividerSize,
            height: vertical ? dividerSize : '100%',
          }}
        />
        <PipHalf value={secondPip} size={size} />
      </div>
    </button>
  );
}

function areDominoTilePropsEqual(prev: DominoTileProps, next: DominoTileProps): boolean {
  return (
    tilesEqual(prev.tile, next.tile) &&
    prev.size === next.size &&
    prev.selected === next.selected &&
    prev.highlight === next.highlight &&
    prev.onClick === next.onClick &&
    prev.disabled === next.disabled &&
    prev.className === next.className &&
    prev.flipped === next.flipped &&
    prev.rotation === next.rotation &&
    prev.vertical === next.vertical &&
    stylesEqual(prev.style, next.style)
  );
}

export const DominoTile = memo(DominoTileComponent, areDominoTilePropsEqual);

export default DominoTile;
