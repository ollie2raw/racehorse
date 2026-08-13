/* global React */
const { useState, useMemo } = React;

// ─── Domino tile primitive ──────────────────────────────────────────
const PIPS = {
  0: [],
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

function TileHalf({ value }) {
  const positions = PIPS[value] ?? [];
  return (
    <div className="rh-tile__half">
      {Array.from({ length: 9 }, (_, i) => (
        <div
          key={i}
          className="rh-tile__pip"
          style={{ visibility: positions.includes(i) ? 'visible' : 'hidden' }}
        />
      ))}
    </div>
  );
}

function Tile({ low, high, orientation = 'h', size = 'md' }) {
  const cls = [
    'rh-tile',
    orientation === 'v' ? 'rh-tile--vert' : 'rh-tile--horiz',
    size === 'sm' ? 'rh-tile--sm' : '',
  ].filter(Boolean).join(' ');
  return (
    <div className={cls}>
      <TileHalf value={low} />
      <TileHalf value={high} />
    </div>
  );
}

window.Tile = Tile;
