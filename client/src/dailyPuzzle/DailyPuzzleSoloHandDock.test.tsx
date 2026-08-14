// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DailyPuzzleSoloHandDock } from './DailyPuzzleSoloHandDock';
import type { Tile } from '../types';

const hand: Tile[] = [
  { low: 1, high: 2 },
  { low: 3, high: 4 },
];

function renderDock(overrides: Partial<Parameters<typeof DailyPuzzleSoloHandDock>[0]> = {}) {
  const onSelectTile = vi.fn();
  const props = {
    hand,
    handTileSize: 52,
    handCompactStacked: false,
    selectedTile: null,
    inProgress: true,
    isTilePlayable: () => true,
    onSelectTile,
    handRowKeyPrefix: 'daily-hand-row',
    tileKeyPrefix: 'daily-curated',
    ...overrides,
  };
  const view = render(<DailyPuzzleSoloHandDock {...props} />);
  return { onSelectTile, ...view };
}

describe('DailyPuzzleSoloHandDock', () => {
  it('renders tray structure and one hand row by default', () => {
    const { container } = renderDock();
    expect(container.querySelector('.tray-rail')).toBeTruthy();
    expect(container.querySelector('.tray-center')).toBeTruthy();
    expect(container.querySelector('.hand-container.has-single-row')).toBeTruthy();
    expect(container.querySelectorAll('.hand-row')).toHaveLength(1);
  });

  it('splits into two rows when compact stacked', () => {
    const longHand = Array.from({ length: 8 }, (_, idx) => ({ low: idx, high: idx }));
    const { container } = renderDock({ hand: longHand, handCompactStacked: true });
    expect(container.querySelector('.hand-container.is-stacked.has-single-row')).toBeTruthy();
    expect(container.querySelectorAll('.hand-row')).toHaveLength(2);
  });

  it('selects playable tiles only while in progress', () => {
    const onSelectTile = vi.fn();
    render(
      <DailyPuzzleSoloHandDock
        hand={hand}
        handTileSize={52}
        handCompactStacked={false}
        selectedTile={null}
        inProgress={true}
        isTilePlayable={(tile) => tile.low === 1}
        onSelectTile={onSelectTile}
        handRowKeyPrefix="ladder-hand-row"
        tileKeyPrefix="ladder"
      />,
    );

    const tiles = screen.getAllByRole('button');
    fireEvent.click(tiles[0]);
    fireEvent.click(tiles[1]);
    expect(onSelectTile).toHaveBeenCalledTimes(1);
    expect(onSelectTile).toHaveBeenCalledWith(hand[0]);
  });

  it('does not select tiles when not in progress', () => {
    const { onSelectTile } = renderDock({ inProgress: false, isTilePlayable: () => true });
    fireEvent.click(screen.getAllByRole('button')[0]);
    expect(onSelectTile).not.toHaveBeenCalled();
  });
});