import type { Tile } from "../../types";
import DominoTile from "./DominoTile";

interface HandAction {
  id: string;
  label: string;
  onClick: () => void;
}

interface HandTrayProps {
  tiles: Tile[];
  selectedTile: Tile | null;
  onSelectTile: (tile: Tile) => void;
  isInteractive?: boolean;
  actions?: HandAction[];
  tileSize?: number;
}

function tileEquals(a: Tile, b: Tile): boolean {
  return a.high === b.high && a.low === b.low;
}

export default function HandTray({
  tiles,
  selectedTile,
  onSelectTile,
  isInteractive = true,
  actions = [],
  tileSize = 74,
}: HandTrayProps) {
  const hasActions = actions.length > 0;

  return (
    <section className="walnut-hand-dock" aria-label="Your hand">
      <div className="walnut-hand-row" role="list">
        {tiles.map((tile, idx) => {
          const selected = selectedTile ? tileEquals(tile, selectedTile) : false;

          return (
            <div key={`${tile.low}-${tile.high}-${idx}`} role="listitem" className="walnut-hand-item">
              <DominoTile
                tile={tile}
                size={tileSize}
                selected={selected}
                onClick={isInteractive ? () => onSelectTile(tile) : undefined}
                disabled={!isInteractive}
              />
            </div>
          );
        })}
      </div>

      {hasActions && (
        <div className="walnut-hand-actions" aria-label="Turn actions">
          {actions.map((action) => (
            <button key={action.id} type="button" className="walnut-action-ghost" onClick={action.onClick}>
              {action.label}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
