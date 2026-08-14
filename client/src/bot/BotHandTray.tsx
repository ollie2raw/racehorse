import React, { type RefObject } from 'react';
import DominoTile from '../components/DominoTile';
import { tileEquals } from '../game/tileUtils';
import { toTileKey } from '../ghost/logic';
import { getHandTileLegality } from '../utils/handTileLegality';
import type { Tile } from '../types';

export interface BotHandTrayProps {
  normalHandRows: Tile[][];
  handTileSize: number;
  handCompactStacked: boolean;
  selectedTile: Tile | null;
  handActive: boolean;
  botTurn: boolean;
  drawSequenceActive: boolean;
  drawPulseIndex: number | null;
  playableTileKeys: Set<string>;
  isGuidedMode: boolean;
  guidedScoringTiles: Map<string, number>;
  showCoachedRecommendation: boolean;
  lessonRecommendedTileKey: string | null;
  handAreaRef: RefObject<HTMLDivElement | null>;
  onTileClick: (tile: Tile, playable: boolean) => void;
  playerHand: Tile[];
}

export const BotHandTray: React.FC<BotHandTrayProps> = ({
  normalHandRows,
  handTileSize,
  handCompactStacked,
  selectedTile,
  handActive,
  botTurn,
  drawSequenceActive,
  drawPulseIndex,
  playableTileKeys,
  isGuidedMode,
  guidedScoringTiles,
  showCoachedRecommendation,
  lessonRecommendedTileKey,
  handAreaRef,
  onTileClick,
  playerHand,
}) => {
  return (
    <div
      className="hand-area wl-hand-area"
      data-ui="tray"
      role="region"
      aria-label="Your tiles"
    >
      <div className="tray-rail">
        <div className="tray-center" ref={handAreaRef}>
          <div
            className={`hand-container ${
              handCompactStacked ? 'is-stacked' : ''
            } ${normalHandRows.length > 1 ? 'has-multiple-rows' : 'has-single-row'}`}
          >
            {normalHandRows.map((row, rowIdx) => (
              <div key={`bot-hand-row-${rowIdx}`} className="hand-row">
                {row.map((tile, idx) => {
                  const selected = selectedTile ? tileEquals(selectedTile, tile) : false;
                  const showLegality = handActive && !botTurn && !drawSequenceActive;
                  const { highlight: legalityHighlight, unplayable: isUnplayable } = getHandTileLegality(
                    tile,
                    showLegality,
                    playableTileKeys,
                  );
                  const playable = legalityHighlight;
                  const absoluteIdx = playerHand.findIndex((handTile) => tileEquals(handTile, tile));
                  const tileKey = `${tile.low}-${tile.high}`;
                  const guidedPts = isGuidedMode ? (guidedScoringTiles.get(tileKey) ?? 0) : 0;
                  const guidedClass = isGuidedMode && playable
                    ? guidedPts > 0 ? 'guided-scoring' : 'guided-legal'
                    : '';
                  const isRecommendedLessonTile =
                    showCoachedRecommendation &&
                    lessonRecommendedTileKey != null &&
                    lessonRecommendedTileKey === toTileKey(tile);
                  const baseClass = drawPulseIndex === absoluteIdx ? 'new-draw' : '';
                  return (
                    <div
                      key={`bot-hand-${rowIdx}-${idx}-${tile.low}-${tile.high}`}
                      className={`guided-tile-wrap${isGuidedMode && playable && guidedPts > 0 ? ' has-badge' : ''}${isRecommendedLessonTile ? ' is-recommended' : ''}`}
                    >
                      {isGuidedMode && playable && guidedPts > 0 && (
                        <span className="guided-score-badge">+{guidedPts}</span>
                      )}
                      <DominoTile
                        tile={tile}
                        size={handTileSize}
                        rotation={0}
                        className={[
                          baseClass,
                          guidedClass,
                          isRecommendedLessonTile ? 'is-coached-recommended' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        selected={selected}
                        highlight={legalityHighlight}
                        unplayable={isUnplayable}
                        disabled={!handActive || botTurn || drawSequenceActive}
                        onClick={() => onTileClick(tile, playable)}
                      />
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
