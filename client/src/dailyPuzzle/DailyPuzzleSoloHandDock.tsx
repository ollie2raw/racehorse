import { DominoTile } from '../components';
import { tileEquals } from '../game/tileUtils';
import type { Tile } from '../types';

export type DailyPuzzleSoloHandDockProps = {
  hand: Tile[];
  handTileSize: number;
  handCompactStacked: boolean;
  selectedTile: Tile | null;
  inProgress: boolean;
  isTilePlayable: (tile: Tile) => boolean;
  onSelectTile: (tile: Tile) => void;
  handRowKeyPrefix: string;
  tileKeyPrefix: string;
};

export function DailyPuzzleSoloHandDock({
  hand,
  handTileSize,
  handCompactStacked,
  selectedTile,
  inProgress,
  isTilePlayable,
  onSelectTile,
  handRowKeyPrefix,
  tileKeyPrefix,
}: DailyPuzzleSoloHandDockProps) {
  const handRows = handCompactStacked
    ? [
        hand.slice(0, Math.ceil(hand.length / 2)),
        hand.slice(Math.ceil(hand.length / 2)),
      ]
    : [hand];

  return (
    <div className="tray-rail">
      <div className="tray-center">
        <div className={`hand-container ${handCompactStacked ? 'is-stacked has-single-row' : 'has-single-row'}`}>
          {handRows.map((row, rowIdx) => (
            <div key={`${handRowKeyPrefix}-${rowIdx}`} className="hand-row">
              {row.map((tile, idx) => {
                const playable = isTilePlayable(tile);
                const isSelected = selectedTile ? tileEquals(selectedTile, tile) : false;

                return (
                  <DominoTile
                    key={`${tileKeyPrefix}-${rowIdx}-${idx}-${tile.low}-${tile.high}`}
                    tile={tile}
                    size={handTileSize}
                    rotation={0}
                    selected={isSelected}
                    highlight={inProgress && playable}
                    unplayable={inProgress && !playable}
                    disabled={!inProgress}
                    onClick={() => {
                      if (!inProgress || !playable) return;
                      onSelectTile(tile);
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}