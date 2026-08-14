// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { BoardState, PlacedTile } from '../types.ts';
import { Board, calculateBoardFitScale, computeBoardLayout } from './Board.tsx';

function placed(low: number, high: number, orientation = 'horizontal-normal'): PlacedTile {
  return { tile: { low, high }, orientation: orientation as PlacedTile['orientation'] };
}

function largeNestedBranchBoard(): BoardState {
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
          {
            tiles: [placed(4, 5), placed(4, 4, 'vertical-normal')],
            openEnd: 4,
            openEndIsDouble: true,
          },
          {
            tiles: [placed(3, 5), placed(2, 3), placed(1, 2), placed(0, 1)],
            openEnd: 0,
            openEndIsDouble: false,
          },
        ],
      },
      {
        hubId: 1,
        laneType: 'branch',
        laneRef: 'branch-0-0',
        branchDepth: 1,
        tileIndex: -1,
        hubValue: 4,
        isCrossed: true,
        leftSideFilled: true,
        rightSideFilled: true,
        branches: [
          {
            tiles: [placed(4, 6), placed(5, 6), placed(3, 5), placed(2, 3), placed(1, 2)],
            openEnd: 1,
            openEndIsDouble: false,
          },
          {
            tiles: [placed(0, 4), placed(0, 6), placed(5, 6), placed(3, 5), placed(2, 3)],
            openEnd: 2,
            openEndIsDouble: false,
          },
        ],
      },
    ],
  };
}

describe('Game Review board containment', () => {
  it('keeps a large multi-branch review board within container bounds and exposes pan/zoom controls', () => {
    const board = largeNestedBranchBoard();
    const layout = computeBoardLayout(board);
    const viewportWidth = 640;
    const viewportHeight = 360;
    const tileSize = 46;
    const targetFill = 0.88;
    const scale = calculateBoardFitScale({
      layout,
      tileSize,
      viewportWidth,
      viewportHeight,
      targetFill,
      minScale: 0.08,
      maxScale: 1.8,
    });

    // Every recursively laid-out tile must participate in the returned bounds.
    for (const tile of layout.tiles) {
      expect(tile.x).toBeGreaterThanOrEqual(layout.minX);
      expect(tile.x).toBeLessThanOrEqual(layout.maxX);
      expect(tile.y).toBeGreaterThanOrEqual(layout.minY);
      expect(tile.y).toBeLessThanOrEqual(layout.maxY);
    }

    const renderedWidth = (layout.maxX - layout.minX) * tileSize * scale;
    const renderedHeight = (layout.maxY - layout.minY) * tileSize * scale;
    expect(renderedWidth).toBeLessThanOrEqual(viewportWidth * targetFill + 0.001);
    expect(renderedHeight).toBeLessThanOrEqual(viewportHeight * targetFill + 0.001);

    const { container } = render(
      <div style={{ width: viewportWidth, height: viewportHeight }}>
        <Board
          board={board}
          legalMoves={[]}
          selectedTile={null}
          onPositionClick={() => {}}
          fitMode="guided"
          containFullBoard
          tileSize={tileSize}
        />
      </div>,
    );

    expect(layout.tiles.length).toBeGreaterThanOrEqual(16);
    expect(container.querySelectorAll('.board-tile-wrapper')).toHaveLength(layout.tiles.length);
    expect(screen.getByTitle('Zoom out')).toBeInTheDocument();
    expect(screen.getByTitle('Zoom in')).toBeInTheDocument();
    expect(container.querySelector('.board-container')).toHaveStyle({ cursor: 'grab' });
  });
});
