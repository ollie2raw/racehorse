import { describe, expect, it } from 'vitest';
import type { BoardState, PlacedTile, PlacementPosition } from '../../types.ts';
import { computeBoardLayout } from './boardLayout.ts';

function placed(low: number, high: number, orientation = 'horizontal-normal'): PlacedTile {
  return { tile: { low, high }, orientation: orientation as PlacedTile['orientation'] };
}

/** A 5-5 spinner on the main line with a 6-tile "down" arm and a 2-tile "up" arm. */
function longArmBoard(): BoardState {
  return {
    mainLine: [placed(5, 5, 'vertical-normal')],
    leftEnd: 5,
    rightEnd: 5,
    leftEndIsDouble: true,
    rightEndIsDouble: true,
    hubDoubles: [
      {
        hubId: 0,
        laneType: 'mainline',
        laneRef: 'mainline',
        tileIndex: 0,
        mainlineIndex: 0,
        hubValue: 5,
        isCrossed: true,
        leftSideFilled: true,
        rightSideFilled: true,
        branches: [
          { tiles: [placed(4, 5), placed(3, 4)], openEnd: 3, openEndIsDouble: false },
          {
            tiles: [placed(2, 5), placed(1, 2), placed(0, 1), placed(0, 6), placed(3, 6), placed(3, 4)],
            openEnd: 4,
            openEndIsDouble: false,
          },
        ],
      },
    ],
  };
}

/** longArmBoard() with its "down" arm replaced. */
function withDownArm(tiles: PlacedTile[]): BoardState {
  const board = longArmBoard();
  const [hub] = board.hubDoubles;
  return {
    ...board,
    hubDoubles: [{ ...hub, branches: [hub.branches[0], { tiles, openEnd: 0, openEndIsDouble: false }] }],
  };
}

const armTiles = (layout: ReturnType<typeof computeBoardLayout>, arm: number) =>
  layout.tiles.filter((t) => t.key.startsWith(`branch-0-${arm}-`));

const overlaps = (layout: ReturnType<typeof computeBoardLayout>) => {
  const boxes = layout.tiles.map((t) => {
    // rotation 0 lies along x for every tile, doubles included.
    const horizontal = t.rotation === 0;
    const w = horizontal ? 2 : 1;
    const h = horizontal ? 1 : 2;
    return { l: t.x - w / 2, r: t.x + w / 2, t: t.y - h / 2, b: t.y + h / 2 };
  });
  let n = 0;
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], c = boxes[j];
      if (Math.min(a.r, c.r) - Math.max(a.l, c.l) > 0.01 && Math.min(a.b, c.b) - Math.max(a.t, c.t) > 0.01) n++;
    }
  return n;
};

describe('computeBoardLayout — bending long vertical arms', () => {
  it('keeps arms straight when no limit is given (desktop/web layout unchanged)', () => {
    const layout = computeBoardLayout(longArmBoard());
    const down = armTiles(layout, 1);
    expect(new Set(down.map((t) => t.x)).size).toBe(1);
    expect(down.every((t) => t.rotation === 90)).toBe(true);
  });

  it('turns an arm sideways after the limit, without overlaps, and bounds shrink', () => {
    const straight = computeBoardLayout(longArmBoard());
    const bent = computeBoardLayout(longArmBoard(), [], { maxVerticalArmTiles: 3 });
    const down = armTiles(bent, 1);

    // First 3 stay vertical in one column; the rest form one horizontal row.
    expect(down.slice(0, 3).every((t) => t.rotation === 90 && t.x === down[0].x)).toBe(true);
    const row = down.slice(3);
    expect(row.every((t) => t.rotation === 0)).toBe(true);
    expect(new Set(row.map((t) => t.y)).size).toBe(1);
    // The corner row sits on the outer half of the 3rd tile.
    expect(row[0].y).toBeCloseTo(down[2].y + 0.5, 5);

    // Short arm (2 tiles) is untouched.
    expect(armTiles(bent, 0).every((t) => t.rotation === 90)).toBe(true);

    expect(overlaps(bent)).toBe(0);
    expect(bent.maxY - bent.minY).toBeLessThan(straight.maxY - straight.minY);
  });

  it('puts the open-end placement zone around the corner, in the new direction', () => {
    const pos = 'branch-0-1' as PlacementPosition;
    const bent = computeBoardLayout(longArmBoard(), [pos], { maxVerticalArmTiles: 3 });
    const zone = bent.zones.find((z) => z.position === pos)!;
    const row = armTiles(bent, 1).slice(3);
    const last = row[row.length - 1];
    expect(zone.lane).toBe('horizontal');
    expect(zone.dirY).toBe(0);
    expect(zone.y).toBe(last.y);
    expect(Math.sign(zone.x - last.x)).toBe(zone.dirX);
  });

  it('shows the zone around the corner when the next tile will be the first to bend', () => {
    const full = longArmBoard();
    const hub = full.hubDoubles[0];
    const arm = hub.branches[1]!;
    const board: BoardState = {
      ...full,
      hubDoubles: [{ ...hub, branches: [hub.branches[0], { ...arm, tiles: arm.tiles.slice(0, 3) }] }],
    };
    const pos = 'branch-0-1' as PlacementPosition;
    const zone = computeBoardLayout(board, [pos], { maxVerticalArmTiles: 3 }).zones.find((z) => z.position === pos)!;
    expect(zone.lane).toBe('horizontal');
  });

  it('never turns the corner on a double — it sits across the arm and the turn waits', () => {
    const board = withDownArm([placed(2, 5), placed(1, 2), placed(1, 1), placed(1, 6), placed(3, 6)]);
    const layout = computeBoardLayout(board, [], { maxVerticalArmTiles: 2 });
    const down = armTiles(layout, 1);
    const hubX = down[0].x;
    // tiles 0-1 straight, double straight (crosswise), tile 3 straight, tile 4 turns
    expect(down.slice(0, 4).every((t) => t.x === hubX)).toBe(true);
    expect(down[2].rotation).toBe(0);
    expect(down[4].x).not.toBe(hubX);
    expect(overlaps(layout)).toBe(0);
  });

  it('keeps the arm-end zone straight when the tile being placed is a double', () => {
    const board = withDownArm([placed(2, 5), placed(1, 2)]);
    const pos = 'branch-0-1' as PlacementPosition;
    const corner = computeBoardLayout(board, [pos], { maxVerticalArmTiles: 2 }).zones.find((z) => z.position === pos)!;
    const straight = computeBoardLayout(board, [pos], { maxVerticalArmTiles: 2, pendingTileIsDouble: true }).zones.find(
      (z) => z.position === pos,
    )!;
    expect(corner.lane).toBe('horizontal');
    expect(straight.lane).toBe('vertical');
  });
});

