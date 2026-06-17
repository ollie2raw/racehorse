import { useMemo } from 'react';
import { DominoTile } from '../../components/DominoTile.tsx';
import type { PreGameDrawState } from './preGameDrawLogic.ts';
import { computePreGameDrawScatterPositions } from './preGameDrawScatter.ts';
import './preGameDraw.css';

export interface PreGameTileDrawBoardProps {
  drawState: PreGameDrawState;
  tileSize?: number;
  isPlayerPickEnabled: boolean;
  onTileTap: (tileId: string) => void;
}

const DEFAULT_TILE_SIZE = 44;

export function PreGameTileDrawBoard({
  drawState,
  tileSize = DEFAULT_TILE_SIZE,
  isPlayerPickEnabled,
  onTileTap,
}: PreGameTileDrawBoardProps) {
  const visibleSlots = useMemo(
    () => drawState.tiles.filter((slot) => !slot.outOfPlay),
    [drawState.tiles],
  );

  const scatterById = useMemo(() => {
    const positions = computePreGameDrawScatterPositions(visibleSlots.map((slot) => slot.id));
    return new Map(positions.map((pos) => [pos.tileId, pos]));
  }, [visibleSlots]);

  const hasRevealedTiles = visibleSlots.some((slot) => slot.revealed);

  return (
    <div
      className={[
        'pre-game-draw-board',
        hasRevealedTiles ? 'has-revealed-tiles' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-phase={drawState.phase}
    >
      <div className="pre-game-draw-board__scatter" aria-hidden={false}>
        {visibleSlots.map((slot) => {
          const scatter = scatterById.get(slot.id);
          if (!scatter) return null;

          const pickable = isPlayerPickEnabled && !slot.revealed;
          const isFaceDown = !slot.revealed;
          const tileWidth = tileSize * 2;

          return (
            <div
              key={slot.id}
              className={[
                'pre-game-draw-board__tile-slot',
                slot.revealed ? 'is-revealed' : 'is-face-down',
                pickable ? 'is-pickable' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{
                left: `${scatter.leftPct}%`,
                top: `${scatter.topPct}%`,
                width: tileWidth,
                height: tileSize,
                zIndex: scatter.zIndex,
                transform: `translate(-50%, -50%) rotate(${scatter.rotationDeg}deg)`,
              }}
            >
              <DominoTile
                tile={slot.tile}
                size={tileSize}
                faceDown={isFaceDown}
                highlight={pickable}
                disabled={!pickable}
                className="pre-game-draw-tile"
                onClick={pickable ? () => onTileTap(slot.id) : undefined}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
