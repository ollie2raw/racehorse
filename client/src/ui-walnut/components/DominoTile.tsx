import type { CSSProperties } from 'react';
import type { Tile } from '../../types';

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

const pipColors: Record<number, string> = {
  1: '#1e3a8a',
  2: '#0b5a3c',
  3: '#38bdf8',
  4: '#f97316',
  5: '#22c55e',
  6: '#dc2626',
};

interface PipHalfProps {
  value: number;
  size: number;
}

function PipHalf({ value, size }: PipHalfProps) {
  const positions = pipLayouts[value] ?? [];
  const pipSize = Math.max(8, Math.round(size * 0.22));
  const cellSize = size / 3;

  return (
    <div
      className="walnut-pip-half"
      style={{
        width: size,
        height: size,
      }}
    >
      {positions.map(([row, col], idx) => (
        <div
          key={`${value}-${row}-${col}-${idx}`}
          className="walnut-pip"
          style={{
            width: pipSize,
            height: pipSize,
            left: col * cellSize + cellSize / 2 - pipSize / 2,
            top: row * cellSize + cellSize / 2 - pipSize / 2,
            background: pipColors[value] ?? '#1f2937',
          }}
        />
      ))}
    </div>
  );
}

export interface WalnutDominoTileProps {
  tile: Tile;
  size?: number;
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
  flipped?: boolean;
  style?: CSSProperties;
}

export default function DominoTile({
  tile,
  size = 72,
  selected = false,
  disabled = false,
  onClick,
  className = '',
  flipped = false,
  style,
}: WalnutDominoTileProps) {
  const first = flipped ? tile.high : tile.low;
  const second = flipped ? tile.low : tile.high;
  const interactive = Boolean(onClick) && !disabled;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`walnut-domino ${selected ? 'is-selected' : ''} ${interactive ? 'is-interactive' : ''} ${className}`.trim()}
      style={style}
      aria-pressed={selected}
    >
      <div className="walnut-domino-gloss" aria-hidden="true" />
      <div className="walnut-domino-speck" aria-hidden="true" />
      <div className="walnut-domino-inner">
        <PipHalf value={first} size={size} />
        <div className="walnut-domino-divider" />
        <PipHalf value={second} size={size} />
      </div>
    </button>
  );
}
