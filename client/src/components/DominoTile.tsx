// client/src/components/DominoTile.tsx
import type { Tile } from "../types";

// ─── Pip Layouts ─────────────────────────────────────────────

const pipLayouts: Record<number, [number, number][]> = {
  0: [],
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [0, 2], [2, 0], [2, 2]],
  5: [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]],
  6: [[0, 0], [0, 2], [1, 0], [1, 2], [2, 0], [2, 2]],
};

// ─── Pip Half Component ──────────────────────────────────────

interface PipHalfProps {
  value: number;
  size: number;
}

function PipHalf({ value, size }: PipHalfProps) {
  const positions = pipLayouts[value] || [];
  const pipSize = Math.max(4, size / 5);
  const cellSize = size / 3;

  return (
    <div
      className="pip-half"
      style={{
        width: size,
        height: size,
        position: "relative",
      }}
    >
      {positions.map(([row, col], idx) => (
        <div
          key={idx}
          className="pip"
          style={{
            position: "absolute",
            width: pipSize,
            height: pipSize,
            borderRadius: "50%",
            backgroundColor: "currentColor",
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
  style?: React.CSSProperties;
}

export function DominoTile({
  tile,
  size = 40,
  selected = false,
  highlight = false,
  onClick,
  disabled = false,
  className = "",
  flipped = false,
  rotation = 0,
  style,
}: DominoTileProps) {
  const isDouble = tile.high === tile.low;

  const tileClass = [
    "domino-tile",
    isDouble ? "double" : "",
    selected ? "selected" : "",
    highlight ? "highlight" : "",
    disabled ? "disabled" : "",
    className,
  ].filter(Boolean).join(" ");

  // Determine which pip to show first based on orientation
  const firstPip = flipped ? tile.high : tile.low;
  const secondPip = flipped ? tile.low : tile.high;

  // Calculate dimensions based on rotation
  // At 0/180 degrees: horizontal (width > height)
  // At 90/270 degrees: vertical (height > width)
  const isVertical = rotation === 90 || rotation === 270;

  return (
    <button
      className={tileClass}
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "flex",
        flexDirection: isVertical ? "column" : "row",
        padding: 0,
        border: "none",
        background: "none",
        cursor: disabled ? "default" : onClick ? "pointer" : "default",
        transform: `rotate(${rotation}deg)`,
        ...style,
      }}
    >
      <div
        className="domino-body"
        style={{
          flexDirection: isVertical ? "column" : "row",
        }}
      >
        <PipHalf value={firstPip} size={size} />
        <div className={`domino-divider ${isVertical ? "horizontal" : "vertical"}`} />
        <PipHalf value={secondPip} size={size} />
      </div>
    </button>
  );
}

export default DominoTile;
